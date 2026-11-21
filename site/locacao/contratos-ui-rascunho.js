/* ============================================================
   Fieldo Locação · contratos-ui-rascunho.js  v1.0
   Tela cheia do contrato + editor do RASCUNHO (revisar dados,
   condições da locadora, cláusulas, prévia e envio).
   Carrega depois de contratos-ui.js.
============================================================ */
(function () {
  'use strict';
  var UI = LocContratosUI;
  function x() { return UI._ctx(); }
  function el(id) { return document.getElementById(id); }

  /* ── tela cheia ────────────────────────────────────────────── */
  /* chamadas internas passam por UI._sheet: o painel liga a tela às
     camadas (Voltar do celular). sheetBase é o desenho em si. */
  function sheet(titulo, html) { return UI._sheet(titulo, html); }
  function sheetBase(titulo, html) {
    var s = el('ctSheet');
    if (!s) {
      s = document.createElement('div');
      s.id = 'ctSheet'; s.className = 'ct-sheet';
      s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true');
      document.body.appendChild(s);
    }
    s.innerHTML = '<div class="ct-sheet-in"><div class="ct-sheet-bar">' +
      '<button type="button" class="btn btn--ghost btn--sm" data-ct="fechar">← Voltar</button>' +
      '<h2>' + x().esc(titulo) + '</h2></div>' + html + '</div>';
    s.style.display = '';
    s.scrollTop = 0;
    document.body.style.overflow = 'hidden';
    return s;
  }
  function fechar() {
    var s = el('ctSheet');
    if (s) { s.style.display = 'none'; s.innerHTML = ''; }
    document.body.style.overflow = '';
    x().st.aberto = null;
  }
  UI._sheet = sheetBase;
  UI._fechar = fechar;
  /* v12.19 · fecha por UI._fechar: o painel troca essa função para
     passar pela pilha de camadas (o Voltar do celular fecha o contrato
     em vez de sair do app). Sem o painel, cai no fechar() de sempre. */
  function sair() {
    if (UI._fechar !== fechar) return UI._fechar();
    fechar(); x().recarregar();
  }
  UI._acoes.fechar = function () { sair(); };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && el('ctSheet') && el('ctSheet').style.display !== 'none' &&
        !(document.getElementById('lpDlg') && document.getElementById('lpDlg').classList.contains('aberta'))) sair();
  });
  /* confirmação: a do painel (dentro do app) quando existir */
  function confirma(titulo, texto, ok, perigo) {
    if (typeof LP !== 'undefined' && LP.confirmar) return LP.confirmar({ titulo: titulo, texto: texto, ok: ok || 'Confirmar', perigo: !!perigo });
    return Promise.resolve(confirm(titulo + (texto ? '\n\n' + texto : '')));
  }
  UI._confirma = confirma;

  /* ── abrir / gerar ─────────────────────────────────────────── */
  UI._abrir = function (id) {
    var k = x();
    k.st.aberto = id;
    sheet('Contrato', '<p class="ct-meta">Carregando…</p>');
    return Promise.all([k.C.getById(id), k.C.eventos(id)]).then(function (r) {
      var c = r[0];
      if (!c) { sheet('Contrato', '<div class="ct-erro">Contrato não encontrado.</div>'); return; }
      if (c.status === 'rascunho') renderRascunho(c);
      else if (UI._detalhe) UI._detalhe(c, r[1] || []);
    }).catch(function (err) {
      console.error('[contratos] abrir', err);
      sheet('Contrato', '<div class="ct-erro">Não foi possível abrir o contrato. Verifique a conexão e tente de novo.</div>');
    });
  };

  UI.gerar = function (locacao) {
    var k = x();
    var existente = UI.contratoDaLocacao(locacao.id);
    if (existente) return UI._abrir(existente.id);
    k.toast('Montando o contrato…');
    var padrao = k.Doc.clausulasPadrao({ locacao: { caucao_valor: locacao.caucao_valor } });
    return k.C.criar(locacao.id, padrao)
      .then(function (r) { return k.recarregar().then(function () { return UI._abrir(r.contrato_id); }); })
      .catch(function (err) {
        if (err.code === 'ja_existe' && err.detalhe && err.detalhe.contrato_id) return UI._abrir(err.detalhe.contrato_id);
        k.toast(err.message || 'Não foi possível montar o contrato.');
        console.error('[contratos] gerar', err);
      });
  };

  /* ════════════════════════════════════════════════════════════
     EDITOR DO RASCUNHO — v12.19: assistente de 5 passos
     ─────────────────────────────────────────────────────────────
     Antes era uma tela só com 7 caixas e ~20 campos. Agora:
       1 Cliente · 2 Equipamentos e valores · 3 Condições ·
       4 Revisão · 5 Enviar
     Todos os campos ficam no DOM (só um passo visível): lerEdicao()
     e lerClausulas() continuam lendo tudo de uma vez, então o que é
     gravado no servidor é exatamente o mesmo de antes. Cada troca de
     passo salva o rascunho — sair e voltar não perde nada.
     As funções do banco (loc_contrato_*) não mudaram.
  ════════════════════════════════════════════════════════════ */
  var CAMPOS = {
    cliente: [
      ['nome', 'Nome completo', { req: 1 }], ['documento', 'CPF ou CNPJ', { req: 1, inputmode: 'numeric', dica: 'Só números' }],
      ['telefone', 'WhatsApp', { req: 1, inputmode: 'tel' }], ['email', 'E-mail', { type: 'email', opc: 1 }],
      ['endereco', 'Endereço', { opc: 1, dica: 'Rua, número, bairro, cidade' }]
    ],
    locadora: [
      ['razao_social', 'Nome ou razão social', { req: 1 }], ['documento', 'CPF ou CNPJ', { req: 1, inputmode: 'numeric' }],
      ['endereco', 'Endereço', { opc: 1 }], ['email', 'E-mail', { type: 'email', opc: 1 }],
      ['whatsapp', 'WhatsApp', { inputmode: 'tel', opc: 1 }], ['representante', 'Quem assina pela locadora', { opc: 1 }]
    ],
    locacao: [
      ['entrega_endereco', 'Endereço de entrega', { opc: 1, dica: 'Deixe em branco se o cliente retira' }],
      ['observacoes', 'Condições específicas desta locação', { area: 1, opc: 1 }]
    ]
  };
  var PASSOS = ['Cliente', 'Equipamentos e valores', 'Condições', 'Revisão', 'Enviar'];

  var rasc = null; /* { c, clausulas, passo, cli0 } */

  function campo(sec, chave, rotulo, valor, o) {
    var k = x(), id = 'ct_' + sec + '_' + chave;
    var attrs = ' id="' + id + '" data-sec="' + sec + '" data-key="' + chave + '"' +
      (o.inputmode ? ' inputmode="' + o.inputmode + '"' : '') + (o.dica ? ' placeholder="' + k.esc(o.dica) + '"' : '');
    var input = o.area
      ? '<textarea class="field-input" rows="3"' + attrs + '>' + k.esc(valor || '') + '</textarea>'
      : '<input class="field-input" type="' + (o.type || 'text') + '"' + attrs + ' value="' + k.esc(valor || '') + '"/>';
    return '<div class="field-group fg" id="fg_' + id + '" style="margin-bottom:.85rem"><label class="field-label" for="' + id + '">' +
      k.esc(rotulo) + (o.opc ? ' <span class="opc">(opcional)</span>' : '') + '</label>' + input + '<div class="fg-erro" hidden></div></div>';
  }
  function erroCampo(id, msg) {
    var fg = el('fg_' + id); if (!fg) return;
    fg.classList.toggle('erro', !!msg);
    var e = fg.querySelector('.fg-erro'); if (e) { e.hidden = !msg; e.textContent = msg || ''; }
  }

  function blocoClausulas() {
    var k = x();
    return rasc.clausulas.map(function (cl, i) {
      return '<div class="ct-cl">' +
        '<div class="field-group" style="margin-bottom:.45rem"><label class="field-label" for="ct_cl_t' + i + '">Cláusula ' + (i + 1) + ' — título</label>' +
        '<input class="field-input" id="ct_cl_t' + i + '" data-cl="t" data-i="' + i + '" maxlength="200" value="' + k.esc(cl.titulo) + '"/></div>' +
        '<textarea class="field-input" aria-label="Texto da cláusula ' + (i + 1) + '" data-cl="x" data-i="' + i + '" maxlength="8000" rows="4">' +
        k.esc(cl.texto) + '</textarea>' +
        '<div class="ct-acts">' +
          (i > 0 ? '<button type="button" class="btn btn--ghost btn--sm" data-ct="cl_subir" data-i="' + i + '">↑ Subir</button>' : '') +
          '<button type="button" class="btn btn--ghost btn--sm" style="color:var(--red)" data-ct="cl_remover" data-i="' + i + '">Remover</button>' +
        '</div></div>';
    }).join('') +
    '<div class="ct-acts"><button type="button" class="btn btn--ghost btn--sm" data-ct="cl_add">+ Cláusula</button>' +
    '<button type="button" class="btn btn--ghost btn--sm" data-ct="cl_padrao">Voltar ao modelo padrão</button>' +
    '<button type="button" class="btn btn--ghost btn--sm" data-ct="cl_modelo">Usar estas cláusulas nos próximos</button></div>';
  }

  function resumoLocacao(d) {
    var k = x(), lo = d.locacao || {}, itens = d.itens || [];
    var vt = k.Doc.valorTotal(lo, itens);
    return '<dl class="resumo" style="margin-bottom:.8rem">' +
      '<dt>Período</dt><dd>' + k.esc(k.Doc.fmtData(lo.data_saida)) + ' → ' + k.esc(k.Doc.fmtData(lo.data_prevista_devolucao)) +
        (lo.diarias ? ' · ' + k.esc(lo.diarias) + (lo.diarias == 1 ? ' dia' : ' dias') : '') + '</dd>' +
      '<dt>Equipamentos</dt><dd>' + itens.map(function (it) {
        return '<div class="lin"><span>' + (it.quantidade > 1 ? k.esc(it.quantidade) + '× ' : '') + k.esc(it.nome || 'equipamento') + '</span><span>' +
          (it.subtotal != null ? k.esc(k.Doc.brl(it.subtotal)) : '') + '</span></div>';
      }).join('') + '</dd>' +
      '<dt>Valor total</dt><dd>' + (vt != null ? k.esc(k.Doc.brl(vt)) : '—') + '</dd>' +
      '<dt>Caução</dt><dd>' + (lo.caucao_valor ? k.esc(k.Doc.brl(lo.caucao_valor)) : 'Sem caução') + '</dd></dl>';
  }

  function locadoraCompleta(d) {
    var l = d.locadora || {};
    return (String(l.razao_social || l.nome || '').trim().length >= 2) && x().Doc.docValido(l.documento);
  }

  function renderRascunho(c) {
    var k = x(), d = c.dados || {};
    rasc = { c: c, passo: 1, clausulas: (c.clausulas || []).map(function (cl) { return { titulo: cl.titulo || '', texto: cl.texto || '' }; }),
             cli0: JSON.stringify(['nome', 'documento', 'telefone', 'email'].map(function (f) { return (d.cliente || {})[f] || ''; })) };
    var locOk = locadoraCompleta(d);
    var perfilVazio = typeof LP !== 'undefined' && LP.st && LP.st.locadora && !(LP.st.locadora.cnpj);

    var html =
      '<div class="wz-passos" id="ctBarra">' + PASSOS.map(function (p, i) { return '<i data-ct="rc_ir" data-p="' + (i + 1) + '" title="' + k.esc(p) + '" style="cursor:pointer"></i>'; }).join('') + '</div>' +
      '<div class="wz-onde" id="ctOnde"></div>' +

      /* 1 — cliente */
      '<div class="wz-etapa" data-ctp="1"><h3 class="wz-tit">Confira o cliente</h3>' +
        '<p class="wz-sub">Vieram da locação. O que você corrigir aqui também é corrigido na locação.</p>' +
        '<div class="ct-box">' + CAMPOS.cliente.map(function (f) { return campo('cliente', f[0], f[1], (d.cliente || {})[f[0]], f[2]); }).join('') + '</div>' +
      '</div>' +

      /* 2 — locação */
      '<div class="wz-etapa" data-ctp="2"><h3 class="wz-tit">Equipamentos, período e valores</h3>' +
        '<p class="wz-sub">Vêm da locação e entram no contrato assim. Algo errado? Corrija na locação.</p>' +
        '<div id="ctResumoLoc">' + resumoLocacao(d) + '</div>' +
        '<div class="ct-acts" style="margin:0 0 1rem"><button type="button" class="btn btn--ghost btn--sm" data-ct="rc_editar_loc">Corrigir na locação</button>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-ct="rc_resync">Trazer dados atualizados da locação</button></div>' +
        '<div class="ct-box">' + campo('locacao', 'entrega_endereco', CAMPOS.locacao[0][1], (d.locacao || {}).entrega_endereco, CAMPOS.locacao[0][2]) + '</div>' +
      '</div>' +

      /* 3 — condições */
      '<div class="wz-etapa" data-ctp="3"><h3 class="wz-tit">Condições do aluguel</h3>' +
        '<p class="wz-sub">' + (perfilVazio ? 'Preencha uma vez: marcando a opção abaixo, os próximos contratos já saem preenchidos.' : 'Vieram do seu perfil. Mude só o que for diferente nesta locação.') + '</p>' +
        '<details class="ct-box" id="ctLocBox"' + (locOk ? '' : ' open') + '><summary style="cursor:pointer;font-weight:600">Dados da locadora' +
          (locOk ? ' <span style="font-weight:400;color:var(--muted)">· ' + k.esc((d.locadora || {}).razao_social || (d.locadora || {}).nome || '') + '</span>' : ' <span style="font-weight:400;color:var(--red)">· faltam dados</span>') + '</summary>' +
          '<div style="margin-top:.8rem">' + CAMPOS.locadora.map(function (f) { return campo('locadora', f[0], f[1], (d.locadora || {})[f[0]], f[2]); }).join('') + '</div></details>' +
        '<div class="ct-box"><h3>Pagamento, devolução e regras</h3>' +
          '<p class="ct-meta" style="margin-top:0">Deixe em branco o que não vale na sua locadora. Se uma cláusula usar um campo em branco, a revisão avisa.</p>' +
          k.Doc.CAMPOS_CONDICOES.map(function (f) {
            return campo('condicoes', f.campo, f.rotulo, (d.condicoes || {})[f.campo], { dica: f.dica, opc: 1 });
          }).join('') +
          campo('locacao', 'observacoes', CAMPOS.locacao[1][1], (d.locacao || {}).observacoes, CAMPOS.locacao[1][2]) + '</div>' +
        (typeof LP !== 'undefined' && LP.st ? '<label class="lp-check"><input type="checkbox" id="ctSalvarPerfil"' + (perfilVazio ? ' checked' : '') + '/><span><strong>Usar estes dados nos próximos contratos</strong> (salva os dados da locadora e as condições no Meu perfil)</span></label>' : '') +
        '<details class="ct-box"><summary style="cursor:pointer;font-weight:600">Cláusulas do contrato <span style="font-weight:400;color:var(--muted)">· avançado</span></summary>' +
          '<p class="ct-meta">O modelo é um ponto de partida e deve ser revisado por um profissional jurídico antes do uso comercial.</p>' +
          '<div id="ctClausulas">' + blocoClausulas() + '</div></details>' +
      '</div>' +

      /* 4 — revisão */
      '<div class="wz-etapa" data-ctp="4"><h3 class="wz-tit">Revise o contrato</h3>' +
        '<p class="wz-sub">É exatamente este texto que o cliente vai ler e assinar.</p>' +
        '<div id="ctPend"></div><div class="ct-doc" id="ctPrevia" style="max-height:none"></div>' +
      '</div>' +

      /* 5 — enviar */
      '<div class="wz-etapa" data-ctp="5"><h3 class="wz-tit">Enviar para assinatura</h3>' +
        '<p class="wz-sub">Você gera um link e manda pelo WhatsApp. O cliente confere e assina pelo celular, sem instalar nada.</p>' +
        '<ol class="ct-hist" style="font-family:var(--sans);font-size:.88rem;color:var(--text2);padding-left:1.2rem;margin:0 0 1rem;line-height:1.7">' +
          '<li>Você gera o link e envia ao cliente.</li><li>O cliente abre, confere e assina.</li><li>Você assina também (antes ou depois dele).</li><li>O PDF assinado fica guardado aqui.</li></ol>' +
        '<div class="field-group fg" style="margin-bottom:1rem"><label class="field-label" for="ctValidade">O link vale por</label>' +
        '<select class="field-select" id="ctValidade"><option value="3">3 dias</option><option value="7" selected>7 dias</option>' +
        '<option value="15">15 dias</option><option value="30">30 dias</option></select></div>' +
        '<p style="margin:1.4rem 0 0;text-align:center"><button type="button" class="link-perigo" data-ct="rc_cancelar">Descartar este rascunho</button></p>' +
      '</div>' +
      '<div class="ct-pe"><div class="ct-pe-in" id="ctPe"></div></div>';

    sheet('Contrato ' + c.numero, html);
    irPasso(1, true);
  }

  function rodape() {
    var p = rasc.passo, ult = p === PASSOS.length;
    el('ctPe').innerHTML =
      (p > 1 ? '<button type="button" class="btn btn--ghost" data-ct="rc_voltar">← Voltar</button>'
             : '<button type="button" class="btn btn--ghost" data-ct="fechar">Sair</button>') +
      (ult ? '<button type="button" class="btn btn--primary" data-ct="rc_enviar" id="ctBtnEnviar">Gerar link de assinatura</button>'
           : '<button type="button" class="btn btn--primary" data-ct="rc_continuar" id="ctBtnCont">' + (p === 4 ? 'Está certo, continuar' : 'Continuar') + '</button>');
  }

  function irPasso(p, semSalvar) {
    rasc.passo = p;
    var etapas = document.querySelectorAll('#ctSheet .wz-etapa');
    for (var i = 0; i < etapas.length; i++) etapas[i].classList.toggle('ativa', +etapas[i].getAttribute('data-ctp') === p);
    var bs = el('ctBarra').children;
    for (var j = 0; j < bs.length; j++) bs[j].className = j < p ? 'ok' : '';
    el('ctOnde').innerHTML = 'Passo <b>' + p + ' de ' + PASSOS.length + '</b> · ' + PASSOS[p - 1] + ' · <span style="color:var(--muted)">' + x().esc(rasc.c.numero) + '</span>';
    if (p === 4) previa();
    rodape();
    if (el('ctSheet')) el('ctSheet').scrollTop = 0;
    if (!semSalvar) salvar(false).catch(function (err) { if (err.message !== 'cl_vazia') console.error('[contratos] autosave', err); });
  }

  /* ── leitura do formulário ─────────────────────────────────── */
  function lerEdicao() {
    var e = { cliente: {}, locadora: {}, condicoes: {}, locacao: {} };
    var nos = document.querySelectorAll('#ctSheet [data-sec]');
    for (var i = 0; i < nos.length; i++) {
      var v = (nos[i].value || '').trim();
      e[nos[i].getAttribute('data-sec')][nos[i].getAttribute('data-key')] = v || null;
    }
    return e;
  }
  function lerClausulas() {
    var out = [];
    var ts = document.querySelectorAll('#ctSheet [data-cl="t"]');
    for (var i = 0; i < ts.length; i++) {
      var idx = ts[i].getAttribute('data-i');
      var tx = document.querySelector('#ctSheet [data-cl="x"][data-i="' + idx + '"]');
      out.push({ titulo: (ts[i].value || '').trim(), texto: ((tx && tx.value) || '').trim() });
    }
    return out;
  }
  function aplicar(dados, ed) {
    var d = JSON.parse(JSON.stringify(dados || {}));
    Object.keys(ed).forEach(function (sec) {
      d[sec] = d[sec] || {};
      Object.keys(ed[sec]).forEach(function (k) { d[sec][k] = ed[sec][k]; });
    });
    return d;
  }

  /* ── prévia + pendências ───────────────────────────────────── */
  function montar() {
    var k = x(), ed = lerEdicao();
    rasc.clausulas = lerClausulas();
    var dados = aplicar(rasc.c.dados, ed);
    var r = k.Doc.render(dados, rasc.clausulas, { numero: rasc.c.numero, versao: rasc.c.versao, geradoEm: k.Doc.hojeBR() });
    return { ed: ed, dados: dados, r: r, faltam: k.Doc.validarParaEnvio(dados) };
  }
  function passoDoCampo(campo) {
    if (/^cliente\./.test(campo)) return 1;
    if (/^locacao\.datas|^itens/.test(campo)) return 2;
    return 3;
  }

  function previa() {
    var k = x(), m = montar(), p = el('ctPend');
    var itens = m.faltam.map(function (f) { return { t: f.rotulo, p: passoDoCampo(f.campo) }; })
      .concat(m.r.pendencias.map(function (pd) {
        var def = k.Doc.CAMPOS_CONDICOES.filter(function (c) { return c.campo === pd.campo; })[0];
        return { t: (def ? def.rotulo : pd.campo) + ' (usado na cláusula “' + pd.clausula + '”)', p: 3 };
      }));
    if (p) p.innerHTML = itens.length
      ? '<div class="ct-aviso"><strong>Falta para enviar:</strong>' + itens.map(function (i) {
          return '<div style="display:flex;justify-content:space-between;gap:.6rem;align-items:center;margin-top:.35rem"><span>' + k.esc(i.t) + '</span>' +
            '<button type="button" class="btn btn--ghost btn--sm" data-ct="rc_ir" data-p="' + i.p + '">Corrigir</button></div>';
        }).join('') + '</div>'
      : '<div class="ct-ok">Tudo preenchido. Leia o contrato abaixo e continue.</div>';
    if (el('ctPrevia')) el('ctPrevia').innerHTML = k.Doc.toHtml(m.r.texto);
    return { m: m, ok: !itens.length };
  }

  /* ── validação por passo (os obrigatórios do envio) ────────── */
  function validarPasso(p) {
    var k = x(), ed = lerEdicao(), ok = true, primeiro = null;
    function falha(id, msg) { erroCampo(id, msg); ok = false; primeiro = primeiro || id; }
    if (p === 1) {
      ['nome', 'documento', 'telefone'].forEach(function (f) { erroCampo('ct_cliente_' + f, ''); });
      if (String(ed.cliente.nome || '').length < 3) falha('ct_cliente_nome', 'Informe o nome completo.');
      if (!k.Doc.docValido(ed.cliente.documento)) falha('ct_cliente_documento', ed.cliente.documento ? 'Este CPF ou CNPJ não confere. Confira os números.' : 'O contrato precisa do CPF ou CNPJ do cliente.');
      if (String(ed.cliente.telefone || '').replace(/\D/g, '').length < 10) falha('ct_cliente_telefone', 'Informe o WhatsApp com DDD.');
    }
    if (p === 3) {
      ['razao_social', 'documento'].forEach(function (f) { erroCampo('ct_locadora_' + f, ''); });
      var nome = ed.locadora.razao_social || (rasc.c.dados.locadora || {}).nome;
      if (String(nome || '').length < 2) falha('ct_locadora_razao_social', 'Informe o nome ou a razão social.');
      if (!k.Doc.docValido(ed.locadora.documento)) falha('ct_locadora_documento', ed.locadora.documento ? 'Este CPF ou CNPJ não confere.' : 'O contrato precisa do seu CPF ou CNPJ.');
      if (!ok && el('ctLocBox')) el('ctLocBox').open = true;
    }
    if (primeiro && el(primeiro)) { el(primeiro).focus(); el(primeiro).scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    return ok;
  }

  /* passo 1: o que mudou no cliente vai também para a locação, e o
     rascunho é ressincronizado (senão o envio recusaria com
     "locacao_mudou", porque a origem da locação mudou) */
  function sincronizarCliente() {
    var ed = lerEdicao(), cli = ed.cliente;
    var agora = JSON.stringify([cli.nome || '', cli.documento || '', cli.telefone || '', cli.email || '']);
    if (agora === rasc.cli0 || typeof FIELDO_LOCACAO === 'undefined') return salvar(false);
    var dig = function (s) { return String(s || '').replace(/\D/g, '') || null; };
    return FIELDO_LOCACAO.Locacoes.update(rasc.c.locacao_id, {
      client_name: cli.nome, client_doc: dig(cli.documento), client_phone: cli.telefone, client_email: cli.email
    }).then(function () { rasc.cli0 = agora; return salvar(true); })
      .then(function () { if (typeof LP !== 'undefined' && LP.recarregar) LP.recarregar(); });
  }

  /* passo 3: "usar nos próximos" grava locadora + condições no perfil */
  function salvarNoPerfil() {
    var box = el('ctSalvarPerfil');
    if (!box || !box.checked || typeof FIELDO_LOCACAO === 'undefined') return Promise.resolve();
    var k = x(), ed = lerEdicao(), lo = ed.locadora;
    var tarefas = [FIELDO_LOCACAO.Locadoras.update({
      razao_social: lo.razao_social, cnpj: String(lo.documento || '').replace(/\D/g, '') || null,
      endereco: lo.endereco, email: lo.email
    }).then(function (l) { if (l && typeof LP !== 'undefined') LP.st.locadora = l; })];
    var cond = {};
    Object.keys(ed.condicoes).forEach(function (c) { if (ed.condicoes[c]) cond[c] = ed.condicoes[c]; });
    var cl = (typeof LP !== 'undefined' && LP.st.modelo && LP.st.modelo.clausulas) || [];
    tarefas.push(k.C.modeloSalvar(cl, cond).then(function () { if (typeof LP !== 'undefined') LP.st.modelo = { clausulas: cl, condicoes: cond }; }));
    return Promise.all(tarefas).then(function () { box.checked = false; k.toast('Salvo no seu perfil: os próximos contratos já saem preenchidos.'); });
  }

  /* ── ações ─────────────────────────────────────────────────── */
  var A = UI._acoes;

  A.rc_ir = function (b) { irPasso(+b.getAttribute('data-p')); };
  A.rc_voltar = function () { irPasso(Math.max(1, rasc.passo - 1)); };
  A.rc_continuar = function () {
    var k = x(), p = rasc.passo, btn = el('ctBtnCont');
    if (!validarPasso(p)) return;
    if (p === 1 || p === 3) {
      btn.disabled = true; btn.textContent = 'Salvando…';
      var op = p === 1 ? sincronizarCliente() : salvarNoPerfil().then(function () { return salvar(false); });
      op.then(function () { irPasso(p + 1, true); })
        .catch(function (err) {
          btn.disabled = false; btn.textContent = 'Continuar';
          if (err.message !== 'cl_vazia') k.toast(err.message || 'Não deu para salvar. Confira a internet.');
        });
      return;
    }
    irPasso(p + 1);
  };

  A.cl_add = function () {
    rasc.clausulas = lerClausulas();
    rasc.clausulas.push({ titulo: '', texto: '' });
    el('ctClausulas').innerHTML = blocoClausulas();
  };
  A.cl_remover = function (b) {
    rasc.clausulas = lerClausulas();
    var i = +b.getAttribute('data-i');
    confirma('Remover a cláusula ' + (i + 1) + '?', '', 'Remover', true).then(function (ok) {
      if (!ok) return;
      rasc.clausulas.splice(i, 1);
      el('ctClausulas').innerHTML = blocoClausulas();
    });
  };
  A.cl_subir = function (b) {
    rasc.clausulas = lerClausulas();
    var i = +b.getAttribute('data-i'), t = rasc.clausulas[i];
    rasc.clausulas[i] = rasc.clausulas[i - 1]; rasc.clausulas[i - 1] = t;
    el('ctClausulas').innerHTML = blocoClausulas();
  };
  A.cl_padrao = function () {
    confirma('Voltar ao modelo padrão?', 'As cláusulas atuais deste contrato são substituídas pelo modelo do Fieldo.', 'Substituir').then(function (ok) {
      if (!ok) return;
      rasc.clausulas = x().Doc.clausulasPadrao(rasc.c.dados);
      el('ctClausulas').innerHTML = blocoClausulas();
    });
  };
  A.cl_modelo = function () {
    var k = x(), m = montar();
    k.C.modeloSalvar(rasc.clausulas, m.ed.condicoes)
      .then(function () {
        if (typeof LP !== 'undefined' && LP.st) LP.st.modelo = { clausulas: rasc.clausulas.slice(), condicoes: m.ed.condicoes };
        k.toast('Pronto. Os próximos contratos já começam com estas cláusulas.');
      })
      .catch(function (err) { k.toast(err.message); });
  };

  function salvar(resync) {
    var k = x(), m = montar(), ok = true;
    rasc.clausulas.forEach(function (cl) { if (!cl.titulo && !cl.texto) ok = false; });
    if (!ok) { k.toast('Há uma cláusula vazia. Preencha ou remova (passo 3, Cláusulas).'); return Promise.reject(new Error('cl_vazia')); }
    return k.C.salvar(rasc.c.id, m.ed, rasc.clausulas, resync);
  }
  UI._salvarRascunho = function () { return rasc ? salvar(false) : Promise.resolve(); };

  A.rc_salvar = function () {
    var k = x();
    salvar(false).then(function () { k.toast('Rascunho salvo.'); })
      .catch(function (err) { if (err.message !== 'cl_vazia') k.toast(err.message); });
  };
  A.rc_resync = function () {
    var k = x(), passo = rasc.passo;
    salvar(true).then(function () { return k.C.getById(rasc.c.id); })
      .then(function (c) {
        if (!c) return;
        rasc.c = c;
        if (el('ctResumoLoc')) el('ctResumoLoc').innerHTML = resumoLocacao(c.dados || {});
        k.toast('Dados atualizados com a locação.');
        if (passo !== 2) UI._abrir(c.id);
      })
      .catch(function (err) { if (err.message !== 'cl_vazia') k.toast(err.message); });
  };
  A.rc_editar_loc = function () {
    var k = x(), id = rasc.c.locacao_id;
    if (typeof LP === 'undefined' || !LP.locWizard) return k.toast('Abra a locação na aba Locações para corrigir.');
    salvar(false).catch(function () {}).then(function () { return UI._fechar(); })
      .then(function () { LP.locWizard({ id: id, voltarContrato: rasc.c.id }); });
  };
  A.rc_cancelar = function () {
    var k = x();
    confirma('Descartar este rascunho?', 'Ele fica no histórico como cancelado. A locação não muda.', 'Descartar', true).then(function (ok) {
      if (!ok) return;
      k.C.cancelar(rasc.c.id, 'Rascunho descartado')
        .then(function () { k.toast('Rascunho descartado.'); sair(); })
        .catch(function (err) { k.toast(err.message); });
    });
  };

  A.rc_enviar = function () {
    var k = x(), v = previa(), btn = el('ctBtnEnviar');
    if (!v.ok) { k.toast('Falta completar alguns dados. Veja a lista na revisão.'); irPasso(4, true); return; }
    var dias = parseInt(el('ctValidade').value, 10) || 7;
    btn.disabled = true; btn.textContent = 'Gerando link…';
    salvar(false)
      .then(function () { return k.C.getById(rasc.c.id); })
      .then(function (c) {
        /* texto final montado a partir do que o SERVIDOR gravou */
        var r = k.Doc.render(c.dados, c.clausulas, { numero: c.numero, versao: c.versao, geradoEm: k.Doc.hojeBR() });
        if (r.pendencias.length) throw new Error('Ainda há campos pendentes nas cláusulas.');
        return k.C.enviar(c.id, r.texto, dias);
      })
      .then(function () {
        k.st.recemEnviado = rasc.c.id;
        k.toast('Link gerado. Agora envie ao cliente.');
        return k.recarregar().then(function () { return UI._abrir(rasc.c.id); });
      })
      .catch(function (err) {
        btn.disabled = false; btn.textContent = 'Gerar link de assinatura';
        if (err.message === 'cl_vazia') return;
        if (err.code === 'campos_invalidos' && err.detalhe && err.detalhe.campos) {
          irPasso(4, true);
          el('ctPend').innerHTML = '<div class="ct-erro"><strong>Faltam dados:</strong> ' + err.detalhe.campos.map(k.esc).join(', ') + '</div>';
          return;
        }
        if (err.code === 'locacao_mudou') {
          irPasso(2, true);
          k.toast('A locação mudou depois que o contrato foi montado. Toque em “Trazer dados atualizados da locação”.', 5000);
          return;
        }
        k.toast(err.message || 'Não deu para gerar o link. Confira a internet.');
      });
  };
})();
