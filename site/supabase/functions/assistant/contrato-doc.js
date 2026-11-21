// CÓPIA EXATA de locacao/contrato-doc.js (v12.24), só com o export no fim.
// O mesmo texto do contrato precisa sair igual na tela, no link do cliente,
// no PDF e aqui no assistente — o hash prova qual versão foi aceita.
// Mudou o original? Copie de novo. O teste do assistente compara os dois.
/* ============================================================
   Fieldo Locação · contrato-doc.js  v1.0
   ─────────────────────────────────────────────────────────────
   Monta o TEXTO do contrato a partir dos dados da locação e das
   cláusulas. É o mesmo módulo na tela da locadora, na página do
   cliente e no PDF — assim os três mostram exatamente o mesmo
   documento, e o hash SHA-256 do texto prova qual versão foi aceita.

   Formato do texto (simples, estável, fácil de conferir):
     "# "   título        "## "  seção        "### " cláusula
     "- "   item de lista                     demais linhas = parágrafo

   IMPORTANTE — o modelo de cláusulas abaixo é um PONTO DE PARTIDA
   genérico. Não contém política comercial da locadora: tudo que
   depende dela (pagamento, atraso, cancelamento, foro...) entra por
   campos preenchidos por ela. Revise com um profissional jurídico
   antes de usar comercialmente.
============================================================ */
var FieldoContratoDoc = (function () {
  'use strict';

  var ACEITE_VERSAO = 'aceite-v1';
  var ACEITE_CLIENTE =
    'Li o contrato acima, conferi os dados e concordo com os seus termos. Reconheço que o meu aceite ' +
    'eletrônico, com data, hora e demais informações técnicas, será registrado como evidência da contratação.';
  var ACEITE_LOCADORA =
    'Li o contrato acima, confirmo os dados da locadora e concordo com os seus termos. Reconheço que o meu aceite ' +
    'eletrônico, com data, hora e demais informações técnicas, será registrado como evidência da contratação.';

  /* Campos que as cláusulas padrão usam via {{campo}} */
  var CAMPOS_CONDICOES = [
    { campo: 'forma_pagamento',      rotulo: 'Forma e prazo de pagamento',   dica: 'Ex.: Pix no ato da retirada' },
    { campo: 'local_devolucao',      rotulo: 'Local de devolução',           dica: 'Ex.: no endereço da locadora' },
    { campo: 'multa_atraso',         rotulo: 'Cobrança por atraso',          dica: 'Descreva o que vale na sua locadora' },
    { campo: 'tolerancia_devolucao', rotulo: 'Tolerância na devolução',      dica: 'Ex.: 1 hora após o horário combinado' },
    { campo: 'cancelamento',         rotulo: 'Condições de cancelamento',    dica: 'Descreva o que vale na sua locadora' },
    { campo: 'foro',                 rotulo: 'Foro (comarca)',               dica: 'Ex.: Recife/PE' },
  ];

  /* ── formatação ─────────────────────────────────────────────── */
  function digits(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

  function limpa(s) {
    return String(s == null ? '' : s)
      .replace(/\r/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim();
  }
  function umaLinha(s) { return limpa(s).replace(/\s*\n+\s*/g, ' '); }

  function fmtDoc(s) {
    var d = digits(s);
    if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    return umaLinha(s);
  }
  function fmtTel(s) {
    var d = digits(s);
    if (d.length >= 12 && d.slice(0, 2) === '55') d = d.slice(2);
    if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    return umaLinha(s);
  }
  function brl(n) {
    if (n == null || n === '' || isNaN(Number(n))) return null;
    var v = Number(n).toFixed(2).split('.');
    v[0] = v[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return 'R$ ' + v[0] + ',' + v[1];
  }
  function fmtData(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }
  function fmtDataHora(iso) {
    try {
      return new Date(iso).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch (e) { return String(iso || ''); }
  }
  function hojeBR() {
    try { return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }); }
    catch (e) { return ''; }
  }

  /* ── CPF / CNPJ (espelha o banco) ───────────────────────────── */
  function cpfValido(p) {
    var d = digits(p), s = 0, i, dv;
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    for (i = 0; i < 9; i++) s += +d[i] * (10 - i);
    dv = (s * 10) % 11; if (dv === 10) dv = 0;
    if (dv !== +d[9]) return false;
    s = 0;
    for (i = 0; i < 10; i++) s += +d[i] * (11 - i);
    dv = (s * 10) % 11; if (dv === 10) dv = 0;
    return dv === +d[10];
  }
  function cnpjValido(p) {
    var d = digits(p), w1 = [5,4,3,2,9,8,7,6,5,4,3,2], w2 = [6,5,4,3,2,9,8,7,6,5,4,3,2], s = 0, i, r;
    if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
    for (i = 0; i < 12; i++) s += +d[i] * w1[i];
    r = s % 11; r = r < 2 ? 0 : 11 - r;
    if (r !== +d[12]) return false;
    s = 0;
    for (i = 0; i < 13; i++) s += +d[i] * w2[i];
    r = s % 11; r = r < 2 ? 0 : 11 - r;
    return r === +d[13];
  }
  function docValido(p) { return cpfValido(p) || cnpjValido(p); }

  /* ── cláusulas padrão ───────────────────────────────────────── */
  function clausulasPadrao(dados) {
    var caucao = dados && dados.locacao && Number(dados.locacao.caucao_valor) > 0;
    var c = [
      { titulo: 'Do objeto',
        texto: 'A LOCADORA cede ao LOCATÁRIO(A), a título de locação, os equipamentos descritos na seção "Equipamentos", ' +
               'que permanecem de propriedade da LOCADORA. Este contrato não transfere ao LOCATÁRIO(A) qualquer direito de ' +
               'propriedade sobre eles.' },
      { titulo: 'Do prazo',
        texto: 'A locação inicia na data de retirada e termina na data prevista de devolução indicadas no Quadro resumo. ' +
               'Qualquer prorrogação depende de acordo entre as partes, registrado por escrito antes do término do prazo.' },
      { titulo: 'Do preço e do pagamento',
        texto: 'O LOCATÁRIO(A) pagará à LOCADORA o valor total indicado no Quadro resumo. ' +
               'Forma e prazo de pagamento: {{forma_pagamento}}.' },
    ];
    if (caucao) {
      c.push({ titulo: 'Da caução',
        texto: 'Foi pactuada caução no valor indicado no Quadro resumo, como garantia das obrigações assumidas neste contrato. ' +
               'A caução será tratada após a devolução e a conferência dos equipamentos, nos termos acordados entre as partes ' +
               'e da legislação aplicável.' });
    }
    c.push(
      { titulo: 'Da entrega, retirada e devolução',
        texto: 'Os equipamentos serão retirados ou entregues conforme o Quadro resumo e devolvidos em: {{local_devolucao}}. ' +
               'O LOCATÁRIO(A) deve conferir os equipamentos no recebimento e comunicar imediatamente qualquer divergência.' },
      { titulo: 'Das obrigações da LOCADORA',
        texto: '- Entregar os equipamentos em condições de uso, de acordo com a descrição deste contrato.\n' +
               '- Prestar as orientações necessárias ao uso correto dos equipamentos.' },
      { titulo: 'Das obrigações do LOCATÁRIO(A)',
        texto: '- Utilizar os equipamentos somente para a finalidade a que se destinam e conforme as orientações recebidas.\n' +
               '- Zelar pela guarda e conservação dos equipamentos, não os emprestando, sublocando ou cedendo a terceiros sem ' +
               'autorização por escrito da LOCADORA.\n' +
               '- Comunicar imediatamente à LOCADORA qualquer defeito, dano, perda, furto ou roubo.\n' +
               '- Devolver os equipamentos na data prevista e nas mesmas condições em que os recebeu, ressalvado o desgaste ' +
               'natural decorrente do uso adequado.' },
      { titulo: 'Dos danos, perdas e extravios',
        texto: 'O LOCATÁRIO(A) responde pelos danos, perda, furto, roubo ou extravio dos equipamentos ocorridos durante a ' +
               'locação, exceto o desgaste natural decorrente do uso adequado, nos termos da legislação aplicável.' },
      { titulo: 'Do atraso na devolução',
        texto: 'Em caso de atraso na devolução, aplica-se o seguinte: {{multa_atraso}}. ' +
               'Tolerância para a devolução: {{tolerancia_devolucao}}.' },
      { titulo: 'Do cancelamento e do encerramento',
        texto: 'Condições de cancelamento: {{cancelamento}}. A locação se encerra com a devolução dos equipamentos e a sua ' +
               'conferência pela LOCADORA.' },
      { titulo: 'Da proteção de dados pessoais',
        texto: 'As partes tratarão os dados pessoais constantes deste contrato apenas para a sua execução, para o cumprimento ' +
               'de obrigações legais e para a comprovação da contratação, conforme a Lei nº 13.709/2018 (LGPD). Para comprovar ' +
               'a assinatura eletrônica serão registrados, entre outros, data e hora, endereço IP e informações do dispositivo ' +
               'utilizado.' },
      { titulo: 'Da assinatura eletrônica',
        texto: 'As partes concordam em celebrar este contrato por meio eletrônico e reconhecem que o aceite registrado, com as ' +
               'evidências descritas no termo de assinaturas, comprova a sua manifestação de vontade. A assinatura eletrônica ' +
               'adotada é a assinatura eletrônica simples (Lei nº 14.063/2020, art. 4º, I), admitida entre as partes nos termos ' +
               'do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001.' },
      { titulo: 'Do foro',
        texto: 'Fica eleito o foro da comarca de {{foro}} para dirimir quaisquer dúvidas oriundas deste contrato.' }
    );
    return c;
  }

  /* ── montagem do texto ──────────────────────────────────────── */
  function valorTotal(loc, itens) {
    if (loc && loc.valor_total != null && !isNaN(Number(loc.valor_total))) return Number(loc.valor_total);
    var soma = 0;
    for (var i = 0; i < (itens || []).length; i++) {
      if (itens[i].subtotal == null) return null;
      soma += Number(itens[i].subtotal);
    }
    return (itens && itens.length) ? soma : null;
  }

  function substituir(texto, cond, pend, tituloClausula) {
    return String(texto || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, function (_m, campo) {
      var v = cond && cond[campo] != null ? umaLinha(cond[campo]) : '';
      if (!v) {
        if (pend) pend.push({ campo: campo, clausula: tituloClausula });
        return '[PENDENTE: ' + campo + ']';
      }
      return v.replace(/[.;,\s]+$/, '');
    });
  }

  /* render(dados, clausulas, meta) → { texto, pendencias }
     meta = { numero, versao, geradoEm } */
  function render(dados, clausulas, meta) {
    dados = dados || {}; meta = meta || {};
    var loc = dados.locadora || {}, cli = dados.cliente || {}, lo = dados.locacao || {};
    var itens = dados.itens || [], cond = dados.condicoes || {};
    var pend = [], L = [];

    L.push('# CONTRATO DE LOCAÇÃO DE EQUIPAMENTOS');
    L.push('Contrato nº ' + umaLinha(meta.numero) + ' · versão ' + (meta.versao || 1));

    L.push('## 1. Partes');
    var locadora = 'LOCADORA: ' + umaLinha(loc.razao_social || loc.nome) +
      ', inscrita no CPF/CNPJ sob o nº ' + fmtDoc(loc.documento);
    if (loc.endereco) locadora += ', com endereço em ' + umaLinha(loc.endereco) +
      (loc.cidade ? ', ' + umaLinha(loc.cidade) + (loc.uf ? '/' + umaLinha(loc.uf) : '') : '');
    if (loc.email)    locadora += ', e-mail ' + umaLinha(loc.email);
    if (loc.whatsapp) locadora += ', WhatsApp ' + fmtTel(loc.whatsapp);
    if (loc.representante) locadora += ', representada por ' + umaLinha(loc.representante);
    L.push('- ' + locadora + '.');

    var locatario = 'LOCATÁRIO(A): ' + umaLinha(cli.nome) + ', CPF/CNPJ nº ' + fmtDoc(cli.documento) +
      ', telefone ' + fmtTel(cli.telefone);
    if (cli.email)    locatario += ', e-mail ' + umaLinha(cli.email);
    if (cli.endereco) locatario += ', endereço ' + umaLinha(cli.endereco);
    L.push('- ' + locatario + '.');

    L.push('## 2. Quadro resumo');
    L.push('- Retirada: ' + fmtData(lo.data_saida));
    L.push('- Devolução prevista: ' + fmtData(lo.data_prevista_devolucao) +
           (lo.diarias ? ' (' + lo.diarias + (Number(lo.diarias) === 1 ? ' diária' : ' diárias') + ')' : ''));
    if (lo.entrega_endereco) L.push('- Endereço de entrega: ' + umaLinha(lo.entrega_endereco));
    var vt = valorTotal(lo, itens);
    L.push('- Valor total da locação: ' + (vt != null ? brl(vt) : 'a combinar entre as partes'));
    if (Number(lo.caucao_valor) > 0) L.push('- Caução: ' + brl(lo.caucao_valor));

    L.push('## 3. Equipamentos');
    itens.forEach(function (it) {
      var nome = umaLinha(it.nome) || 'Equipamento';
      var det = [it.marca, it.modelo].map(umaLinha).filter(Boolean).join(' ');
      var linha = (it.quantidade || 1) + '× ' + nome + (det ? ' (' + det + ')' : '');
      if (it.preco_dia != null && brl(it.preco_dia)) linha += ' — diária ' + brl(it.preco_dia);
      if (it.subtotal != null && brl(it.subtotal))   linha += ' — subtotal ' + brl(it.subtotal);
      L.push('- ' + linha);
    });

    L.push('## 4. Cláusulas');
    (clausulas || []).forEach(function (c, i) {
      var titulo = umaLinha(c.titulo);
      L.push('### Cláusula ' + (i + 1) + (titulo ? ' — ' + titulo : ''));
      limpa(substituir(c.texto, cond, pend, titulo)).split('\n').forEach(function (p) {
        p = p.trim(); if (p) L.push(p);
      });
    });

    var obs = limpa(lo.observacoes);
    if (obs) {
      L.push('## 5. Condições específicas da locação');
      obs.split('\n').forEach(function (p) { p = p.trim(); if (p) L.push(p); });
    }

    L.push('## ' + (obs ? '6' : '5') + '. Assinatura eletrônica');
    L.push('Este contrato é assinado eletronicamente pelas partes. As assinaturas, as datas e os horários, o identificador ' +
           'do contrato e o código de integridade (hash SHA-256 deste texto) constam do termo de assinaturas que acompanha o ' +
           'documento final.');
    if (meta.geradoEm) L.push('Documento emitido em ' + umaLinha(meta.geradoEm) + '.');

    return { texto: L.join('\n'), pendencias: pend };
  }

  function docRotulo(v, quem) {
    var n = digits(v).length;
    if (!n) return 'CPF ou CNPJ ' + quem;
    if (n !== 11 && n !== 14) return 'CPF ou CNPJ ' + quem + ': tem ' + n + ' dígitos (CPF tem 11, CNPJ tem 14)';
    return (n === 11 ? 'CPF ' : 'CNPJ ') + quem + ' não confere: confira se não há dígitos trocados';
  }

  /* Campos que o contrato exige antes de enviar (espelha o servidor). */
  function validarParaEnvio(dados) {
    var f = [], cli = (dados && dados.cliente) || {}, loc = (dados && dados.locadora) || {}, lo = (dados && dados.locacao) || {};
    if (limpa(cli.nome).length < 3)              f.push({ campo: 'cliente.nome', rotulo: 'Nome do cliente' });
    /* v12.6 · "CPF/CNPJ do cliente (válido)" não dizia se faltava ou se
       estava errado — e o caso real foi um CPF com dois dígitos trocados. */
    if (!docValido(cli.documento))               f.push({ campo: 'cliente.documento', rotulo: docRotulo(cli.documento, 'do cliente') });
    if (digits(cli.telefone).length < 10)        f.push({ campo: 'cliente.telefone', rotulo: 'Telefone do cliente' });
    if (limpa(loc.razao_social || loc.nome).length < 2) f.push({ campo: 'locadora.razao_social', rotulo: 'Nome/razão social da locadora' });
    if (!docValido(loc.documento))               f.push({ campo: 'locadora.documento', rotulo: docRotulo(loc.documento, 'da locadora') });
    if (!lo.data_saida || !lo.data_prevista_devolucao) f.push({ campo: 'locacao.datas', rotulo: 'Datas da locação' });
    if (!(dados && dados.itens && dados.itens.length)) f.push({ campo: 'itens', rotulo: 'Equipamentos' });
    return f;
  }

  /* ── texto → blocos → HTML ──────────────────────────────────── */
  function blocos(texto) {
    var out = [];
    String(texto || '').split('\n').forEach(function (ln) {
      if (!ln.trim()) return;
      var m;
      if ((m = /^### (.*)$/.exec(ln)))      out.push({ t: 'h3', x: m[1] });
      else if ((m = /^## (.*)$/.exec(ln)))  out.push({ t: 'h2', x: m[1] });
      else if ((m = /^# (.*)$/.exec(ln)))   out.push({ t: 'h1', x: m[1] });
      else if ((m = /^- (.*)$/.exec(ln)))   out.push({ t: 'li', x: m[1] });
      else                                  out.push({ t: 'p',  x: ln });
    });
    return out;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toHtml(texto) {
    var h = '', emLista = false;
    blocos(texto).forEach(function (b) {
      if (b.t !== 'li' && emLista) { h += '</ul>'; emLista = false; }
      if (b.t === 'li') { if (!emLista) { h += '<ul class="ctr-ul">'; emLista = true; } h += '<li>' + esc(b.x) + '</li>'; }
      else h += '<' + (b.t === 'p' ? 'p' : b.t) + ' class="ctr-' + b.t + '">' + esc(b.x) + '</' + (b.t === 'p' ? 'p' : b.t) + '>';
    });
    if (emLista) h += '</ul>';
    return h;
  }

  function sha256(texto) {
    var subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
    if (!subtle) return Promise.reject(new Error('crypto_indisponivel'));
    return subtle.digest('SHA-256', new TextEncoder().encode(String(texto))).then(function (buf) {
      var b = new Uint8Array(buf), s = '';
      for (var i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
      return s;
    });
  }

  var api = {
    ACEITE_VERSAO: ACEITE_VERSAO, ACEITE_CLIENTE: ACEITE_CLIENTE, ACEITE_LOCADORA: ACEITE_LOCADORA,
    CAMPOS_CONDICOES: CAMPOS_CONDICOES,
    digits: digits, fmtDoc: fmtDoc, fmtTel: fmtTel, brl: brl, fmtData: fmtData, fmtDataHora: fmtDataHora, hojeBR: hojeBR,
    cpfValido: cpfValido, cnpjValido: cnpjValido, docValido: docValido,
    clausulasPadrao: clausulasPadrao, render: render, validarParaEnvio: validarParaEnvio,
    valorTotal: valorTotal, blocos: blocos, toHtml: toHtml, sha256: sha256,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();

export default FieldoContratoDoc;
