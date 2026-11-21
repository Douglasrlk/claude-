/* ============================================================
   Fieldo Locação · contratos-ui.js  v1.0 — tela de contratos do painel
   ─────────────────────────────────────────────────────────────
   Requer: db.js, db.locacao.js, db.locacao.contratos.js,
           contrato-doc.js (e contrato-pdf.js para o PDF).
   O painel chama LocContratosUI.init(...) uma vez e
   LocContratosUI.carregar(locacoes) a cada recarga.
   Ações por data-ct="acao" (delegação de eventos, sem onclick inline).
============================================================ */
var LocContratosUI = (function () {
  'use strict';

  var C, Doc, esc, toast;
  var st = { lista: [], locacoes: [], filtro: 'todos', busca: '', aberto: null };

  var COR = {
    rascunho: 'gray', aguardando_cliente: 'amber', aguardando_locadora: 'amber',
    assinado: 'green', recusado: 'red', cancelado: 'gray', substituido: 'gray'
  };
  var FILTROS = [
    { id: 'todos', rotulo: 'Todos' },
    { id: 'rascunho', rotulo: 'Rascunhos' },
    { id: 'pendentes', rotulo: 'Esperando assinatura' },
    { id: 'assinado', rotulo: 'Assinados' },
    { id: 'encerrados', rotulo: 'Encerrados' }
  ];

  function el(id) { return document.getElementById(id); }

  function cssUmaVez() {
    if (el('ctCss')) return;
    var s = document.createElement('style');
    s.id = 'ctCss';
    s.textContent = [
      '.ct-filtros{display:flex;gap:.35rem;overflow-x:auto;margin:.2rem 0 .8rem;padding-bottom:.2rem}',
      '.ct-chip{font-family:var(--mono);font-size:.66rem;padding:.38rem .7rem;border-radius:99px;border:1px solid var(--border2);background:var(--surface);color:var(--muted);white-space:nowrap;cursor:pointer}',
      '.ct-chip[aria-pressed="true"]{background:var(--ink,#1c1a17);color:var(--paper,#fff);border-color:transparent}',
      '.ct-row{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-l,12px);padding:.9rem 1rem;margin-bottom:.7rem}',
      '.ct-top{display:flex;justify-content:space-between;gap:.6rem;align-items:flex-start}',
      '.ct-num{font-family:var(--mono);font-size:.68rem;color:var(--muted)}',
      '.ct-cli{font-weight:600;font-size:1rem;color:var(--ink)}',
      '.ct-meta{font-size:.8rem;color:var(--muted);margin-top:.25rem;line-height:1.5}',
      '.ct-prox{font-size:.86rem;color:var(--text2);margin-top:.5rem;line-height:1.45}',
      '.ct-valor{font:500 .9rem var(--sans);color:var(--gold-text);white-space:nowrap}',
      '.ct-acts{display:flex;gap:.4rem;margin-top:.65rem;flex-wrap:wrap}',
      '.ct-sheet{position:fixed;inset:0;z-index:900;background:var(--bg);overflow-y:auto;-webkit-overflow-scrolling:touch}',
      '.ct-sheet-in{max-width:620px;margin:0 auto;padding:1rem 1rem calc(7rem + env(safe-area-inset-bottom))}',
      '.ct-pe{position:fixed;left:0;right:0;bottom:0;z-index:5;background:var(--paper);border-top:1px solid var(--border2);padding:.7rem 1rem calc(.7rem + env(safe-area-inset-bottom))}',
      '.ct-pe-in{max-width:620px;margin:0 auto;display:flex;gap:.6rem}.ct-pe-in .btn{flex:1;justify-content:center}.ct-pe-in .btn--primary{flex:1.6}',
      '.ct-linha-tempo{list-style:none;margin:.9rem 0 .2rem;padding:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:.25rem;text-align:center}',
      '.ct-linha-tempo li{font-size:.7rem;line-height:1.25;color:var(--muted);position:relative;padding-top:1.6rem}',
      '.ct-linha-tempo li::before{content:"";position:absolute;top:0;left:50%;transform:translateX(-50%);width:20px;height:20px;border-radius:50%;border:2px solid var(--border3);background:var(--paper);box-sizing:border-box}',
      '.ct-linha-tempo li.ok{color:var(--green)}.ct-linha-tempo li.ok::before{background:var(--green-l);border-color:var(--green-l)}',
      '.ct-linha-tempo li.agora{color:var(--ink);font-weight:600}.ct-linha-tempo li.agora::before{border-color:var(--gold);background:var(--gold-bg)}',
      '.ct-proximo{border-radius:10px;padding:.8rem .9rem;margin-top:.8rem;font-size:.92rem;line-height:1.5;background:var(--gold-bg);border:1px solid var(--gold-bd);color:var(--text)}',
      '.ct-proximo b{display:block;font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:var(--gold-text);margin-bottom:.15rem}',
      '.ct-sheet-bar{position:sticky;top:0;z-index:6;background:var(--bg);display:flex;align-items:center;gap:.6rem;padding:.7rem 0;border-bottom:1px solid var(--border);margin-bottom:1rem}',
      '.ct-sheet-bar h2{font-size:1rem;margin:0;flex:1;font-weight:500}',
      '.ct-box{background:var(--paper);border:1px solid var(--border);border-radius:var(--r-l,14px);padding:1rem 1.1rem;margin-bottom:1rem}',
      '.ct-box h3{font-size:.92rem;margin:0 0 .7rem;font-weight:600}',
      '.ct-doc{background:#fff;color:#1c1a17;border:1px solid var(--border);border-radius:10px;padding:1.1rem 1.2rem;font-size:.86rem;line-height:1.6;max-height:60vh;overflow-y:auto}',
      '.ct-doc .ctr-h1{font-size:1.05rem;text-align:center;margin:.2rem 0 .4rem}',
      '.ct-doc .ctr-h2{font-size:.92rem;margin:1rem 0 .35rem;border-bottom:1px solid #ddd;padding-bottom:.2rem}',
      '.ct-doc .ctr-h3{font-size:.86rem;margin:.75rem 0 .25rem}',
      '.ct-doc .ctr-p{margin:.3rem 0}.ct-doc .ctr-ul{margin:.3rem 0 .3rem 1.1rem;padding:0}',
      '.ct-aviso{background:var(--amber-bg);border:1px solid var(--amber-bd);color:var(--amber);border-radius:8px;padding:.65rem .8rem;font-size:.8rem;line-height:1.5;margin-bottom:.8rem}',
      '.ct-ok{background:var(--green-bg);border:1px solid var(--green-bd);color:var(--green);border-radius:8px;padding:.65rem .8rem;font-size:.8rem;line-height:1.5;margin-bottom:.8rem}',
      '.ct-erro{background:var(--red-bg);border:1px solid var(--red-bd);color:var(--red);border-radius:8px;padding:.65rem .8rem;font-size:.8rem;line-height:1.5;margin-bottom:.8rem}',
      '.ct-cl{border:1px solid var(--border2);border-radius:8px;padding:.6rem;margin-bottom:.55rem;background:var(--surface)}',
      '.ct-cl textarea{min-height:90px}',
      '.ct-hist{font-family:var(--mono);font-size:.66rem;color:var(--muted);line-height:1.7}',
      '.ct-canvas{width:100%;height:150px;border:1px dashed var(--border2);border-radius:8px;background:#fff;touch-action:none;display:block}',
      '.ct-linha{display:flex;gap:.6rem}.ct-linha>*{flex:1}',
      '@media (max-width:420px){.ct-linha{flex-direction:column}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ── lista ─────────────────────────────────────────────────── */
  function passaFiltro(c) {
    var f = st.filtro;
    if (f === 'rascunho' && c.status !== 'rascunho') return false;
    if (f === 'pendentes' && c.status !== 'aguardando_cliente' && c.status !== 'aguardando_locadora') return false;
    if (f === 'assinado' && c.status !== 'assinado') return false;
    if (f === 'encerrados' && ['recusado', 'cancelado', 'substituido'].indexOf(c.status) < 0) return false;
    var b = st.busca.trim().toLowerCase();
    if (!b) return true;
    var nome = ((c.dados && c.dados.cliente && c.dados.cliente.nome) || '').toLowerCase();
    return nome.indexOf(b) >= 0 || String(c.numero).toLowerCase().indexOf(b) >= 0;
  }

  /* v12.6 · "Criado 25/10/2026, 14:41:53 · atualizado 26/10/2026, 14:41:53"
     virou uma frase só, com o evento que importa para cada estado. */
  function haQuanto(iso) {
    if (!iso) return '';
    var d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : 'há ' + d + ' dias';
  }
  function quando(c) {
    if (c.status === 'assinado' && c.concluido_em) return 'Assinado ' + haQuanto(c.concluido_em);
    if ((c.status === 'aguardando_cliente' || c.status === 'aguardando_locadora') && c.enviado_em) return 'Enviado ' + haQuanto(c.enviado_em);
    return 'Atualizado ' + haQuanto(c.updated_at || c.created_at);
  }

  /* v12.19 · cada contrato diz o próximo passo em palavras simples,
     em vez de só o nome técnico do status. */
  var PROXIMO = {
    rascunho:            'Próximo passo: revisar os dados e gerar o link para o cliente.',
    aguardando_cliente:  'Próximo passo: o cliente abrir o link e assinar.',
    aguardando_locadora: 'O cliente já assinou. Falta a sua assinatura.',
    assinado:            'Concluído. Você pode baixar ou enviar o PDF.',
    recusado:            'O cliente recusou. Abra para ver o motivo e criar uma nova versão.',
    cancelado:           'Cancelado. Não vale mais.',
    substituido:         'Trocado por uma versão mais nova.'
  };
  function rotuloCurto(s) {
    return ({ aguardando_cliente: 'Esperando o cliente', aguardando_locadora: 'Falta a sua assinatura', assinado: 'Assinado' })[s] || C.STATUS[s] || s;
  }

  function renderLista() {
    var wrap = el('listaContratos'), vazio = el('emptyContratos'), chips = el('ctFiltros');
    if (!wrap) return;
    var conta = { todos: st.lista.length };
    st.lista.forEach(function (c) {
      var f = c.status === 'rascunho' ? 'rascunho' : (c.status === 'aguardando_cliente' || c.status === 'aguardando_locadora') ? 'pendentes'
        : c.status === 'assinado' ? 'assinado' : 'encerrados';
      conta[f] = (conta[f] || 0) + 1;
    });
    chips.innerHTML = st.lista.length ? FILTROS.map(function (f) {
      return '<button type="button" class="lp-chip" data-ct="filtro" data-v="' + f.id + '" aria-pressed="' +
        (st.filtro === f.id) + '">' + esc(f.rotulo) + '<span class="n">' + (conta[f.id] || 0) + '</span></button>';
    }).join('') : '';
    var busca = el('ctBusca');
    if (busca && busca.closest('.fg')) busca.closest('.fg').hidden = st.lista.length < 4;

    var pend = st.lista.filter(function (c) { return c.status === 'aguardando_locadora'; }).length;
    var alerta = el('ctAlerta');
    if (alerta) {
      alerta.style.display = pend ? '' : 'none';
      alerta.innerHTML = pend ? '<strong>' + pend + '</strong> contrato' + (pend > 1 ? 's' : '') +
        ' já assinado' + (pend > 1 ? 's' : '') + ' pelo cliente esperando a sua assinatura.' : '';
    }

    var vis = st.lista.filter(passaFiltro);
    if (!st.lista.length) { wrap.innerHTML = ''; vazio.style.display = ''; return; }
    vazio.style.display = 'none';
    if (!vis.length) { wrap.innerHTML = '<p class="ct-meta">Nenhum contrato neste filtro.</p>'; return; }

    wrap.innerHTML = vis.map(function (c) {
      var d = c.dados || {}, lo = d.locacao || {};
      var vt = Doc.valorTotal(lo, d.itens);
      var acao = c.status === 'rascunho' || c.status === 'aguardando_locadora';
      return '<div class="ct-row">' +
        '<div class="ct-top"><div style="min-width:0">' +
          '<div class="ct-cli">' + esc((d.cliente && d.cliente.nome) || '—') + '</div>' +
          '<div class="ct-meta">' + esc(c.numero) + (c.versao > 1 ? ' · versão ' + esc(c.versao) : '') + ' · locação ' +
            esc(Doc.fmtData(lo.data_saida)) + ' → ' + esc(Doc.fmtData(lo.data_prevista_devolucao)) + '<br>' + esc(quando(c)) + '</div>' +
        '</div>' + (vt != null ? '<div class="ct-valor">' + esc(Doc.brl(vt)) + '</div>' : '') + '</div>' +
        '<div style="margin-top:.5rem"><span class="status-pill ' + (COR[c.status] || 'gray') + '">' + esc(rotuloCurto(c.status)) + '</span></div>' +
        '<div class="ct-prox">' + esc(PROXIMO[c.status] || '') + '</div>' +
        '<div class="ct-acts"><button type="button" class="btn ' + (acao ? 'btn--primary' : 'btn--ghost') +
          ' btn--sm" style="flex:1" data-ct="abrir" data-id="' + esc(c.id) + '">' +
          (c.status === 'rascunho' ? 'Continuar o contrato' : c.status === 'aguardando_locadora' ? 'Assinar agora' : 'Abrir') + '</button></div>' +
      '</div>';
    }).join('');
  }

  function carregar(locacoes) {
    if (locacoes) st.locacoes = locacoes;
    return C.list().then(function (lista) {
      st.lista = lista || [];
      renderLista();
    }).catch(function (err) {
      console.error('[contratos] list', err);
      var wrap = el('listaContratos');
      if (wrap) wrap.innerHTML = '<div class="ct-erro">Não foi possível carregar os contratos. Verifique a conexão.</div>';
    });
  }

  /* contrato "vivo" de uma locação (para o botão na lista de locações) */
  function contratoDaLocacao(locacaoId) {
    var ativos = st.lista.filter(function (c) {
      return c.locacao_id === locacaoId && ['rascunho', 'aguardando_cliente', 'aguardando_locadora', 'assinado'].indexOf(c.status) >= 0;
    });
    return ativos[0] || null;
  }

  /* ── delegação de cliques ──────────────────────────────────── */
  var acoes = {};
  function clique(ev) {
    var b = ev.target.closest ? ev.target.closest('[data-ct]') : null;
    if (!b) return;
    var fn = acoes[b.getAttribute('data-ct')];
    if (fn) { ev.preventDefault(); fn(b); }
  }

  acoes.filtro = function (b) { st.filtro = b.getAttribute('data-v'); renderLista(); };
  acoes.abrir  = function (b) { abrir(b.getAttribute('data-id')); };

  function init(opts) {
    C = FIELDO_LOCACAO.Contratos; Doc = FieldoContratoDoc;
    esc = opts.esc; toast = opts.toast || function (m) { alert(m); };
    cssUmaVez();
    document.addEventListener('click', clique);
    var busca = el('ctBusca');
    if (busca) busca.addEventListener('input', function () { st.busca = busca.value || ''; renderLista(); });
  }

  /* abrir() e o restante do fluxo ficam nas partes seguintes deste arquivo */
  function abrir(id) { if (api._abrir) api._abrir(id); }

  var api = {
    init: init, carregar: carregar, contratoDaLocacao: contratoDaLocacao,
    _st: st, _acoes: acoes, _COR: COR, _PROXIMO: PROXIMO,
    _ctx: function () { return { C: C, Doc: Doc, esc: esc, toast: toast, st: st, recarregar: carregar }; }
  };
  return api;
})();
