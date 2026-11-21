/* ============================================================
   Fieldo Locação · painel-fiel.js  v12.24 — assistente de IA
   ─────────────────────────────────────────────────────────────
   Decisão do dono (31/10): na Locação o assistente só destrava com o
   plano Pro, 50 mensagens por mês.

   - Início ganha um cartão: com Pro, abre a conversa; sem Pro, explica
     o que ele faz e leva ao pedido do Pro (ainda não há checkout da
     Locação: a ativação é feita pela equipe).
   - A conversa abre em tela cheia (LP.tela), com microfone quando o
     navegador tem reconhecimento de voz.
   - Chama a mesma Edge Function do profissional com contexto 'locacao'.
     O servidor confere o plano e a cota de novo: esconder o botão aqui
     é só conforto, não é a trava.
   - Quando o assistente grava algo, o painel recarrega os dados.
============================================================ */
(function () {
  'use strict';
  if (typeof LP === 'undefined' || typeof FIELDO === 'undefined') return;

  var esc = LP.esc;
  var URL_FN = FIELDO.config.EDGE_URL + '/assistant';
  var SUPORTE_WA = '5512988406425';
  var MAX_HISTORY = 40, MAX_VISIVEIS = 60;
  var GRAVAM = { loc_criar_equipamento: 1, loc_editar_equipamento: 1, loc_nova_locacao: 1, loc_alterar_locacao: 1,
                 loc_devolucao: 1, loc_cancelar_locacao: 1, loc_contrato: 1 };
  var SUGESTOES = [
    ['Quem devolve hoje e amanhã?', 'Quem devolve hoje e amanhã?'],
    ['Registrar um aluguel', 'Quero registrar um aluguel. Vai me perguntando.'],
    ['Tem equipamento livre?', 'O que tenho livre de sexta a segunda?'],
    ['Renovar um aluguel', 'Quero renovar um aluguel.'],
    ['Mandar contrato', 'Manda o contrato do último aluguel para o cliente assinar.'],
    ['Resumo do mês', 'Como está a locadora este mês?'],
  ];

  function ehPro() {
    var l = LP.st.locadora || {};
    if (l.plan !== 'pro') return false;
    return !l.plan_expires_at || new Date(l.plan_expires_at).getTime() > Date.now();
  }
  function linkPedirPro() {
    var l = LP.st.locadora || {};
    var msg = 'Olá! Quero ativar o Pro da Locação (assistente de IA) para a ' + (l.nome || 'minha locadora') + '.';
    return 'https://wa.me/' + SUPORTE_WA + '?text=' + encodeURIComponent(msg);
  }

  /* ── estilo (só desta tela; tokens do fieldo.css) ─────────────── */
  var css = document.createElement('style');
  css.textContent =
    '.fl-card{display:grid;gap:.6rem}' +
    '.fl-card h2{display:flex;align-items:center;gap:.45rem}' +
    '.fl-card>.btn{justify-content:center}' +
    '.fl-selo{font:600 .66rem var(--mono,monospace);letter-spacing:.06em;text-transform:uppercase;color:var(--gold-text);background:var(--gold-bg);border:1px solid var(--gold-bd);border-radius:999px;padding:.1rem .45rem}' +
    '.fl-chips{display:flex;flex-wrap:wrap;gap:.4rem}' +
    '.fl-chip{appearance:none;border:1px solid var(--border2);background:var(--surface,var(--paper));color:var(--ink);border-radius:999px;padding:.45rem .75rem;font:500 .82rem var(--sans);cursor:pointer;text-align:left}' +
    '.fl-chip:focus-visible,.fl-env:focus-visible,.fl-mic:focus-visible{outline:2px solid var(--gold);outline-offset:2px}' +
    '.fl-lista{display:grid;gap:.6rem;margin-bottom:1rem}' +
    '.fl-b{max-width:88%;padding:.65rem .8rem;border-radius:14px;font-size:.92rem;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}' +
    '.fl-b.eu{justify-self:end;background:var(--ink);color:#f3eee2;border-bottom-right-radius:4px}' +
    '.fl-b.ia{justify-self:start;background:var(--paper);border:1px solid var(--border);border-bottom-left-radius:4px;color:var(--ink)}' +
    '.fl-b.ia .fl-det{display:block;margin-top:.55rem;padding-top:.55rem;border-top:1px dashed var(--border2);color:var(--text2)}' +
    '.fl-b a{color:var(--gold-text);word-break:break-all}' +
    '.fl-b .fl-wa{display:inline-flex;align-items:center;gap:.35rem;margin-top:.5rem;background:var(--wa);color:#fff;border-radius:8px;padding:.45rem .7rem;text-decoration:none;font-weight:500;word-break:normal}' +
    '.fl-b.erro{justify-self:start;background:var(--red-bg);border:1px solid var(--red-bd);color:var(--red)}' +
    '.fl-dig{justify-self:start;color:var(--muted);font-size:.85rem}' +
    '.fl-topo{display:flex;justify-content:space-between;align-items:center;gap:.6rem;margin-bottom:.8rem;font-size:.8rem;color:var(--muted)}' +
    '.fl-topo button{appearance:none;background:none;border:0;color:var(--gold-text);font:500 .8rem var(--sans);cursor:pointer;padding:.2rem 0}' +
    '.fl-vazio p{color:var(--muted);font-size:.88rem;line-height:1.5;margin:.2rem 0 .8rem}' +
    '.lp-tela-pe .fl-pe{display:flex;gap:.45rem;align-items:flex-end;width:100%}' +
    '.fl-pe textarea{flex:1;min-width:0;resize:none;max-height:120px;border:1px solid var(--border2);border-radius:12px;padding:.6rem .7rem;font:400 .95rem var(--sans);background:var(--bg);color:var(--ink)}' +
    '.lp-tela-pe .fl-pe .fl-mic,.lp-tela-pe .fl-pe .fl-env{flex:none;width:44px;height:44px;border-radius:12px;border:1px solid var(--border2);background:var(--paper);color:var(--ink);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0}' +
    '.lp-tela-pe .fl-pe .fl-env{background:var(--gold);border-color:var(--gold);color:#fff}' +
    '.fl-mic.ouvindo{background:var(--red-bg);border-color:var(--red-bd);color:var(--red)}' +
    '.fl-pe button:disabled{opacity:.5;cursor:default}';
  document.head.appendChild(css);

  /* ── cartão do Início ─────────────────────────────────────────── */
  LP.fielCartao = function () {
    if (ehPro()) {
      return '<div class="lp-card fl-card"><h2>Assistente de IA <span class="fl-selo">Pro</span></h2>' +
        '<p class="sub" style="margin:0">Fale ou escreva e ele faz: registra aluguel conferindo o estoque, renova, dá baixa e manda o contrato para o cliente assinar.</p>' +
        '<div class="fl-chips">' + SUGESTOES.slice(0, 3).map(function (s) {
          return '<button type="button" class="fl-chip" data-fiel="' + esc(s[1]) + '">' + esc(s[0]) + '</button>';
        }).join('') + '</div>' +
        '<button type="button" class="btn btn--primary" data-fiel="">Falar com o assistente</button></div>';
    }
    if (LP.ls('fiel_pro_oculto') === '1') return '';
    return '<div class="lp-card fl-card"><h2>Assistente de IA <span class="fl-selo">Pro</span></h2>' +
      '<p class="sub" style="margin:0">Diga “aluga 2 betoneiras pro Carlos até sexta e manda o contrato” e ele registra, confere o estoque, calcula o valor e gera o link de assinatura. Faz parte do Pro da Locação, com 50 mensagens por mês.</p>' +
      '<div class="lp-atalhos"><a class="btn btn--primary" target="_blank" rel="noopener" href="' + esc(linkPedirPro()) + '">Quero o Pro</a>' +
      '<button type="button" class="btn btn--ghost" data-acao="fiel-ocultar">Agora não</button></div></div>';
  };

  /* ── estado da conversa (por locadora, só neste aparelho) ─────── */
  var apiHistory = [], visiveis = [], usage = null, enviando = false, bloqueado = false;
  function chave() { return 'fieldo_loc_fiel_v1_' + ((LP.st.locadora && LP.st.locadora.id) || 'x'); }
  function carregar() {
    try {
      var d = JSON.parse(localStorage.getItem(chave()) || 'null');
      apiHistory = d && Array.isArray(d.h) ? d.h : [];
      visiveis = d && Array.isArray(d.v) ? d.v : [];
      usage = d && d.u ? d.u : null;
    } catch (e) { apiHistory = []; visiveis = []; usage = null; }
  }
  function salvar() {
    if (apiHistory.length > MAX_HISTORY) {
      /* corta só no começo de uma pergunta (texto do usuário), nunca entre
         o pedido de ferramenta e a resposta dela */
      for (var i = 0; i < apiHistory.length; i++) {
        var m = apiHistory[i];
        if (m && m.role === 'user' && typeof m.content === 'string' && apiHistory.length - i <= MAX_HISTORY) { apiHistory = apiHistory.slice(i); break; }
      }
    }
    if (visiveis.length > MAX_VISIVEIS) visiveis = visiveis.slice(-MAX_VISIVEIS);
    try { localStorage.setItem(chave(), JSON.stringify({ h: apiHistory, v: visiveis, u: usage })); } catch (e) {}
  }

  /* ── desenho ──────────────────────────────────────────────────── */
  function q(id) { return document.getElementById(id); }
  function textoComLinks(t) {
    return esc(t).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, function (u) {
      var real = u.replace(/&amp;/g, '&');
      if (/^https:\/\/wa\.me\//.test(real)) return '<a class="fl-wa" target="_blank" rel="noopener" href="' + u + '">' + LP.ICONE_WA + 'Enviar pelo WhatsApp</a>';
      return '<a target="_blank" rel="noopener" href="' + u + '">' + u + '</a>';
    });
  }
  /* link de assinatura e WhatsApp vêm do RESULTADO da ferramenta, não do
     texto da IA: uma URL longa copiada pelo modelo pode sair com um
     caractere trocado, e aí o cliente recebe um link quebrado. */
  function linksDoContrato(novas) {
    var achado = null;
    novas.forEach(function (m) {
      if (!m || m.role !== 'user' || !Array.isArray(m.content)) return;
      m.content.forEach(function (b) {
        if (!b || b.type !== 'tool_result' || typeof b.content !== 'string') return;
        try {
          var j = JSON.parse(b.content);
          if (j && j.ok && typeof j.link === 'string' && /^https:\/\/fieldo-zelo\.com\.br\/locacao\/contrato-assinar\.html#t=/.test(j.link) &&
              typeof j.whatsapp === 'string' && /^https:\/\/wa\.me\//.test(j.whatsapp)) achado = { link: j.link, wa: j.whatsapp };
        } catch (e) {}
      });
    });
    return achado;
  }
  function bolha(quem, texto, extra) {
    var lista = q('flLista'); if (!lista) return;
    var d = document.createElement('div');
    d.className = 'fl-b ' + (quem === 'user' ? 'eu' : quem === 'erro' ? 'erro' : 'ia');
    if (quem === 'assistant') {
      var partes = String(texto || '').split(/\n\s*\n/);
      var resumo = partes.shift();
      d.innerHTML = textoComLinks(resumo) + (partes.length ? '<span class="fl-det">' + textoComLinks(partes.join('\n\n')) + '</span>' : '');
      if (extra && extra.wa) {
        var det = document.createElement('span'); det.className = 'fl-det';
        det.innerHTML = 'Link de assinatura: <a target="_blank" rel="noopener" href="' + esc(extra.link) + '">' + esc(extra.link) + '</a><br/>' +
          '<a class="fl-wa" target="_blank" rel="noopener" href="' + esc(extra.wa) + '">' + LP.ICONE_WA + 'Enviar ao cliente pelo WhatsApp</a>';
        d.appendChild(det);
      }
    } else {
      d.textContent = texto;
    }
    lista.appendChild(d);
    var vazio = q('flVazio'); if (vazio) vazio.hidden = true;
    setTimeout(function () { d.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, 30);
    return d;
  }
  function topo() {
    var el = q('flTopo'); if (!el) return;
    var cota = usage ? (usage.mensagens_restantes + ' de ' + usage.limite + ' mensagens restantes este mês') : '50 mensagens por mês no Pro';
    el.innerHTML = '<span>' + esc(cota) + '</span>' + (visiveis.length ? '<button type="button" id="flNova">Nova conversa</button>' : '');
  }
  function travar(sim) {
    ['flEnv', 'flMic'].forEach(function (id) { var b = q(id); if (b) b.disabled = sim; });
    var t = q('flTexto'); if (t) t.disabled = sim && bloqueado;
  }

  function html() {
    return '<div class="fl-topo" id="flTopo"></div>' +
      '<div class="fl-vazio" id="flVazio"' + (visiveis.length ? ' hidden' : '') + '>' +
        '<p>Peça do jeito que você fala. Ele confere o estoque, calcula pela diária e pergunta só o que faltar. CPF, CNPJ, Pix e a sua assinatura no contrato continuam só com você, na tela.</p>' +
        '<div class="fl-chips">' + SUGESTOES.map(function (s) { return '<button type="button" class="fl-chip" data-fiel-msg="' + esc(s[1]) + '">' + esc(s[0]) + '</button>'; }).join('') + '</div>' +
      '</div>' +
      '<div class="fl-lista" id="flLista" aria-live="polite"></div>';
  }
  var MIC = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/></svg>';
  var ENV = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  /* ── voz → texto ──────────────────────────────────────────────── */
  var Reconhecer = window.SpeechRecognition || window.webkitSpeechRecognition, rec = null, ouvindo = false;
  function pararEscuta() { if (rec && ouvindo) { try { rec.stop(); } catch (e) {} } }
  function alternarEscuta() {
    if (!Reconhecer) return;
    if (ouvindo) { pararEscuta(); return; }
    rec = new Reconhecer(); rec.lang = 'pt-BR'; rec.interimResults = true; rec.continuous = false;
    var base = q('flTexto').value ? q('flTexto').value.replace(/\s*$/, ' ') : '';
    rec.onresult = function (e) {
      var t = ''; for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      q('flTexto').value = base + t; ajustar();
    };
    rec.onend = function () { ouvindo = false; var b = q('flMic'); if (b) { b.classList.remove('ouvindo'); b.setAttribute('aria-pressed', 'false'); } };
    rec.onerror = function (e) { if (e && e.error === 'not-allowed') LP.toast('Libere o microfone para este site para falar com o assistente.'); };
    try { rec.start(); ouvindo = true; q('flMic').classList.add('ouvindo'); q('flMic').setAttribute('aria-pressed', 'true'); } catch (e) { ouvindo = false; }
  }
  function ajustar() { var t = q('flTexto'); if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; }

  /* ── envio ────────────────────────────────────────────────────── */
  function erroPro(msg) {
    var d = bolha('erro', msg || 'O assistente da Locação faz parte do plano Pro.');
    if (d) {
      var a = document.createElement('a');
      a.className = 'fl-wa'; a.target = '_blank'; a.rel = 'noopener'; a.href = linkPedirPro();
      a.innerHTML = LP.ICONE_WA + 'Pedir o Pro';
      d.appendChild(document.createElement('br')); d.appendChild(a);
    }
  }
  function enviar(texto) {
    texto = String(texto || '').trim();
    if (!texto || enviando || bloqueado) return;
    pararEscuta();
    enviando = true; travar(true);
    bolha('user', texto); visiveis.push({ r: 'user', t: texto }); salvar(); topo();
    var dig = document.createElement('div'); dig.className = 'fl-dig'; dig.textContent = 'Fazendo…';
    q('flLista').appendChild(dig);
    var antes = apiHistory.length;
    FIELDO.Auth.Session.getAccessToken().then(function (token) {
      if (!token) throw { sessao: true };
      return fetch(URL_FN, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: texto, history: apiHistory, contexto: 'locacao' }),
      }).then(function (res) {
        return res.json().catch(function () { return null; }).then(function (body) { return { res: res, body: body || {} }; });
      });
    }).then(function (r) {
      dig.remove();
      if (!r.res.ok) {
        if (r.res.status === 401) { bolha('erro', 'Sua sessão expirou. Entre de novo para continuar.'); return; }
        if (r.body.precisa_pro) { erroPro(r.body.erro); return; }
        if (r.res.status === 429) { bloqueado = true; bolha('erro', r.body.erro || 'Você usou as mensagens deste mês. Renova no dia 1º.'); return; }
        bolha('erro', r.body.erro || 'Não deu para responder agora. Tente de novo em instantes.');
        return;
      }
      var novas = Array.isArray(r.body.history) ? r.body.history.slice(antes) : [];
      if (Array.isArray(r.body.history)) apiHistory = r.body.history;
      if (r.body.usage) usage = r.body.usage;
      var resp = r.body.reply || 'Feito.';
      var extra = linksDoContrato(novas);
      bolha('assistant', resp, extra); visiveis.push(extra ? { r: 'assistant', t: resp, x: extra } : { r: 'assistant', t: resp });
      salvar(); topo();
      /* gravou algo? atualiza as telas do painel por trás */
      var gravou = novas.some(function (m) {
        return m && m.role === 'assistant' && Array.isArray(m.content) && m.content.some(function (b) { return b && b.type === 'tool_use' && GRAVAM[b.name]; });
      });
      if (gravou && LP.recarregar) LP.recarregar();
    }).catch(function (e) {
      dig.remove();
      bolha('erro', e && e.sessao ? 'Sua sessão expirou. Entre de novo para continuar.' : 'Sem conexão com o assistente agora. Confira a internet e tente de novo.');
    }).then(function () {
      enviando = false; travar(bloqueado);
      var t = q('flTexto'); if (t && !bloqueado) t.focus();
    });
  }

  /* ── abrir ────────────────────────────────────────────────────── */
  LP.fielAbrir = function (sugestao) {
    if (!ehPro()) { LP.toast('O assistente faz parte do Pro da Locação.'); return; }
    carregar(); bloqueado = false;
    LP.tela.abrir({
      titulo: 'Assistente',
      html: html(),
      rodape: '<form class="fl-pe" id="flForm" autocomplete="off">' +
        (Reconhecer ? '<button type="button" class="fl-mic" id="flMic" aria-label="Falar" aria-pressed="false">' + MIC + '</button>' : '') +
        '<textarea id="flTexto" rows="1" placeholder="Escreva ou fale o que precisa" aria-label="Mensagem para o assistente"></textarea>' +
        '<button type="submit" class="fl-env" id="flEnv" aria-label="Enviar">' + ENV + '</button></form>',
      aoFechar: function () { pararEscuta(); },
    });
    visiveis.forEach(function (m) { bolha(m.r === 'user' ? 'user' : 'assistant', m.t, m.x); });
    topo();
    q('flForm').addEventListener('submit', function (e) { e.preventDefault(); var t = q('flTexto'); var v = t.value; t.value = ''; ajustar(); enviar(v); });
    q('flTexto').addEventListener('input', ajustar);
    q('flTexto').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 900px)').matches) { e.preventDefault(); q('flForm').requestSubmit(); }
    });
    if (q('flMic')) q('flMic').addEventListener('click', alternarEscuta);
    if (sugestao) {
      if (visiveis.length) { q('flTexto').value = sugestao; ajustar(); q('flTexto').focus(); }
      else enviar(sugestao);
    }
  };

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-fiel],[data-fiel-msg],#flNova,[data-acao="fiel-ocultar"]');
    if (!t) return;
    if (t.hasAttribute('data-fiel')) { LP.fielAbrir(t.getAttribute('data-fiel')); return; }
    if (t.hasAttribute('data-fiel-msg')) { enviar(t.getAttribute('data-fiel-msg')); return; }
    if (t.id === 'flNova') {
      apiHistory = []; visiveis = []; salvar();
      q('flLista').innerHTML = ''; q('flVazio').hidden = false; topo();
      return;
    }
    if (t.getAttribute('data-acao') === 'fiel-ocultar') { LP.ls('fiel_pro_oculto', '1'); LP.renderAtual(); }
  });
})();
