/* ============================================================
   Fieldo Locação · painel-base.js  v12.19
   ─────────────────────────────────────────────────────────────
   Base do painel em cinco telas: estado, carga dos dados, navegação
   (com o Voltar do celular), tela cheia para formulários, caixa de
   confirmação no lugar do confirm()/prompt() do navegador, dicas de
   contexto e mensagens de erro em linguagem simples.

   As telas (painel-inicio/perfil/equip/locacoes.js) se registram em
   LP.abas[nome] = function render(el) {...}. Toda regra de negócio
   continua em db.locacao.js e db.locacao.contratos.js.
============================================================ */
var LP = (function () {
  'use strict';

  var LP = { abas: {}, st: {}, abaAtual: null };

  function falhaCritica(msg, err) {
    if (err) console.error('[locacao-painel]', err);
    if (document.getElementById('lpFalha')) return;
    var box = document.createElement('div');
    box.id = 'lpFalha';
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#7a2020;color:#fff;' +
      'padding:1rem 1.25rem calc(1rem + env(safe-area-inset-bottom));font-family:system-ui,sans-serif;font-size:.9rem;line-height:1.5';
    var p = document.createElement('div'); p.textContent = msg;
    var b = document.createElement('button');
    b.textContent = 'Recarregar';
    b.style.cssText = 'margin-top:.7rem;width:100%;padding:.8rem;border:0;border-radius:8px;background:#fff;color:#7a2020;font-weight:600;font-size:.9rem';
    b.onclick = function () { location.reload(); };
    box.appendChild(p); box.appendChild(b); document.body.appendChild(box);
  }
  LP.falhaCritica = falhaCritica;

  /* ── utilidades ─────────────────────────────────────────────── */
  function q(id) { return document.getElementById(id); }
  LP.q = q;
  LP.esc = function (s) { return FIELDO.UI.esc(s); };
  LP.toast = function (m, ms) { if (FIELDO.UI && FIELDO.UI.toast) FIELDO.UI.toast(m, ms); };
  LP.brl = function (v) {
    if (v == null || v === '' || isNaN(Number(v))) return '';
    return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  LP.num = function (v) {
    if (v == null) return null;
    var s = String(v).trim().replace(/\s/g, '').replace(/^R\$/i, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');   /* "1.200" = mil e duzentos */
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  };
  LP.fmtData = function (iso, longa) {
    if (!iso) return '';
    var d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR', longa ? { weekday: 'short', day: '2-digit', month: 'short' } : { day: '2-digit', month: 'short' })
      .replace(/\./g, '');
  };
  LP.diasEntre = function (a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  };
  LP.emDias = function (n) { return n === 1 ? '1 dia' : n + ' dias'; };
  LP.digits = function (s) { return String(s || '').replace(/\D/g, ''); };
  LP.plural = function (n, um, varios) { return n + ' ' + (n === 1 ? um : varios); };
  LP.ICONE_WA = '<svg class="btn-ic" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.6 21.4l4.7-1.2A9.5 9.5 0 1 0 12 2.5Zm0 1.7a7.8 7.8 0 1 1-4.1 14.4l-.3-.2-2.8.7.7-2.7-.2-.3A7.8 7.8 0 0 1 12 4.2Zm-3 3.9c-.2 0-.5 0-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.9 4.5 3.9 2.2.9 2.7.7 3.2.7s1.5-.6 1.7-1.2c.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3l-1.7-.8c-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.4 6.4 0 0 1-3.2-2.8c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.9c-.2-.5-.4-.4-.6-.4H9Z"/></svg>';
  LP.ICONE_DICA = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V17h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z"/></svg>';

  function ls(k, v) {
    try {
      if (arguments.length === 1) return localStorage.getItem('fieldo_loc_ui_' + k);
      if (v == null) localStorage.removeItem('fieldo_loc_ui_' + k); else localStorage.setItem('fieldo_loc_ui_' + k, v);
    } catch (e) { return null; }
  }
  LP.ls = ls;

  /* Erro em linguagem simples. O detalhe técnico vai para o console,
     nunca para a tela (auditoria, problema 10). */
  var CODIGOS = {
    locacao_sem_itens: 'Escolha pelo menos um equipamento.',
    datas_obrigatorias: 'Preencha a data de retirada e a de devolução.',
    data_devolucao_antes_da_saida: 'A devolução não pode ser antes da retirada.',
    cliente_obrigatorio: 'Informe o nome do cliente.',
    itens_antigos_ficaram: 'A locação foi salva, mas a lista de equipamentos pode ter ficado repetida. Abra a locação e confira.',
  };
  LP.msgErro = function (err, acao) {
    var cod = String((err && (err.code || err.message)) || '');
    if (CODIGOS[cod]) return CODIGOS[cod];
    if (err && err.message && err.code && FIELDO_LOCACAO.Contratos && FIELDO_LOCACAO.Contratos.MSG[err.code]) return err.message;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'Sem internet. Confira o sinal e tente de novo.';
    if (err && (err.status === 401 || err.status === 403) || /JWT|expired/i.test(cod)) return 'Sua sessão expirou. Feche e abra o app de novo.';
    if (/Failed to fetch|NetworkError|Load failed|AbortError|timeout/i.test(cod)) return 'A conexão falhou. Confira o sinal e tente de novo.';
    if (/23503|foreign key|violates foreign/i.test(cod)) return 'Este item está ligado a outros registros e não pode ser apagado.';
    return 'Não deu para ' + (acao || 'concluir') + ' agora. Tente de novo em instantes.';
  };
  LP.falhou = function (err, acao) {
    console.error('[locacao-painel] ' + (acao || ''), err);
    LP.toast(LP.msgErro(err, acao), 4200);
  };

  /* ── camadas (tela cheia, contrato) + Voltar do celular ──────── */
  var pilha = [], esperando = [];
  LP.abrirCamada = function (fechar, guarda) {
    pilha.push({ fechar: fechar, guarda: guarda || null });
    try { history.pushState({ lpCamada: pilha.length }, '', location.href); } catch (e) {}
  };
  LP.fecharCamada = function () {
    return new Promise(function (res) {
      if (!pilha.length) return res();
      esperando.push(res);
      history.back();
    });
  };
  LP.temCamada = function () { return pilha.length > 0; };

  window.addEventListener('popstate', function (e) {
    var alvo = (e.state && e.state.lpCamada) || 0;
    while (pilha.length > alvo) {
      var c = pilha[pilha.length - 1];
      if (c.guarda && c.guarda()) {
        /* formulário com mudança: devolve a entrada e pergunta */
        try { history.pushState({ lpCamada: pilha.length }, '', location.href); } catch (er) {}
        LP.confirmar({ titulo: 'Sair sem salvar?', texto: 'O que você preencheu nesta tela será perdido.', ok: 'Sair sem salvar', cancelar: 'Continuar editando', perigo: true })
          .then(function (sim) { if (sim) { c.guarda = null; LP.fecharCamada(); } });
        esperando.splice(0).forEach(function (r) { r(); });
        return;
      }
      pilha.pop();
      try { c.fechar(); } catch (er) { console.error(er); }
    }
    esperando.splice(0).forEach(function (r) { r(); });
    var aba = abaDoHash();
    if (aba && aba !== LP.abaAtual) mostrarAba(aba);
  });

  /* ── tela cheia ─────────────────────────────────────────────── */
  var telaFechar = null;
  LP.tela = {
    abrir: function (o) {
      var t = q('lpTela');
      q('lpTelaTit').textContent = o.titulo || '';
      q('lpTelaVoltar').innerHTML = o.rotuloFechar || '← Voltar';
      q('lpTelaCorpo').innerHTML = o.html || '';
      LP.tela.rodape(o.rodape || '');
      t.classList.add('aberta');
      t.scrollTop = 0;
      document.body.style.overflow = 'hidden';
      telaFechar = o.aoFechar || null;
      LP.abrirCamada(function () {
        t.classList.remove('aberta');
        q('lpTelaCorpo').innerHTML = '';
        q('lpTelaPeIn').innerHTML = '';
        document.body.style.overflow = '';
        var f = telaFechar; telaFechar = null;
        if (f) f();
      }, o.guarda);
      return q('lpTelaCorpo');
    },
    rodape: function (html) {
      q('lpTelaPeIn').innerHTML = html || '';
      q('lpTelaPe').hidden = !html;
    },
    fechar: function () { return LP.fecharCamada(); },
    /* depois de salvar: fecha sem perguntar "sair sem salvar?" */
    fecharSalvo: function () {
      if (pilha.length) pilha[pilha.length - 1].guarda = null;
      return LP.fecharCamada();
    },
    topo: function () { q('lpTela').scrollTop = 0; },
    aberta: function () { return q('lpTela').classList.contains('aberta'); },
  };
  document.addEventListener('DOMContentLoaded', function () {
    q('lpTelaVoltar').addEventListener('click', function () { LP.tela.fechar(); });
  });

  /* ── caixa de confirmação ───────────────────────────────────── */
  var dlgRes = null;
  LP.confirmar = function (o) {
    return new Promise(function (res) {
      if (dlgRes) dlgRes(null);
      dlgRes = res;
      var d = q('lpDlg');
      q('lpDlgTit').textContent = o.titulo || '';
      q('lpDlgCorpo').innerHTML = (o.texto ? '<p>' + LP.esc(o.texto) + '</p>' : '') + (o.html || '');
      q('lpDlgActs').innerHTML =
        (o.cancelar === false ? '' : '<button type="button" class="btn btn--ghost" data-dlg="0">' + LP.esc(o.cancelar || 'Cancelar') + '</button>') +
        '<button type="button" class="btn ' + (o.perigo ? 'btn--perigo' : 'btn--primary') + '" data-dlg="1">' + LP.esc(o.ok || 'Confirmar') + '</button>';
      d.classList.add('aberta');
      setTimeout(function () {
        var f = d.querySelector('input,select,textarea') || d.querySelector('[data-dlg="1"]');
        if (f) f.focus();
      }, 30);
    });
  };
  function fecharDlg(valor) {
    var d = q('lpDlg');
    d.classList.remove('aberta');
    var r = dlgRes; dlgRes = null;
    if (r) r(valor);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-dlg]');
    if (b) {
      if (b.getAttribute('data-dlg') === '1') {
        var box = q('lpDlg');
        if (LP._validarDlg && LP._validarDlg(box) === false) return;
        fecharDlg(box);
      } else fecharDlg(null);
      return;
    }
    if (e.target === q('lpDlg')) fecharDlg(null);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && q('lpDlg') && q('lpDlg').classList.contains('aberta')) fecharDlg(null);
  });

  /* ── dicas de contexto ──────────────────────────────────────── */
  LP.dicaHTML = function (nome, html) {
    if (ls('dica_' + nome) === 'x') return '';
    return '<div class="lp-dica" data-dica="' + nome + '">' + LP.ICONE_DICA + '<div>' + html + '</div>' +
      '<button type="button" class="lp-dica-x" data-fechar-dica="' + nome + '" aria-label="Fechar dica">×</button></div>';
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-fechar-dica]');
    if (!b) return;
    ls('dica_' + b.getAttribute('data-fechar-dica'), 'x');
    var box = b.closest('.lp-dica'); if (box) box.remove();
  });
  LP.reverDicas = function () {
    ['inicio', 'equipamentos', 'locacoes', 'contratos', 'perfil'].forEach(function (n) { ls('dica_' + n, null); });
    ls('passos_ok', null);
  };

  /* ── navegação entre as telas ───────────────────────────────── */
  var ABAS = ['inicio', 'equipamentos', 'locacoes', 'contratos', 'perfil', 'ajuda'];
  var ANTIGOS = { secLocacoes: 'locacoes', secContratos: 'contratos', secEquip: 'equipamentos', heroLocadora: 'perfil' };
  function abaDoHash() {
    var h = (location.hash || '').replace('#', '').split(/[/?]/)[0];
    if (ANTIGOS[h]) return ANTIGOS[h];
    return ABAS.indexOf(h) >= 0 ? h : null;
  }
  function mostrarAba(nome) {
    LP.abaAtual = nome;
    ABAS.forEach(function (a) {
      var el = q('aba-' + a);
      if (el) el.hidden = a !== nome;
    });
    var tabs = document.querySelectorAll('[data-ir]');
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      if (t.classList.contains('lp-tab') || t.id === 'btnAjuda') {
        if (t.getAttribute('data-ir') === nome) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
      }
    }
    renderAba(nome);
    window.scrollTo(0, 0);
    var tit = { inicio: 'Início', equipamentos: 'Equipamentos', locacoes: 'Locações', contratos: 'Contratos', perfil: 'Meu perfil', ajuda: 'Ajuda' }[nome];
    document.title = tit + ' · Fieldo Locação';
  }
  function renderAba(nome) {
    if (!LP.st.pronto) return;
    var el = q('aba-' + nome);
    if (nome === 'contratos') { renderDicaContratos(); return; }
    if (LP.abas[nome] && el) {
      try { LP.abas[nome](el); } catch (e) { falhaCritica('Esta tela não abriu direito. Recarregue para tentar de novo.', e); }
    }
  }
  /* Não redesenha a tela enquanto a pessoa digita nela: a carga dos
     contratos termina ~1 s depois da tela abrir e apagaria o que ela
     começou a escrever no Meu perfil. */
  LP.renderAtual = function () {
    var a = document.activeElement, aba = LP.abaAtual && q('aba-' + LP.abaAtual);
    var digitando = a && aba && aba.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox';
    if (LP.abaAtual && !digitando) renderAba(LP.abaAtual);
    atualizarBolinhas();
  };
  LP.ir = function (nome, sub) {
    if (ABAS.indexOf(nome) < 0) nome = 'inicio';
    function vai() {
      try { history.pushState({ lpCamada: 0 }, '', '#' + nome); } catch (e) { location.hash = nome; }
      mostrarAba(nome);
      if (sub) setTimeout(function () { var el = q(sub); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
    }
    if (pilha.length) return LP.fecharCamada().then(vai);
    if (nome === LP.abaAtual && !sub) { window.scrollTo({ top: 0, behavior: 'smooth' }); return Promise.resolve(); }
    vai();
    return Promise.resolve();
  };
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-ir]');
    if (!a) return;
    e.preventDefault();
    LP.ir(a.getAttribute('data-ir'), a.getAttribute('data-sub'));
  });

  function renderDicaContratos() {
    var box = document.querySelector('#aba-contratos .lp-dica[data-dica="contratos"]');
    if (!box) return;
    if (ls('dica_contratos') === 'x') { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = LP.ICONE_DICA + '<div>Cada contrato nasce de uma locação. <strong>Os dados do cliente, dos equipamentos e do seu perfil entram sozinhos</strong>; você confere, envia o link e o cliente assina pelo celular.</div>' +
      '<button type="button" class="lp-dica-x" data-fechar-dica="contratos" aria-label="Fechar dica">×</button>';
  }

  /* ── contagens usadas em várias telas ───────────────────────── */
  LP.D = null;
  LP.contratos = function () {
    return (LP.st.contratosOk && LocContratosUI._st && LocContratosUI._st.lista) || [];
  };
  LP.comStatus = function () {
    var hoje = LP.D.hojeLocal();
    return (LP.st.locacoes || []).map(function (l) { return { loc: l, vis: LP.D.statusVisivel(l, hoje) }; });
  };
  LP.contagens = function () {
    var cs = LP.comStatus(), c = { atrasadas: 0, emUso: 0, reservadas: 0, encerradas: 0, ativas: 0 };
    cs.forEach(function (x) {
      if (x.vis === 'atrasada') c.atrasadas++;
      else if (x.vis === 'em_andamento') c.emUso++;
      else if (x.vis === 'reservada') c.reservadas++;
      else c.encerradas++;
    });
    c.ativas = c.atrasadas + c.emUso + c.reservadas;
    var cts = LP.contratos();
    c.ctAssinar = cts.filter(function (k) { return k.status === 'aguardando_locadora'; }).length;
    c.ctRascunho = cts.filter(function (k) { return k.status === 'rascunho'; }).length;
    c.ctCliente = cts.filter(function (k) { return k.status === 'aguardando_cliente'; }).length;
    return c;
  };
  /* unidades ocupadas por equipamento num período (regra em db.locacao.js) */
  LP.ocupado = function (inicio, fim, ignorarId) {
    return LP.D.ocupadoNoPeriodo(LP.st.locacoes, inicio, fim, ignorarId);
  };
  LP.equip = function (id) { return (LP.st.equip || []).filter(function (e) { return e.id === id; })[0] || null; };
  LP.categoria = function (id) {
    var c = (LP.st.categorias || []).filter(function (x) { return x.id === id; })[0];
    return c ? c.nome : 'Sem categoria';
  };
  LP.fotosDe = function (e) {
    return (Array.isArray(e && e.fotos) ? e.fotos : []).map(function (f) {
      return typeof f === 'string' ? f : (f && f.url) || '';
    }).filter(function (u) { return /^https:\/\//.test(u); });
  };
  LP.contratoDe = function (locId) {
    return (LP.st.contratosOk && LocContratosUI.contratoDaLocacao) ? LocContratosUI.contratoDaLocacao(locId) : null;
  };

  function atualizarBolinhas() {
    if (!LP.st.pronto) return;
    var c = LP.contagens();
    var bl = q('tabLocN'), bc = q('tabCtN');
    bl.hidden = !c.atrasadas; bl.textContent = c.atrasadas || '';
    bl.setAttribute('aria-label', c.atrasadas ? LP.plural(c.atrasadas, 'locação atrasada', 'locações atrasadas') : '');
    bc.hidden = !c.ctAssinar; bc.textContent = c.ctAssinar || '';
    bc.setAttribute('aria-label', c.ctAssinar ? LP.plural(c.ctAssinar, 'contrato para assinar', 'contratos para assinar') : '');
    var n = q('topNome');
    if (n && LP.st.locadora) n.textContent = LP.st.locadora.nome || 'Fieldo Locação';
  }

  /* ── carga ──────────────────────────────────────────────────── */
  function mostrarBloco(qual) {
    q('blocoSemLocadora').hidden = qual !== 'semLocadora';
    q('blocoPainel').hidden = qual !== 'painel';
    q('lpTabbar').hidden = qual !== 'painel';
  }

  var carregando = null;
  LP.recarregar = function () {
    if (carregando) return carregando;
    carregando = FIELDO_LOCACAO.Locadoras.me(true)
      .then(function (locadora) {
        if (!locadora) { mostrarBloco('semLocadora'); throw new Error('sem_locadora'); }
        LP.st.locadora = locadora;
        mostrarBloco('painel');
        var C = FIELDO_LOCACAO.Contratos;
        return Promise.all([
          LP.st.categorias && LP.st.categorias.length ? LP.st.categorias : FIELDO_LOCACAO.EquipamentoCategorias.listAprovadas(),
          FIELDO_LOCACAO.Equipamentos.listOwn(),
          FIELDO_LOCACAO.Locacoes.list(),
          (LP.st.contratosOk && C && C.modelo) ? C.modelo().catch(function () { return null; }) : null,
        ]);
      })
      .then(function (r) {
        LP.st.categorias = r[0] || [];
        LP.st.equip = r[1] || [];
        LP.st.locacoes = r[2] || [];
        LP.st.modelo = r[3] || null;
        LP.st.pronto = true;
        LP.renderAtual();
        if (LP.st.contratosOk) {
          return LocContratosUI.carregar(LP.st.locacoes).then(function () { LP.renderAtual(); });
        }
      })
      .catch(function (err) {
        if (err && err.message === 'sem_locadora') return;
        LP.falhou(err, 'carregar seus dados');
      })
      .then(function () { carregando = null; });
    return carregando;
  };
  LP.recarregarContratos = function () {
    if (!LP.st.contratosOk) return Promise.resolve();
    return LocContratosUI.carregar(LP.st.locacoes).then(function () { LP.renderAtual(); });
  };

  /* ── sem locadora: cadastra aqui mesmo ──────────────────────── */
  function criarLocadora() {
    var btn = q('btnCriarLoc');
    var nome = (q('inpNovaLocNome').value || '').trim();
    var whats = (q('inpNovaLocWhats').value || '').trim();
    var cidade = (q('inpNovaLocCidade').value || '').trim();
    if (!nome || LP.digits(whats).length < 10 || cidade.length < 3) { q('novaLocError').hidden = false; return; }
    q('novaLocError').hidden = true;
    btn.disabled = true; btn.textContent = 'Salvando…';
    FIELDO_LOCACAO.Locadoras.me(true)
      .then(function (l) { return l || FIELDO_LOCACAO.Locadoras.create({ nome: nome, whatsapp: whats, city: cidade }); })
      .then(function () { LP.toast('Pronto! Sua locadora foi cadastrada.'); return LP.recarregar(); })
      .catch(function (err) { LP.falhou(err, 'cadastrar a locadora'); })
      .then(function () { btn.disabled = false; btn.textContent = 'Continuar'; });
  }

  /* ── contratos: liga o módulo às camadas ────────────────────── */
  function ligarContratos() {
    LP.st.contratosOk = typeof LocContratosUI !== 'undefined' && FIELDO_LOCACAO.Contratos && typeof FieldoContratoDoc !== 'undefined';
    if (!LP.st.contratosOk) { console.error('[locacao-painel] módulo de contratos não carregou.'); return; }
    LocContratosUI.init({ esc: LP.esc, toast: function (m) { LP.toast(m); } });
    var origSheet = LocContratosUI._sheet, origFechar = LocContratosUI._fechar, ctAberto = false;
    LocContratosUI._sheet = function (t, h) {
      var r = origSheet(t, h);
      if (!ctAberto) {
        ctAberto = true;
        LP.abrirCamada(function () { ctAberto = false; origFechar(); LP.recarregarContratos(); });
      }
      return r;
    };
    LocContratosUI._fechar = function () {
      if (ctAberto) return LP.fecharCamada();
      origFechar();
      return Promise.resolve();
    };
  }
  /* abre o contrato de uma locação (cria o rascunho se não houver) */
  LP.gerarContrato = function (locId) {
    if (!LP.st.contratosOk) { LP.toast('Os contratos não carregaram. Recarregue a página.'); return; }
    var l = (LP.st.locacoes || []).filter(function (x) { return x.id === locId; })[0];
    if (!l) return;
    var vai = function () { LocContratosUI.gerar(l); };
    if (LP.temCamada()) LP.fecharCamada().then(vai); else vai();
  };

  /* ── início ─────────────────────────────────────────────────── */
  LP.iniciar = function () {
    if (typeof FIELDO === 'undefined' || !FIELDO.Auth) { falhaCritica('O app não carregou por completo. Confira a internet e recarregue.'); return; }
    if (typeof FIELDO_LOCACAO === 'undefined' || !FIELDO_LOCACAO.Locadoras) { falhaCritica('Uma parte do app não carregou. Confira a internet e recarregue.'); return; }
    if (!FIELDO.UI || typeof FIELDO.UI.esc !== 'function') { falhaCritica('O app não carregou por completo. Recarregue.'); return; }
    if (!FIELDO.Auth.isLoggedIn()) { location.replace('./index.html'); return; }
    window.addEventListener('error', function (ev) {
      if (window.__locErroMostrado) return;
      window.__locErroMostrado = true;
      falhaCritica('Algo deu errado nesta tela. Recarregue para tentar de novo — seus dados estão salvos.', ev.error || ev.message);
    });
    LP.D = FIELDO_LOCACAO.Datas;
    ligarContratos();
    q('btnCriarLoc').addEventListener('click', criarLocadora);
    var aba = abaDoHash() || 'inicio';
    try { history.replaceState({ lpCamada: 0 }, '', '#' + aba); } catch (e) {}
    mostrarAba(aba);
    LP.recarregar();
  };

  return LP;
})();
