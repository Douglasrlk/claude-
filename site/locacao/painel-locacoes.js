/* ============================================================
   Fieldo Locação · painel-locacoes.js  v12.19
   Locações: filtros por situação, cartões com a ação do momento,
   assistente de 4 passos (cliente → datas → equipamentos → revisão)
   para registrar E para editar, devolução com data e destino da
   caução, e o "Novo contrato" da aba Contratos.

   Regras que continuam onde estavam (db.locacao.js): diárias, status
   visível, e agora a disponibilidade por período (decisão do dono,
   30/10): uma locação só ocupa o equipamento entre a retirada e a
   devolução prevista — ou até hoje, se atrasou.
============================================================ */
(function () {
  'use strict';
  var esc = LP.esc, q = LP.q;
  var COR = { reservada: 'amber', em_andamento: 'green', atrasada: 'red', devolvida: 'gray', cancelada: 'gray' };
  var FILTROS = [
    { id: 'ativas', rot: 'Ativas' }, { id: 'atrasada', rot: 'Atrasadas' }, { id: 'em_andamento', rot: 'Em uso' },
    { id: 'reservada', rot: 'Reservadas' }, { id: 'encerradas', rot: 'Encerradas' },
  ];

  function itensTxt(l) {
    return (l.locacao_itens || []).map(function (it) {
      var n = (it.equipamentos && it.equipamentos.nome) || 'equipamento removido';
      return (it.quantidade > 1 ? it.quantidade + '× ' : '') + n;
    }).join(', ');
  }
  function frase(l, vis, hoje) {
    if (vis === 'atrasada') { var a = LP.diasEntre(l.data_prevista_devolucao, hoje); return 'Atrasada há ' + LP.emDias(a) + ' · devolução era ' + LP.fmtData(l.data_prevista_devolucao); }
    if (vis === 'em_andamento') { var r = LP.diasEntre(hoje, l.data_prevista_devolucao); return r === 0 ? 'Devolve hoje' : r === 1 ? 'Devolve amanhã' : 'Devolve em ' + LP.emDias(r) + ' · ' + LP.fmtData(l.data_prevista_devolucao); }
    if (vis === 'reservada') { var s = LP.diasEntre(hoje, l.data_saida); return s === 0 ? 'Retirada hoje' : s === 1 ? 'Retirada amanhã' : 'Retirada em ' + LP.emDias(s) + ' · ' + LP.fmtData(l.data_saida); }
    if (vis === 'devolvida') return 'Devolvida em ' + LP.fmtData(l.data_devolucao || l.data_prevista_devolucao);
    return 'Cancelada';
  }
  function linkWhats(l, vis) {
    if (!l.client_phone) return '';
    var nome = (l.client_name || '').trim().split(/\s+/)[0] || '', loja = (LP.st.locadora && LP.st.locadora.nome) || 'a locadora';
    var oQue = (l.locacao_itens || []).map(function (it) { return (it.equipamentos && it.equipamentos.nome) || ''; }).filter(Boolean).join(', ') || 'o equipamento';
    var oi = 'Olá' + (nome ? ', ' + nome : '') + '! Aqui é ' + loja + '. ';
    var msg = vis === 'atrasada' ? oi + 'A devolução de ' + oQue + ' estava prevista para ' + LP.fmtData(l.data_prevista_devolucao) + '. Consegue devolver hoje? Se precisar de mais dias, me avise para combinarmos.'
      : vis === 'reservada' ? oi + 'Confirmando a retirada de ' + oQue + ' em ' + LP.fmtData(l.data_saida) + '. Está tudo certo?'
      : oi + 'Lembrando que a devolução de ' + oQue + ' está prevista para ' + LP.fmtData(l.data_prevista_devolucao) + '.';
    return FIELDO.UI.waLink(l.client_phone, msg);
  }
  LP.rotuloContrato = function (c) {
    return ({ rascunho: 'Contrato em rascunho', aguardando_cliente: 'Contrato esperando o cliente assinar',
              aguardando_locadora: 'Contrato: falta a sua assinatura', assinado: 'Contrato assinado' })[c.status] || 'Contrato';
  };

  function passaFiltro(vis, f) {
    if (f === 'ativas') return vis === 'atrasada' || vis === 'em_andamento' || vis === 'reservada';
    if (f === 'encerradas') return vis === 'devolvida' || vis === 'cancelada';
    return vis === f;
  }

  LP.abas.locacoes = function (el) {
    var cs = LP.comStatus(), c = LP.contagens(), hoje = LP.D.hojeLocal();
    var f = LP.st.filtroLoc || 'ativas';
    var cont = { ativas: c.ativas, atrasada: c.atrasadas, em_andamento: c.emUso, reservada: c.reservadas, encerradas: c.encerradas };
    var html = '<div class="lp-cab"><div><h1>Locações</h1><p>Aqui você controla as retiradas e devoluções.</p></div>' +
      '<button type="button" class="btn btn--primary" data-acao="nova-locacao">+ Nova locação</button></div>' +
      LP.dicaHTML('locacoes', 'Registre quem levou o quê e quando devolve. A cor mostra a situação: <strong style="color:var(--amber)">reservada</strong>, <strong style="color:var(--green)">em uso</strong> e <strong style="color:var(--red)">atrasada</strong>.');
    if (!cs.length) {
      html += '<div class="lp-vazio"><h3>Nenhuma locação ainda</h3><p>' + ((LP.st.equip || []).length
        ? 'Registre a primeira: cliente, datas e equipamentos. O valor é calculado sozinho.'
        : 'Primeiro cadastre um equipamento. Depois registre as locações por aqui.') + '</p>' +
        ((LP.st.equip || []).length ? '<button type="button" class="btn btn--primary" data-acao="nova-locacao">Registrar a primeira</button>'
          : '<button type="button" class="btn btn--primary" data-acao="novo-equip">Cadastrar equipamento</button>') + '</div>';
      el.innerHTML = html; return;
    }
    html += '<div class="lp-chips" role="group" aria-label="Filtrar locações">' + FILTROS.map(function (x) {
      return '<button type="button" class="lp-chip' + (x.id === 'atrasada' && cont.atrasada ? ' alerta' : '') + '" data-lc-filtro="' + x.id + '" aria-pressed="' + (f === x.id) + '">' +
        esc(x.rot) + '<span class="n">' + (cont[x.id] || 0) + '</span></button>';
    }).join('') + '</div>';
    var peso = { atrasada: 0, em_andamento: 1, reservada: 2, devolvida: 3, cancelada: 4 };
    var vis = cs.filter(function (x) { return passaFiltro(x.vis, f); }).sort(function (a, b) {
      var p = peso[a.vis] - peso[b.vis]; if (p) return p;
      if (a.vis === 'em_andamento' || a.vis === 'atrasada') return String(a.loc.data_prevista_devolucao).localeCompare(b.loc.data_prevista_devolucao);
      if (a.vis === 'reservada') return String(a.loc.data_saida).localeCompare(b.loc.data_saida);
      return String(b.loc.data_devolucao || b.loc.data_prevista_devolucao).localeCompare(a.loc.data_devolucao || a.loc.data_prevista_devolucao);
    });
    if (!vis.length) {
      html += '<div class="lp-vazio" style="padding:1.4rem"><p style="margin:0">' +
        ({ ativas: 'Nenhuma locação ativa agora.', atrasada: 'Nenhuma locação atrasada. Ótimo!', em_andamento: 'Nenhum equipamento com cliente agora.', reservada: 'Nenhuma reserva para os próximos dias.', encerradas: 'Nenhuma locação encerrada ainda.' })[f] + '</p></div>';
    }
    html += vis.map(function (x) { return cartao(x.loc, x.vis, hoje); }).join('');
    el.innerHTML = html;
  };

  function cartao(l, vis, hoje) {
    var enc = l.status === 'devolvida' || l.status === 'cancelada', wa = linkWhats(l, vis), ct = LP.contratoDe(l.id), id = esc(l.id);
    var acoes = '';
    if (vis === 'atrasada') {
      if (wa) acoes += '<a class="btn btn--wa btn--sm princ" href="' + esc(wa) + '" target="_blank" rel="noopener">' + LP.ICONE_WA + 'Cobrar devolução</a>';
      acoes += '<button type="button" class="btn btn--ghost btn--sm' + (wa ? '' : ' princ') + '" data-lc="devolver" data-id="' + id + '">Marcar devolvida</button>';
    } else if (vis === 'em_andamento') {
      acoes += '<button type="button" class="btn btn--primary btn--sm princ" data-lc="devolver" data-id="' + id + '">Marcar devolvida</button>';
      if (wa) acoes += '<a class="btn btn--wa-sec btn--sm" href="' + esc(wa) + '" target="_blank" rel="noopener">' + LP.ICONE_WA + 'WhatsApp</a>';
    } else if (vis === 'reservada') {
      if (wa) acoes += '<a class="btn btn--wa-sec btn--sm princ" href="' + esc(wa) + '" target="_blank" rel="noopener">' + LP.ICONE_WA + 'Confirmar retirada</a>';
    }
    if (l.status !== 'cancelada' && (ct || !enc)) {
      acoes += '<button type="button" class="btn btn--ghost btn--sm" data-lc="contrato" data-id="' + id + '">' + (ct ? 'Ver contrato' : 'Gerar contrato') + '</button>';
    }
    var tags = '<span class="status-pill ' + (COR[vis] || 'gray') + '">' + esc(LP.D.rotulo(vis)) + '</span>';
    if (l.caucao_valor) {
      var cst = { pendente: 'com você', devolvida: 'devolvida', retida: 'retida', abatida: 'abatida' }[l.caucao_status] || l.caucao_status || '';
      tags += '<span class="status-pill gray">caução ' + esc(LP.brl(l.caucao_valor)) + (cst ? ' · ' + esc(cst) : '') + '</span>';
    }
    return '<div class="lc-card st-' + esc(vis) + '">' +
      '<div class="lc-top"><div style="min-width:0"><div class="lc-cli">' + esc(l.client_name) + '</div>' +
        '<div class="lc-itens">' + esc(itensTxt(l)) + '</div>' +
        '<div class="lc-datas">' + esc(LP.fmtData(l.data_saida)) + ' → ' + esc(LP.fmtData(l.data_devolucao || l.data_prevista_devolucao)) + '</div></div>' +
        (l.valor_total != null ? '<div class="lc-valor">' + esc(LP.brl(l.valor_total)) + '</div>' : '') + '</div>' +
      '<div class="lc-quando">' + esc(frase(l, vis, hoje)) + '</div>' +
      '<div class="lc-tags">' + tags + '</div>' +
      (acoes ? '<div class="lc-acts">' + acoes + '</div>' : '') +
      '<div class="lc-rodape"><span' + (ct && ct.status === 'aguardando_locadora' ? ' class="alerta"' : '') + '>' + (ct ? esc(LP.rotuloContrato(ct)) : '') + '</span>' +
        (!enc ? '<span><button type="button" class="link-acao" data-lc="editar" data-id="' + id + '">Editar</button> &nbsp; ' +
          '<button type="button" class="link-perigo" data-lc="cancelar" data-id="' + id + '">' + (vis === 'reservada' ? 'Cancelar reserva' : 'Cancelar') + '</button></span>' : '') +
      '</div></div>';
  }

  function loc(id) { return (LP.st.locacoes || []).filter(function (x) { return x.id === id; })[0] || null; }

  /* ── devolução e cancelamento ───────────────────────────────── */
  function devolver(id) {
    var l = loc(id); if (!l) return;
    var hoje = LP.D.hojeLocal();
    var html = '<div class="fg"><label class="field-label" for="dvData">Data da devolução</label>' +
      '<input class="field-input" type="date" id="dvData" value="' + hoje + '" min="' + esc(l.data_saida) + '" max="' + hoje + '"/></div>' +
      (l.caucao_valor ? '<div class="fg"><label class="field-label" for="dvCaucao">E a caução de ' + esc(LP.brl(l.caucao_valor)) + '?</label>' +
        '<select class="field-select" id="dvCaucao"><option value="devolvida">Devolvi ao cliente</option><option value="abatida">Abati do valor da locação</option>' +
        '<option value="retida">Fiquei com ela (avaria, atraso…)</option><option value="pendente">Ainda não acertei</option></select></div>' : '');
    LP._validarDlg = function (box) {
      var d = box.querySelector('#dvData');
      if (d && (!d.value || d.value < l.data_saida || d.value > hoje)) { LP.toast('Escolha uma data entre a retirada e hoje.'); return false; }
    };
    LP.confirmar({ titulo: 'Devolução de ' + l.client_name, texto: itensTxt(l) + '. O equipamento volta a ficar livre.', html: html, ok: 'Confirmar devolução' })
      .then(function (box) {
        LP._validarDlg = null;
        if (!box) return;
        var data = box.querySelector('#dvData').value || hoje, cau = box.querySelector('#dvCaucao');
        return FIELDO_LOCACAO.Locacoes.marcarDevolvida(id, data, cau ? cau.value : null)
          .then(function () { LP.toast('Devolução registrada ✓'); return LP.recarregar(); })
          .catch(function (err) { LP.falhou(err, 'registrar a devolução'); });
      });
  }

  function cancelar(id) {
    var l = loc(id); if (!l) return;
    var ct = LP.contratoDe(id);
    LP.confirmar({ titulo: 'Cancelar a locação de ' + l.client_name + '?', ok: 'Cancelar locação', cancelar: 'Voltar', perigo: true,
      texto: 'O equipamento volta a ficar livre nessas datas.' + (ct && ct.status !== 'assinado' ? ' O contrato desta locação não é cancelado sozinho: cancele-o na aba Contratos, se precisar.' : '') })
      .then(function (ok) {
        if (!ok) return;
        FIELDO_LOCACAO.Locacoes.cancelar(id).then(function () { LP.toast('Locação cancelada.'); return LP.recarregar(); })
          .catch(function (err) { LP.falhou(err, 'cancelar'); });
      });
  }

  /* ════════════════════════════════════════════════════════════
     ASSISTENTE — nova locação e edição, 4 passos
  ════════════════════════════════════════════════════════════ */
  var w = null;
  var PASSOS = ['Cliente', 'Datas', 'Equipamentos', 'Revisão'];

  function clientesAnteriores() {
    var vistos = {}, out = [];
    (LP.st.locacoes || []).slice().sort(function (a, b) { return String(b.data_saida).localeCompare(a.data_saida); }).forEach(function (l) {
      var k = (l.client_name || '').trim().toLowerCase();
      if (!k || vistos[k]) return;
      vistos[k] = 1;
      out.push({ nome: l.client_name.trim(), tel: l.client_phone || '', doc: l.client_doc || '', email: l.client_email || '' });
    });
    return out;
  }

  function somaDias(iso, n) {
    var d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  LP.locWizard = function (o) {
    o = o || {};
    var ativos = (LP.st.equip || []).filter(function (e) { return e.ativo !== false; });
    if (!ativos.length) {
      LP.confirmar({ titulo: 'Cadastre um equipamento primeiro', texto: 'A locação precisa de pelo menos um equipamento cadastrado.', ok: 'Cadastrar equipamento' })
        .then(function (ok) { if (ok) LP.equipForm(); });
      return;
    }
    var l = o.id ? loc(o.id) : null, hoje = LP.D.hojeLocal();
    w = { id: l ? l.id : null, passo: 1, depois: o.depois || null, voltarContrato: o.voltarContrato || null, itens: {}, valorTocado: !!l, caucaoTocada: !!l,
          antigos: l ? (l.locacao_itens || []).map(function (it) { return it.id; }) : [] };
    if (l) (l.locacao_itens || []).forEach(function (it) { w.itens[it.equipamento_id] = (w.itens[it.equipamento_id] || 0) + (it.quantidade || 0); });
    var ct = l ? LP.contratoDe(l.id) : null;
    var html = '<div class="wz-passos" id="wzBarra">' + PASSOS.map(function () { return '<i></i>'; }).join('') + '</div><div class="wz-onde" id="wzOnde"></div>' +
      (ct && ct.status !== 'rascunho' ? '<div class="aviso">Esta locação tem ' + esc(LP.rotuloContrato(ct).toLowerCase()) + '. Mudar aqui <strong>não altera o contrato já enviado</strong>; para isso, depois crie uma nova versão do contrato.</div>' : '') +
      /* 1 cliente */
      '<div class="wz-etapa" data-passo="1"><h3 class="wz-tit">Quem está alugando?</h3><p class="wz-sub">Nome e WhatsApp bastam para registrar. O CPF ou CNPJ é pedido no contrato.</p>' +
        LP.campo('lcNome', 'Nome do cliente', l ? l.client_name : '', { ph: 'Nome completo ou da empresa', auto: 'off', max: 120 }) +
        '<div class="sugestoes" id="lcSug" style="margin:-.6rem 0 1rem"></div>' +
        LP.campo('lcTel', 'WhatsApp do cliente', l ? l.client_phone : '', { tipo: 'tel', inputmode: 'tel', ph: '(12) 99999-9999', opc: 1, dica: 'Com ele você manda lembrete e cobrança prontos.' }) +
        LP.campo('lcDoc', 'CPF ou CNPJ', l ? l.client_doc : '', { inputmode: 'numeric', ph: 'Só números', opc: 1 }) +
        LP.campo('lcEmail', 'E-mail', l ? l.client_email : '', { tipo: 'email', inputmode: 'email', opc: 1 }) +
      '</div>' +
      /* 2 datas */
      '<div class="wz-etapa" data-passo="2"><h3 class="wz-tit">Quando retira e quando devolve?</h3><p class="wz-sub">Com as datas, o app mostra o que está livre e calcula as diárias.</p>' +
        '<div class="lp-2col">' +
          '<div class="fg" id="fg_lcSaida"><label class="field-label" for="lcSaida">Retirada</label><input class="field-input" type="date" id="lcSaida" value="' + esc(l ? l.data_saida : hoje) + '"/><div class="fg-erro" hidden></div></div>' +
          '<div class="fg" id="fg_lcDev"><label class="field-label" for="lcDev">Devolução</label><input class="field-input" type="date" id="lcDev" value="' + esc(l ? l.data_prevista_devolucao : somaDias(hoje, 1)) + '"/><div class="fg-erro" hidden></div></div>' +
        '</div>' +
        '<div class="field-hint" style="margin:-.4rem 0 .5rem">Atalhos para a devolução:</div>' +
        '<div class="sugestoes" style="margin-bottom:1rem">' + [1, 2, 3, 7, 15, 30].map(function (n) { return '<button type="button" data-lc="dias" data-n="' + n + '">' + LP.plural(n, 'diária', 'diárias') + '</button>'; }).join('') + '</div>' +
        '<div class="resumo" id="lcDiasBox"></div>' +
      '</div>' +
      /* 3 equipamentos */
      '<div class="wz-etapa" data-passo="3"><h3 class="wz-tit">Quais equipamentos?</h3><p class="wz-sub" id="lcEqSub"></p><div id="lcEqLista"></div></div>' +
      /* 4 revisão */
      '<div class="wz-etapa" data-passo="4"><h3 class="wz-tit">Confira e confirme</h3><p class="wz-sub">O valor vem das diárias. Pode ajustar se combinou outro preço.</p>' +
        '<div id="lcResumo"></div>' +
        '<div class="lp-2col">' +
          LP.campo('lcValor', 'Valor total (R$)', l && l.valor_total != null ? String(l.valor_total).replace('.', ',') : '', { inputmode: 'decimal', ph: '0,00' }) +
          LP.campo('lcCaucao', 'Caução (R$)', l && l.caucao_valor != null ? String(l.caucao_valor).replace('.', ',') : '', { inputmode: 'decimal', ph: 'Sem caução', opc: 1 }) +
        '</div><div id="lcValorDica" class="field-hint" style="margin:-.5rem 0 1rem"></div>' +
        LP.campo('lcEnd', 'Endereço de entrega', l ? l.entrega_endereco : '', { opc: 1, ph: 'Deixe em branco se o cliente retira', max: 300 }) +
        LP.campo('lcObs', 'Observações', l ? l.observacoes : '', { area: 1, linhas: 2, opc: 1, ph: 'Estado na saída, acessórios, combinados', max: 1000 }) +
      '</div>';
    LP.tela.abrir({ titulo: l ? 'Editar locação' : 'Nova locação', rotuloFechar: '✕ Fechar', html: html,
      guarda: function () { return !!w && w.mexeu; } });
    var nome = q('lcNome');
    nome.addEventListener('input', function () { w.mexeu = true; sugestoes(); });
    ['lcTel', 'lcDoc', 'lcEmail', 'lcEnd', 'lcObs'].forEach(function (i) { q(i).addEventListener('input', function () { w.mexeu = true; }); });
    q('lcValor').addEventListener('input', function () { w.valorTocado = true; w.mexeu = true; });
    q('lcCaucao').addEventListener('input', function () { w.caucaoTocada = true; w.mexeu = true; });
    ['lcSaida', 'lcDev'].forEach(function (i) { q(i).addEventListener('change', function () { w.mexeu = true; dias(); }); });
    sugestoes();
    irPasso(1);
    if (!l) setTimeout(function () { nome.focus(); }, 80);
  };

  function sugestoes() {
    var box = q('lcSug'); if (!box) return;
    var t = (q('lcNome').value || '').trim().toLowerCase();
    var lista = clientesAnteriores().filter(function (c) { return !t || c.nome.toLowerCase().indexOf(t) >= 0; });
    if (lista.length === 1 && lista[0].nome.toLowerCase() === t) lista = [];
    lista = lista.slice(0, 5);
    box.innerHTML = lista.length ? '<span class="field-hint" style="width:100%;margin:0">Clientes anteriores:</span>' + lista.map(function (c, i) {
      return '<button type="button" data-lc="sug" data-i="' + i + '">' + esc(c.nome) + '</button>';
    }).join('') : '';
    w.sug = lista;
  }

  function dias() {
    var s = q('lcSaida').value, d = q('lcDev').value, box = q('lcDiasBox');
    if (!s || !d) { box.innerHTML = 'Escolha as duas datas.'; return 0; }
    if (d < s) { box.innerHTML = '<strong style="color:var(--red)">A devolução não pode ser antes da retirada.</strong>'; return 0; }
    var n = LP.D.diarias(s, d);
    box.innerHTML = '<div class="lin"><span>' + esc(LP.fmtData(s, true)) + ' → ' + esc(LP.fmtData(d, true)) + '</span><strong>' + esc(LP.plural(n, 'diária', 'diárias')) + '</strong></div>' +
      (s === d ? '<div style="font-size:.8rem;color:var(--muted)">Retirar e devolver no mesmo dia conta 1 diária.</div>' : '');
    return n;
  }

  function livres(id) {
    var e = LP.equip(id); if (!e) return 0;
    var ocup = LP.ocupado(q('lcSaida').value, q('lcDev').value, w.id)[id] || 0;
    return Math.max(0, (e.quantidade || 0) - ocup);
  }

  function renderEquip() {
    var n = LP.D.diarias(q('lcSaida').value, q('lcDev').value);
    q('lcEqSub').textContent = 'Mostrando o que está livre de ' + LP.fmtData(q('lcSaida').value) + ' a ' + LP.fmtData(q('lcDev').value) + ' (' + LP.plural(n, 'diária', 'diárias') + ').';
    var lista = (LP.st.equip || []).filter(function (e) { return e.ativo !== false || w.itens[e.id]; })
      .sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });
    q('lcEqLista').innerHTML = lista.map(function (e) {
      var liv = livres(e.id), qtd = w.itens[e.id] || 0, capa = LP.fotosDe(e)[0];
      return '<div class="es-item' + (qtd ? ' tem' : '') + (liv ? '' : (qtd ? '' : ' sem')) + '">' +
        (capa ? '<img src="' + esc(capa) + '" alt=""/>' : '<span class="ph" aria-hidden="true"></span>') +
        '<div style="min-width:0"><div class="es-nome">' + esc(e.nome) + '</div>' +
          '<div class="es-info' + (liv ? '' : ' zero') + '">' + (liv ? liv + ' livre' + (liv > 1 ? 's' : '') + ' nessas datas' : 'Nenhuma livre nessas datas') +
          (e.preco_dia ? ' · ' + esc(LP.brl(e.preco_dia)) + '/dia' : ' · <span style="color:var(--amber)">sem preço</span>') + '</div></div>' +
        '<div class="qtd" role="group" aria-label="Quantidade de ' + esc(e.nome) + '">' +
          '<button type="button" data-lc="menos" data-id="' + esc(e.id) + '" aria-label="Menos"' + (qtd ? '' : ' disabled') + '>−</button>' +
          '<output aria-live="polite">' + qtd + '</output>' +
          '<button type="button" data-lc="mais" data-id="' + esc(e.id) + '" aria-label="Mais"' + (qtd < liv ? '' : ' disabled') + '>+</button></div>' +
        (qtd > liv ? '<div style="grid-column:1/-1;font-size:.8rem;color:var(--red)">Você escolheu ' + qtd + ', mas só ' + liv + ' está' + (liv === 1 ? '' : 'ão') + ' livre' + (liv === 1 ? '' : 's') + ' nessas datas. Diminua ou mude as datas.</div>' : '') +
      '</div>';
    }).join('');
    rodape();
  }

  function calc() {
    var n = LP.D.diarias(q('lcSaida').value, q('lcDev').value), total = 0, semPreco = [], caucao = 0, itens = [];
    Object.keys(w.itens).forEach(function (id) {
      var qtd = w.itens[id]; if (!qtd) return;
      var e = LP.equip(id) || {}, p = e.preco_dia != null ? Number(e.preco_dia) : null;
      var sub = p != null ? p * qtd * n : null;
      if (sub != null) total += sub; else semPreco.push(e.nome || '?');
      if (e.caucao) caucao += Number(e.caucao) * qtd;
      itens.push({ equipamento_id: id, quantidade: qtd, preco_dia_aplicado: p, subtotal: sub, nome: e.nome || '' });
    });
    return { dias: n, total: total, semPreco: semPreco, caucao: caucao, itens: itens };
  }

  function renderResumo() {
    var c = calc();
    var cliente = (q('lcNome').value || '').trim();
    q('lcResumo').innerHTML = '<dl class="resumo">' +
      '<dt>Cliente</dt><dd>' + esc(cliente) + (q('lcTel').value ? ' · ' + esc(q('lcTel').value) : '') + '</dd>' +
      '<dt>Período</dt><dd>' + esc(LP.fmtData(q('lcSaida').value, true)) + ' → ' + esc(LP.fmtData(q('lcDev').value, true)) + ' · ' + esc(LP.plural(c.dias, 'diária', 'diárias')) + '</dd>' +
      '<dt>Equipamentos</dt><dd>' + c.itens.map(function (it) {
        return '<div class="lin"><span>' + (it.quantidade > 1 ? it.quantidade + '× ' : '') + esc(it.nome) + '</span><span>' + (it.subtotal != null ? esc(LP.brl(it.subtotal)) : 'sem preço') + '</span></div>';
      }).join('') + '<div class="lin tot"><span>Sugestão pelas diárias</span><span>' + esc(LP.brl(c.total)) + '</span></div></dd></dl>' +
      (c.semPreco.length ? '<div class="aviso">Sem preço da diária: ' + esc(c.semPreco.join(', ')) + '. Esse item não entrou na conta; ajuste o valor total.</div>' : '');
    var v = q('lcValor'), cv = q('lcCaucao');
    if (!w.valorTocado && c.total > 0) v.value = c.total.toFixed(2).replace('.', ',');
    if (!w.caucaoTocada) cv.value = c.caucao ? c.caucao.toFixed(2).replace('.', ',') : '';
    q('lcValorDica').innerHTML = w.valorTocado && c.total > 0 && LP.num(v.value) !== Math.round(c.total * 100) / 100
      ? 'Pelas diárias daria ' + esc(LP.brl(c.total)) + '. <button type="button" class="link-acao" data-lc="usar-sug">Usar este valor</button>'
      : (c.caucao && !w.caucaoTocada ? 'A caução foi sugerida pela soma das cauções dos equipamentos.' : '');
  }

  function rodape() {
    var p = w.passo, ult = p === PASSOS.length;
    var extra = '';
    if (p === 3) { var c = calc(), n = c.itens.reduce(function (s, i) { return s + i.quantidade; }, 0); extra = n ? ' (' + n + ')' : ''; }
    LP.tela.rodape(
      (p > 1 ? '<button type="button" class="btn btn--ghost" data-lc="voltar">← Voltar</button>' : '<button type="button" class="btn btn--ghost" data-lc="fechar">Cancelar</button>') +
      '<button type="button" class="btn btn--primary" data-lc="continuar" id="lcCont">' +
        (ult ? (w.id ? 'Salvar alterações' : 'Confirmar locação') : 'Continuar' + extra) + '</button>');
  }

  function irPasso(p) {
    w.passo = p;
    var etapas = document.querySelectorAll('#lpTelaCorpo .wz-etapa');
    for (var i = 0; i < etapas.length; i++) etapas[i].classList.toggle('ativa', +etapas[i].getAttribute('data-passo') === p);
    var barras = q('wzBarra').children;
    for (var k = 0; k < barras.length; k++) barras[k].className = k < p ? 'ok' : '';
    q('wzOnde').innerHTML = 'Passo <b>' + p + ' de ' + PASSOS.length + '</b> · ' + PASSOS[p - 1];
    if (p === 2) dias();
    if (p === 3) renderEquip();
    if (p === 4) renderResumo();
    rodape();
    LP.tela.topo();
  }

  function validar(p) {
    if (p === 1) {
      LP.marcarErro('lcNome', ''); LP.marcarErro('lcTel', ''); LP.marcarErro('lcDoc', '');
      if ((q('lcNome').value || '').trim().length < 2) { LP.marcarErro('lcNome', 'Informe o nome do cliente.'); return false; }
      var tel = LP.digits(q('lcTel').value);
      if (tel && (tel.length < 10 || tel.length > 13)) { LP.marcarErro('lcTel', 'Confira o número, com DDD.'); return false; }
      var doc = q('lcDoc').value.trim();
      if (doc && typeof FieldoContratoDoc !== 'undefined' && !FieldoContratoDoc.docValido(doc)) { LP.marcarErro('lcDoc', 'Este CPF ou CNPJ não confere. Confira ou deixe em branco.'); return false; }
    }
    if (p === 2) {
      LP.marcarErro('lcSaida', ''); LP.marcarErro('lcDev', '');
      var s = q('lcSaida').value, d = q('lcDev').value;
      if (!s) { LP.marcarErro('lcSaida', 'Escolha a data de retirada.'); return false; }
      if (!d) { LP.marcarErro('lcDev', 'Escolha a data de devolução.'); return false; }
      if (d < s) { LP.marcarErro('lcDev', 'A devolução não pode ser antes da retirada.'); return false; }
    }
    if (p === 3) {
      var c = calc();
      if (!c.itens.length) { LP.toast('Escolha pelo menos um equipamento com o botão +.'); return false; }
      var furo = c.itens.filter(function (it) { return it.quantidade > livres(it.equipamento_id); })[0];
      if (furo) { LP.toast('“' + furo.nome + '”: a quantidade passa do que está livre nessas datas.'); return false; }
    }
    if (p === 4) {
      LP.marcarErro('lcValor', ''); LP.marcarErro('lcCaucao', '');
      var vb = q('lcValor').value.trim(), cb = q('lcCaucao').value.trim();
      if (vb && (LP.num(vb) == null || LP.num(vb) < 0)) { LP.marcarErro('lcValor', 'Use só números. Ex.: 450,00'); return false; }
      if (cb && (LP.num(cb) == null || LP.num(cb) < 0)) { LP.marcarErro('lcCaucao', 'Use só números. Ex.: 300,00'); return false; }
    }
    return true;
  }

  function salvar() {
    var c = calc(), btn = q('lcCont'), l = w.id ? loc(w.id) : null;
    var s = q('lcSaida').value, d = q('lcDev').value;
    var dados = {
      client_name: q('lcNome').value.trim(),
      client_phone: q('lcTel').value.trim() || null,
      client_doc: LP.digits(q('lcDoc').value) || null,
      client_email: q('lcEmail').value.trim() || null,
      data_saida: s, data_prevista_devolucao: d,
      valor_total: LP.num(q('lcValor').value),
      caucao_valor: LP.num(q('lcCaucao').value),
      entrega_endereco: q('lcEnd').value.trim() || null,
      observacoes: q('lcObs').value.trim() || null,
    };
    if (!l || (l.status !== 'devolvida' && l.status !== 'cancelada')) dados.status = LP.D.statusInicial(s);
    btn.disabled = true; btn.textContent = 'Salvando…';
    var op = l ? FIELDO_LOCACAO.Locacoes.atualizarComItens(l.id, dados, c.itens, w.antigos)
               : FIELDO_LOCACAO.Locacoes.create(dados, c.itens);
    op.then(function (r) {
      var id = (r && r.id) || (l && l.id), depois = w.depois, voltar = w.voltarContrato, ct = l ? LP.contratoDe(l.id) : null;
      w.mexeu = false;
      /* rascunho de contrato desta locação: traz os dados novos sozinho */
      var sync = (ct && ct.status === 'rascunho' && LP.st.contratosOk)
        ? FIELDO_LOCACAO.Contratos.salvar(ct.id, {}, null, true).catch(function (e) { console.error('[locacao] resync', e); }) : null;
      return Promise.resolve(sync).then(function () { return LP.tela.fecharSalvo(); }).then(function () { return LP.recarregar(); }).then(function () {
        if (l) {
          LP.toast('Locação atualizada ✓' + (ct && ct.status === 'rascunho' ? ' O rascunho do contrato também.' : ''));
          if (voltar && LP.st.contratosOk) LocContratosUI._abrir(voltar);
          return;
        }
        if (depois === 'contrato') { LP.gerarContrato(id); return; }
        if (LP.abaAtual !== 'locacoes') LP.ir('locacoes');
        if (!LP.st.contratosOk) { LP.toast('Locação registrada ✓'); return; }
        LP.confirmar({ titulo: 'Locação registrada ✓', texto: 'Quer gerar o contrato agora? Os dados do cliente, das datas e dos equipamentos já entram nele.', ok: 'Gerar contrato', cancelar: 'Agora não' })
          .then(function (ok) { if (ok) LP.gerarContrato(id); });
      });
    }).catch(function (err) {
      btn.disabled = false; btn.textContent = l ? 'Salvar alterações' : 'Confirmar locação';
      LP.falhou(err, 'salvar a locação');
    });
  }

  /* ── Novo contrato (aba Contratos) ──────────────────────────── */
  LP.novoContrato = function () {
    if (!LP.st.contratosOk) { LP.toast('Os contratos não carregaram. Recarregue a página.'); return; }
    var hoje = LP.D.hojeLocal();
    var sem = LP.comStatus().filter(function (x) { return x.vis !== 'cancelada' && !LP.contratoDe(x.loc.id); })
      .sort(function (a, b) { return String(b.loc.data_saida).localeCompare(a.loc.data_saida); });
    if (!sem.length) {
      if (!(LP.st.equip || []).length) { LP.locWizard(); return; }
      LP.confirmar({ titulo: 'Primeiro, a locação', texto: 'O contrato sai de uma locação: cliente, datas e equipamentos. Vamos registrar agora? Ao confirmar, o contrato abre em seguida.', ok: 'Registrar locação' })
        .then(function (ok) { if (ok) LP.locWizard({ depois: 'contrato' }); });
      return;
    }
    LP.tela.abrir({ titulo: 'Novo contrato',
      html: '<h3 class="wz-tit">De qual locação?</h3><p class="wz-sub">O contrato já sai com o cliente, as datas, os equipamentos e os valores dela.</p>' +
        sem.slice(0, 30).map(function (x) {
          var l = x.loc;
          return '<button type="button" class="es-item" style="width:100%;text-align:left;grid-template-columns:minmax(0,1fr) auto;cursor:pointer;font:inherit" data-lc="ct-de" data-id="' + esc(l.id) + '">' +
            '<div style="min-width:0"><div class="es-nome">' + esc(l.client_name) + '</div><div class="es-info">' + esc(itensTxt(l)) + '<br>' +
            esc(LP.fmtData(l.data_saida)) + ' → ' + esc(LP.fmtData(l.data_prevista_devolucao)) + ' · ' + esc(frase(l, x.vis, hoje)) + '</div></div>' +
            '<span style="color:var(--gold-text);font-weight:600">Escolher</span></button>';
        }).join('') +
        '<div style="text-align:center;margin-top:1rem"><p class="wz-sub" style="margin-bottom:.5rem">A locação não está na lista?</p>' +
        '<button type="button" class="btn btn--ghost" data-lc="ct-nova">Registrar nova locação</button></div>' });
  };
  var btnNovo = q('btnNovoContrato');
  if (btnNovo) btnNovo.addEventListener('click', function () { LP.novoContrato(); });

  /* ── eventos ────────────────────────────────────────────────── */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-lc], [data-lc-filtro]');
    if (!b) return;
    if (b.hasAttribute('data-lc-filtro')) { LP.st.filtroLoc = b.getAttribute('data-lc-filtro'); LP.renderAtual(); return; }
    var a = b.getAttribute('data-lc'), id = b.getAttribute('data-id');
    if (a === 'devolver') devolver(id);
    else if (a === 'cancelar') cancelar(id);
    else if (a === 'editar') LP.locWizard({ id: id });
    else if (a === 'contrato') LP.gerarContrato(id);
    else if (a === 'fechar') LP.tela.fechar();
    else if (a === 'voltar') irPasso(Math.max(1, w.passo - 1));
    else if (a === 'continuar') { if (!validar(w.passo)) return; if (w.passo < PASSOS.length) irPasso(w.passo + 1); else salvar(); }
    else if (a === 'dias') { var s = q('lcSaida').value || LP.D.hojeLocal(); q('lcDev').value = somaDias(s, +b.getAttribute('data-n')); w.mexeu = true; dias(); LP.marcarErro('lcDev', ''); }
    else if (a === 'sug') {
      var c = w.sug && w.sug[+b.getAttribute('data-i')]; if (!c) return;
      q('lcNome').value = c.nome; q('lcTel').value = c.tel; q('lcDoc').value = c.doc; q('lcEmail').value = c.email;
      w.mexeu = true; sugestoes();
    }
    else if (a === 'mais' || a === 'menos') {
      var atual = w.itens[id] || 0;
      w.itens[id] = Math.max(0, a === 'mais' ? Math.min(atual + 1, livres(id)) : atual - 1);
      if (!w.itens[id]) delete w.itens[id];
      w.mexeu = true; renderEquip();
    }
    else if (a === 'usar-sug') { w.valorTocado = false; renderResumo(); }
    else if (a === 'ct-de') LP.gerarContrato(id);
    else if (a === 'ct-nova') { LP.tela.fechar().then(function () { LP.locWizard({ depois: 'contrato' }); }); }
  });
})();
