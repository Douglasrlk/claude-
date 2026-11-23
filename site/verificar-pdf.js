/* ════════════════════════════════════════════════════════════════
   Fieldo v12.40 · verificar-pdf.js — conferir um PDF na página Verificar

   Pedido do dono (18/11): a página Verificar aceita o PDF e analisa se
   ele serve como prova. Tudo roda NO NAVEGADOR: o arquivo não é enviado
   ao Fieldo nem a terceiros. Saem do aparelho só o SHA-256 do arquivo e
   os códigos de autenticidade achados nele — nunca o conteúdo.

   Por que não basta o hash do arquivo: o código do Fieldo é o SHA-256 do
   CONTEÚDO (dados do relatório, texto do contrato), e cada impressão em
   PDF gera bytes diferentes. Então são quatro camadas:

     1. arquivo idêntico   SHA-256 dos bytes = PDF arquivado do contrato
                           (loc_contratos.pdf_hash, RPC verificar_pdf)
     2. código registrado  códigos SHA-256 no texto ou nos links do PDF,
                           conferidos em verificar_hash
     3. conteúdo           dados do registro (nº do contrato, cliente,
                           data, valor) procurados no texto do PDF
     4. estrutura          salvamentos depois de gerado (%%EOF a mais),
                           assinatura digital anexada, metadados

   pdf.js (Mozilla, 4.10.38 legacy, em /vendor/pdfjs) é usado só para
   extrair texto/links/metadados — nunca renderiza — e com eval
   desligado (CVE-2024-4367 é corrigida a partir da 4.2.67).

   Esta análise é técnica. O painel "Validade jurídica" explica o que o
   documento prova e em qual lei isso se apoia; não é parecer jurídico.
════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var MAX_MB = 25;
  var MAX_PAGINAS = 60;
  var PDFJS = '/vendor/pdfjs/pdf.min.mjs';
  var WORKER = '/vendor/pdfjs/pdf.worker.min.mjs';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function hex(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
    return s;
  }
  function fmtData(iso) {
    try {
      return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    } catch (e) { return String(iso || ''); }
  }
  function rpc(nome, args) {
    var C = window.FIELDO && FIELDO.config;
    return fetch(C.REST_URL + '/rpc/' + nome, {
      method: 'POST',
      headers: { apikey: C.ANON_KEY, Authorization: 'Bearer ' + C.ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    }).then(function (r) {
      if (!r.ok) throw new Error('consulta ' + r.status);
      return r.text().then(function (t) { return t ? JSON.parse(t) : null; });
    });
  }

  var _pdfjs = null;
  function carregarPdfjs() {
    if (_pdfjs) return _pdfjs;
    _pdfjs = import(PDFJS).then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = WORKER;
      return lib;
    });
    _pdfjs.catch(function () { _pdfjs = null; });
    return _pdfjs;
  }

  /* ── leitura dos bytes: estrutura do arquivo ───────────────────── */
  function estrutura(bytes) {
    /* latin1: 1 byte = 1 caractere, para procurar marcadores do formato */
    var s = '';
    var passo = 0x8000;
    for (var i = 0; i < bytes.length; i += passo) s += String.fromCharCode.apply(null, bytes.subarray(i, i + passo));
    var eofs = (s.match(/%%EOF/g) || []).length;
    var temSig = /\/ByteRange\s*\[/.test(s) && /\/Type\s*\/Sig\b/.test(s);
    var sub = (s.match(/\/SubFilter\s*\/([A-Za-z0-9.\-_]+)/) || [])[1] || '';
    var assinaturas = (s.match(/\/ByteRange\s*\[/g) || []).length;
    var ehPdf = s.slice(0, 1024).indexOf('%PDF-') !== -1;
    /* cada assinatura digital legítima acrescenta uma revisão; o que
       passar disso é salvamento posterior */
    var revisoesExtras = Math.max(0, eofs - 1 - assinaturas);
    return { ehPdf: ehPdf, eofs: eofs, revisoesExtras: revisoesExtras, temAssinaturaDigital: temSig, subFilter: sub, assinaturas: assinaturas };
  }

  /* ── texto, links e metadados ─────────────────────────────────── */
  function extrair(lib, bytes) {
    var tarefa = lib.getDocument({
      data: bytes.slice(),           /* o worker toma posse do buffer */
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      stopAtErrors: false
    });
    return tarefa.promise.then(function (pdf) {
      var n = Math.min(pdf.numPages, MAX_PAGINAS);
      var textos = [], links = [];
      var seq = Promise.resolve();
      for (var p = 1; p <= n; p++) {
        (function (num) {
          seq = seq.then(function () {
            return pdf.getPage(num).then(function (pg) {
              return Promise.all([
                pg.getTextContent().then(function (tc) {
                  textos.push(tc.items.map(function (it) { return it.str; }).join(' '));
                }),
                pg.getAnnotations().then(function (an) {
                  an.forEach(function (a) { if (a.url) links.push(a.url); });
                }).catch(function () {})
              ]);
            });
          });
        })(p);
      }
      return seq.then(function () { return pdf.getMetadata().catch(function () { return {}; }); })
        .then(function (meta) {
          var out = { paginas: pdf.numPages, texto: textos.join('\n'), links: links, info: (meta && meta.info) || {} };
          try { pdf.destroy(); } catch (e) {}
          return out;
        });
    });
  }

  /* códigos SHA-256 no texto (o contrato imprime em 2 linhas de 32) e nos links */
  function codigos(texto, links) {
    var achados = [];
    function add(h) { h = h.toLowerCase(); if (achados.indexOf(h) === -1 && achados.length < 12) achados.push(h); }
    links.forEach(function (u) {
      var m = /[?&]hash=([0-9a-fA-F]{64})/.exec(u);
      if (m) add(m[1]);
    });
    (texto.match(/\b[0-9a-fA-F]{64}\b/g) || []).forEach(add);
    /* hex quebrado em linhas/blocos: junta sequências de blocos hex */
    var blocos = texto.match(/(?:\b[0-9a-fA-F]{8,}\b[\s\n]*){2,}/g) || [];
    blocos.forEach(function (b) {
      var j = b.replace(/\s+/g, '');
      if (j.length === 64) add(j);
      else if (j.length > 64 && j.length <= 192) for (var i = 0; i + 64 <= j.length; i += 32) add(j.slice(i, i + 64));
    });
    return achados;
  }

  /* ── conteúdo: o que o registro diz × o que o PDF mostra ───────── */
  var MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function conferirConteudo(doc, texto) {
    var t = norm(texto);
    var tSem = t.replace(/\s/g, '');
    var r = doc.conteudo_resumo || {};
    var checks = [];
    function c(rotulo, esperado, achou) { checks.push({ rotulo: rotulo, esperado: esperado, ok: !!achou }); }
    /* a impressão do Chrome extrai o texto com espaço entre letras
       ("A n a   Pa u l a"): tenta a palavra inteira e, se não achar,
       compara sem nenhum espaço dos dois lados */
    function tem(valor) {
      var v = norm(valor);
      if (!v) return false;
      var re = new RegExp('(^|[^a-z0-9])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])');
      return re.test(t) || tSem.indexOf(v.replace(/\s/g, '')) !== -1;
    }

    if (doc.tipo === 'contrato_locacao_v2' || doc.tipo === 'contrato_obra') {
      if (r.numero) c('Número do contrato', r.numero, tSem.indexOf(norm(r.numero).replace(/\s/g, '')) !== -1);
      if (r.locadora) c('Locadora', r.locadora, tem(r.locadora));
      if (r.contratada) c('Profissional', r.contratada, tem(r.contratada));
      if (r.versao) c('Versão', 'v' + r.versao, /vers[aã]o\d|v\d/.test(tSem) && (tSem.indexOf('versao' + r.versao) !== -1 || tSem.indexOf('v' + r.versao) !== -1));
    }
    if (r.client) {
      /* o registro devolve o nome curto ("Ana P."): basta o primeiro nome */
      var primeiro = norm(String(r.client).split(/\s+/)[0]);
      if (primeiro.length >= 2) c('Cliente', r.client, tem(primeiro));
    }
    if (r.date) {
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(r.date);
      if (m) {
        var d1 = m[3] + '/' + m[2] + '/' + m[1], d2 = m[3] + '/' + m[2];
        var d3 = Number(m[3]) + ' de ' + MESES[Number(m[2]) - 1] + ' de ' + m[1];
        c('Data do serviço', d1, tSem.indexOf(d1) !== -1 || tSem.indexOf(d3.replace(/\s/g, '')) !== -1 || tSem.indexOf(d2) !== -1);
      }
    }
    if (r.valor != null && r.valor !== '') {
      var v = Number(r.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      c('Valor', 'R$ ' + v, tSem.indexOf(v.replace(/\s/g, '')) !== -1);
    }
    if (r.category) c('Categoria', r.category, tem(r.category));
    return checks;
  }

  /* ── validade jurídica: o que o documento prova ────────────────── */
  function painelJuridico(doc, est, integro) {
    var r = (doc && doc.conteudo_resumo) || {};
    var itens = [];
    /* arquivo divergente ou editado: o que vem abaixo descreve o documento
       REGISTRADO, não este arquivo — dizer isso antes de qualquer coisa */
    if (doc && integro === false) {
      itens.push(['Atenção', '<strong>Este arquivo não confere com o registro.</strong> O que está abaixo vale para o documento registrado no Fieldo, não para este PDF. Para usar como prova, peça o original a quem emitiu.']);
    }
    if (doc && doc.tipo === 'contrato_obra') {
      var assinadoO = r.situacao === 'assinado';
      itens.push(['Natureza', 'Contrato de empreitada (Código Civil, arts. 610 a 626) entre o profissional e o cliente, com objeto, preço, prazo, pagamento, garantia e rescisão.']);
      itens.push(['Tipo de assinatura',
        'Assinatura eletrônica simples (Lei 14.063/2020, art. 4º, I): aceite de cada parte registrado com data, hora, IP, navegador e o código do texto aceito. Não usa certificado ICP-Brasil.']);
      itens.push(['Situação', assinadoO
        ? 'Assinado pelas duas partes' + (r.concluido_em ? ' em ' + esc(fmtData(r.concluido_em)) : '') + '.'
        : 'Ainda não tem a assinatura do cliente (' + esc(r.situacao || '—') + ').']);
      itens.push(['Valor como prova',
        'Documento eletrônico admitido como prova (CPC, arts. 439 a 441). O próprio contrato traz a cláusula em que as partes aceitam a assinatura eletrônica, como prevê a MP 2.200-2/2001 (art. 10, § 2º). Se uma parte contestar, o juiz avalia as evidências do termo de assinaturas.']);
      if (r.versao_mais_nova) itens.push(['Atenção', 'Existe uma versão mais nova (aditivo) deste contrato. Este arquivo é autêntico, mas pode não ser o que está valendo.']);
    } else if (doc && doc.tipo === 'contrato_locacao_v2') {
      var assinado = r.situacao === 'assinado';
      itens.push(['Tipo de assinatura',
        'Assinatura eletrônica simples (Lei 14.063/2020, art. 4º, I): aceite de cada parte registrado com data, hora e evidências técnicas no termo de assinaturas. Não usa certificado ICP-Brasil.']);
      itens.push(['Situação',
        assinado
          ? 'Assinado pelas duas partes' + (r.concluido_em ? ' em ' + esc(fmtData(r.concluido_em)) : '') + '.'
          : 'Ainda não tem o aceite de todas as partes (' + esc(r.situacao || '—') + ').']);
      itens.push(['Valor como prova',
        'Documento eletrônico admitido como prova (CPC, arts. 439 a 441). A MP 2.200-2/2001 (art. 10, § 2º) aceita meios de comprovação de autoria e integridade fora da ICP-Brasil quando as partes os admitem. Se uma parte contestar, a força probatória é avaliada pelo juiz a partir das evidências do termo.']);
      if (r.versao_mais_nova) itens.push(['Atenção', 'Existe uma versão mais nova deste contrato. Este arquivo é autêntico, mas pode não ser o que está valendo.']);
    } else if (doc && doc.tipo === 'servico') {
      itens.push(['O que prova', 'Que este serviço foi registrado pelo profissional no Fieldo nesta data, com este conteúdo. Serve de comprovante para garantia e para reclamação de consumo (CDC).']);
      itens.push(['O que não é', 'Não é nota fiscal nem contrato assinado pelo cliente.']);
    } else if (doc && doc.tipo === 'orcamento') {
      itens.push(['O que prova', 'Que esta proposta foi emitida pelo profissional no Fieldo nesta data, com este valor.']);
      itens.push(['Aceite', r.status === 'aprovado'
        ? 'Aprovado pelo cliente pelo link, com o nome digitado: aceite eletrônico simples.'
        : 'Sem aceite registrado do cliente (situação: ' + esc(r.status || '—') + ').']);
    }
    if (est && est.temAssinaturaDigital) {
      itens.push(['Assinatura digital no arquivo',
        'O PDF tem ' + (est.assinaturas > 1 ? est.assinaturas + ' assinaturas digitais' : 'uma assinatura digital') + ' com certificado' +
        (est.subFilter ? ' (' + esc(est.subFilter) + ')' : '') + '. Esta página não valida certificados: confira no validador oficial do ITI, ' +
        '<a href="https://validar.iti.gov.br" target="_blank" rel="noopener">validar.iti.gov.br</a>.']);
    }
    if (!itens.length) return '';
    return '<div class="vp-jur"><div class="vp-jur-tit">Validade jurídica</div><dl>' +
      itens.map(function (i) { return '<dt>' + i[0] + '</dt><dd>' + i[1] + '</dd>'; }).join('') +
      '</dl><p class="vp-aviso">Análise técnica e automática, não é parecer jurídico. Em caso de disputa, leve o PDF e esta página a um advogado.</p></div>';
  }

  /* ── tela ──────────────────────────────────────────────────────── */
  var css = '' +
    '.vp-zona{display:flex;flex-direction:column;align-items:center;gap:.4rem;text-align:center;border:1.5px dashed var(--border3);' +
      'border-radius:var(--r-xl);padding:1.25rem 1rem;margin:-0.75rem 0 1.75rem;background:var(--paper);cursor:pointer;transition:border-color .2s,background .2s}' +
    '.vp-zona:hover,.vp-zona.arrastando{border-color:var(--gold);background:var(--gold-bg)}' +
    '.vp-zona:focus-within{outline:2px solid var(--gold);outline-offset:2px}' +
    '.vp-zona strong{font-size:.92rem;font-weight:600;color:var(--text)}' +
    '.vp-zona span{font-size:.78rem;color:var(--muted);line-height:1.5}' +
    '.vp-zona input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}' +
    '.vp-ou{display:flex;align-items:center;gap:.75rem;color:var(--muted);font-size:.74rem;margin:-0.75rem 0 1rem}' +
    '.vp-ou::before,.vp-ou::after{content:"";flex:1;height:1px;background:var(--border2)}' +
    '.vp-veredito{display:flex;gap:.8rem;align-items:flex-start;margin-bottom:1.1rem}' +
    '.vp-ico{width:42px;height:42px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.15rem;font-weight:700}' +
    '.vp-ok .vp-ico{background:var(--green-bg);border:2px solid var(--green-bd);color:var(--green-l)}' +
    '.vp-alerta .vp-ico{background:var(--amber-bg);border:2px solid var(--amber-bd);color:var(--amber)}' +
    '.vp-ruim .vp-ico{background:var(--red-bg);border:2px solid var(--red-bd);color:var(--red-l)}' +
    '.vp-neutro .vp-ico{background:var(--paper3);border:2px solid var(--border2);color:var(--muted)}' +
    '.vp-tit{font-size:1.02rem;font-weight:600;line-height:1.3}' +
    '.vp-ok .vp-tit{color:var(--green-l)}.vp-alerta .vp-tit{color:var(--amber)}.vp-ruim .vp-tit{color:var(--red-l)}' +
    '.vp-sub{font-size:.82rem;color:var(--text2);line-height:1.55;margin-top:.2rem}' +
    '.vp-camadas{list-style:none;margin:0 0 1.1rem;padding:0;border-top:1px solid var(--border)}' +
    '.vp-camadas li{display:grid;grid-template-columns:1.4rem 1fr;gap:.5rem;padding:.6rem 0;border-bottom:1px solid var(--border);font-size:.84rem;line-height:1.45}' +
    '.vp-camadas b{display:block;font-weight:600;color:var(--text)}' +
    '.vp-camadas small{display:block;color:var(--muted);font-size:.78rem}' +
    '.vp-m{font-weight:700;text-align:center}.vp-m.ok{color:var(--green-l)}.vp-m.av{color:var(--amber)}.vp-m.no{color:var(--red-l)}.vp-m.na{color:var(--muted)}' +
    '.vp-checks{margin:.35rem 0 0;padding:0;list-style:none}' +
    '.vp-checks li{display:flex;gap:.4rem;padding:.1rem 0;border:0;font-size:.78rem;color:var(--text2)}' +
    '.vp-jur{background:var(--paper2);border-radius:var(--r-l);padding:1rem 1.05rem;margin-bottom:1rem}' +
    '.vp-jur-tit{font-size:.72rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-d);margin-bottom:.5rem}' +
    '.vp-jur dl{margin:0}.vp-jur dt{font-size:.8rem;font-weight:600;color:var(--text);margin-top:.6rem}.vp-jur dt:first-child{margin-top:0}' +
    '.vp-jur dd{margin:.15rem 0 0;font-size:.8rem;color:var(--text2);line-height:1.55}' +
    '.vp-jur dd strong{color:var(--amber)}' +
    '.vp-jur a{color:var(--gold-d);font-weight:600;text-decoration:underline}' +
    '.vp-aviso{font-size:.74rem;color:var(--muted);line-height:1.5;margin:.75rem 0 0}' +
    '.vp-arq{font-size:.74rem;color:var(--muted);line-height:1.6;word-break:break-all}' +
    '.vp-arq code{font-family:var(--mono);font-size:.7rem;color:var(--text2)}';

  function card(classe, icone, titulo, sub, corpo) {
    return '<div class="result-card"><div class="rc-stripe ' + (classe === 'vp-ok' ? 'valid' : classe === 'vp-ruim' ? 'invalid' : 'loading') + '"' +
      (classe === 'vp-alerta' || classe === 'vp-neutro' ? ' style="animation:none;background:var(--amber-bd)"' : '') + '></div>' +
      '<div class="rc-body ' + classe + '">' +
        '<div class="vp-veredito"><div class="vp-ico" aria-hidden="true">' + icone + '</div>' +
          '<div><div class="vp-tit" role="status">' + titulo + '</div><div class="vp-sub">' + sub + '</div></div></div>' +
        (corpo || '') +
      '</div></div>';
  }

  function linha(marca, cls, titulo, detalhe, extra) {
    return '<li><span class="vp-m ' + cls + '" aria-hidden="true">' + marca + '</span><div><b>' + titulo + '</b>' +
      (detalhe ? '<small>' + detalhe + '</small>' : '') + (extra || '') + '</div></li>';
  }

  function tipoNome(t) {
    return { contrato_locacao_v2: 'Contrato de locação', contrato_obra: 'Contrato de obra', servico: 'Relatório de serviço', orcamento: 'Orçamento' }[t] || 'Documento';
  }

  function render(nomeArquivo, a) {
    var el = document.getElementById('result');
    var doc = a.doc, est = a.est;
    var checks = a.checks || [];
    var falhas = checks.filter(function (c) { return !c.ok; });
    var alterado = est.revisoesExtras > 0;

    var camadas = '';
    camadas += a.identico
      ? linha('✓', 'ok', 'Arquivo idêntico ao original', 'Os bytes deste PDF são exatamente os do arquivo arquivado pelo Fieldo.')
      : linha('–', 'na', 'Arquivo original', doc && (doc.tipo === 'contrato_locacao_v2' || doc.tipo === 'contrato_obra')
          ? 'Não é a cópia exata do PDF arquivado (pode ser uma nova impressão ou um arquivo alterado). O conteúdo é conferido abaixo.'
          : 'Este tipo de documento é conferido pelo código e pelo conteúdo, não pelo arquivo.');
    camadas += doc
      ? linha('✓', 'ok', 'Código de autenticidade registrado', tipoNome(doc.tipo) + ' registrado em ' + esc(fmtData(doc.created_at)) + '.')
      : (a.codigos.length
          ? linha('✕', 'no', 'Código não registrado', 'O PDF tem ' + (a.codigos.length === 1 ? 'um código' : a.codigos.length + ' códigos') + ' no formato do Fieldo, mas nenhum consta no registro.')
          : linha('✕', 'no', 'Nenhum código de autenticidade', 'Não achamos o código do Fieldo no texto nem nos links do PDF.'));
    if (doc && !a.identico) {
      camadas += linha(falhas.length ? '!' : '✓', falhas.length ? 'av' : 'ok',
        falhas.length ? 'Conteúdo com divergências' : 'Conteúdo confere com o registro',
        checks.length ? null : 'Não há dados registrados para comparar.',
        checks.length ? '<ul class="vp-checks">' + checks.map(function (c) {
          return '<li><span class="vp-m ' + (c.ok ? 'ok' : 'av') + '">' + (c.ok ? '✓' : '!') + '</span>' +
            esc(c.rotulo) + ': ' + esc(c.esperado) + (c.ok ? '' : ' · não aparece no PDF') + '</li>';
        }).join('') + '</ul>' : '');
    }
    camadas += alterado
      ? linha('!', 'av', 'Arquivo salvo de novo depois de gerado', 'O PDF tem ' + est.revisoesExtras + (est.revisoesExtras === 1 ? ' revisão posterior' : ' revisões posteriores') + ' (edição, anotação ou preenchimento). Compare com o original.')
      : linha('✓', 'ok', 'Sem edições depois de gerado', 'O arquivo tem uma única versão interna' + (est.assinaturas ? ' além das assinaturas digitais' : '') + '.');

    var titulo, sub, classe, icone;
    if (doc && (a.identico || (!falhas.length && !alterado))) {
      classe = 'vp-ok'; icone = '✓';
      titulo = a.identico ? 'PDF original e íntegro' : 'Documento autêntico';
      sub = a.identico
        ? 'É exatamente o arquivo emitido pelo Fieldo. Nenhum byte foi alterado.'
        : 'O código está registrado e o conteúdo do PDF confere com o registro.';
    } else if (doc) {
      classe = 'vp-alerta'; icone = '!';
      titulo = 'Código válido, mas o PDF tem divergências';
      sub = 'O documento existe no Fieldo, mas este arquivo não bate em tudo com o registro. Peça o original a quem emitiu.';
    } else if (a.codigos.length) {
      classe = 'vp-ruim'; icone = '✕';
      titulo = 'Documento não registrado';
      sub = 'O código impresso neste PDF não existe no Fieldo. O documento pode ter sido alterado ou não ter sido emitido aqui.';
    } else {
      classe = 'vp-neutro'; icone = '?';
      titulo = 'Não dá para confirmar este PDF';
      sub = 'Ele não tem o código de autenticidade do Fieldo. Se o documento é do Fieldo, abra o link original e gere o PDF de novo, ou cole o código no campo acima.';
    }

    var meta = a.info || {};
    var arq = '<p class="vp-arq">' + esc(nomeArquivo) + ' · ' + a.paginas + (a.paginas === 1 ? ' página' : ' páginas') +
      (meta.Producer ? ' · gerado por ' + esc(String(meta.Producer).slice(0, 60)) : '') +
      '<br>SHA-256 do arquivo: <code>' + esc(a.sha) + '</code></p>' +
      '<p class="vp-aviso">O arquivo foi analisado no seu aparelho e não foi enviado. Só o SHA-256 dele e os códigos achados foram consultados.</p>';

    el.innerHTML = card(classe, icone, titulo, sub,
      '<ul class="vp-camadas">' + camadas + '</ul>' +
      (doc ? painelJuridico(doc, est, a.identico || (!falhas.length && !alterado)) : (est.temAssinaturaDigital ? painelJuridico(null, est) : '')) +
      arq);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function erro(msg) {
    document.getElementById('result').innerHTML =
      card('vp-neutro', '?', 'Não foi possível analisar', esc(msg));
  }

  function carregando(nome) {
    document.getElementById('result').innerHTML =
      '<div class="result-card"><div class="rc-stripe loading"></div><div class="rc-body">' +
        '<div class="vp-veredito"><div class="vp-ico" style="background:var(--gold-bg);border:2px solid var(--gold-bd)">…</div>' +
        '<div><div class="vp-tit" role="status" style="color:var(--gold)">Analisando o PDF…</div>' +
        '<div class="vp-sub">' + esc(nome) + ' · lendo o arquivo no seu aparelho</div></div></div></div></div>';
  }

  function analisar(file) {
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) { erro('O arquivo passa de ' + MAX_MB + ' MB.'); return; }
    carregando(file.name || 'documento.pdf');
    var bytes, est, sha;
    file.arrayBuffer().then(function (buf) {
      bytes = new Uint8Array(buf);
      est = estrutura(bytes);
      if (!est.ehPdf) throw new Error('nao_pdf');
      return crypto.subtle.digest('SHA-256', buf);
    }).then(function (d) {
      sha = hex(d);
      return Promise.all([
        rpc('verificar_pdf', { p_pdf_hash: sha }).catch(function () { return null; }),
        carregarPdfjs().then(function (lib) { return extrair(lib, bytes); })
      ]);
    }).then(function (res) {
      var porArquivo = res[0], ext = res[1];
      var cods = codigos(ext.texto, ext.links);
      var achar = porArquivo ? Promise.resolve(porArquivo) : (function proximo(i) {
        if (i >= cods.length) return Promise.resolve(null);
        return FIELDO.Hashes.verify(cods[i]).then(function (doc) { return doc || proximo(i + 1); })
          .catch(function () { return proximo(i + 1); });
      })(0);
      return achar.then(function (doc) {
        render(file.name || 'documento.pdf', {
          doc: doc, identico: !!(doc && doc.arquivo_identico), est: est, sha: sha,
          codigos: cods, checks: doc ? conferirConteudo(doc, ext.texto) : [],
          paginas: ext.paginas, info: ext.info
        });
      });
    }).catch(function (e) {
      if (e && e.message === 'nao_pdf') erro('Este arquivo não é um PDF.');
      else if (e && /password|senha/i.test(String(e.name || e.message))) erro('O PDF está protegido por senha. Abra sem a senha e envie de novo.');
      else { console.error('[verificar-pdf]', e); erro('Não conseguimos ler este PDF. Ele pode estar corrompido. Tente gerar o arquivo de novo.'); }
    });
  }

  function montar() {
    var form = document.querySelector('.search-form');
    if (!form || document.getElementById('vpZona')) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var ou = document.createElement('div'); ou.className = 'vp-ou'; ou.textContent = 'ou';
    var zona = document.createElement('label');
    zona.className = 'vp-zona'; zona.id = 'vpZona';
    zona.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:var(--gold)"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>' +
      '<strong>Enviar o PDF do documento</strong>' +
      '<span>Conferimos o código, o conteúdo e se o arquivo foi alterado.<br>O PDF é analisado no seu aparelho e não é enviado.</span>' +
      '<input type="file" id="vpArquivo" accept="application/pdf,.pdf"/>';
    form.parentNode.insertBefore(ou, form.nextSibling);
    ou.parentNode.insertBefore(zona, ou.nextSibling);
    var input = zona.querySelector('input');
    input.addEventListener('change', function () { analisar(input.files && input.files[0]); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.add('arrastando'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.remove('arrastando'); });
    });
    zona.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) analisar(f);
    });
    /* pré-carrega o leitor quando a pessoa chega perto de usar */
    zona.addEventListener('pointerenter', function () { carregarPdfjs().catch(function () {}); }, { once: true });
  }

  window.FieldoVerificarPdf = { analisar: analisar, _codigos: codigos, _estrutura: estrutura, _conferir: conferirConteudo };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
