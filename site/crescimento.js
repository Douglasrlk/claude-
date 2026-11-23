/* ════════════════════════════════════════════════════════════════
   Fieldo v12.40 · crescimento.js — painel do profissional

   Duas coisas, ambas lidas do banco com a sessão do próprio
   profissional (a RLS decide; nada aqui usa chave de serviço):

   1. AVISOS DO SISTEMA (public.notificacoes)
      Escritos pelo job diário plano_ciclo_diario(): "seu Pro termina
      em N dias" nos últimos 5 dias, e "sua conta voltou ao grátis"
      quando o prazo passa. Aqui só se lê e se marca como lido.

   2. INTELIGÊNCIA COMERCIAL (public.minhas_metricas)
      Quantas pessoas viram o perfil e chamaram no WhatsApp nos
      últimos 30 dias. O total é para todos; de onde vieram e a
      comparação com o mês anterior são do Pro — quem corta é a
      função SQL, não esta tela.

   Tudo degrada em silêncio: sem rede, sem a migration aplicada ou
   sem sessão, as duas seções simplesmente não aparecem.
════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (!window.FIELDO || !FIELDO.config || !FIELDO.Auth || !FIELDO.Auth.Session) return;

  var CFG = FIELDO.config;

  var ORIGENS = {
    google:      'Google',
    organico:    'Outros buscadores',
    meta:        'Instagram / Facebook',
    explorar:    'Busca do Fieldo',
    home:        'Página inicial do Fieldo',
    lista_local: 'Lista da sua cidade',
    relatorio:   'Relatório enviado ao cliente',
    direto:      'Link direto (WhatsApp, cartão, QR)',
    studio:      'Vídeos do Fieldo Studio'      /* v12.41 · studio_<código> agrupado */
  };
  function rotulo(o) {
    if (ORIGENS[o]) return ORIGENS[o];
    if (/^studio_/.test(o)) return ORIGENS.studio;
    if (/^card_/.test(o)) return 'Card compartilhado';
    if (/netlify\.app|fieldo/i.test(o)) return ORIGENS.direto;
    return o;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return Number(n || 0).toLocaleString('pt-BR'); }

  function req(token, metodo, caminho, corpo) {
    return fetch(CFG.REST_URL + '/' + caminho, {
      method: metodo,
      headers: {
        apikey: CFG.ANON_KEY,
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo)
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.status === 204 ? null : r.text().then(function (t) { return t ? JSON.parse(t) : null; });
    });
  }

  /* ── estilos (escopo .cr-*) ─────────────────────────────────── */
  var css = '' +
    '.cr-avisos{display:flex;flex-direction:column;gap:.5rem;margin:0 0 1rem}' +
    '.cr-aviso{display:flex;gap:.75rem;align-items:flex-start;padding:.85rem 1rem;border-radius:12px;' +
      'background:var(--gold-bg);border:1px solid var(--gold-bd);color:var(--text)}' +
    '.cr-aviso--fim{background:var(--paper2);border-color:var(--border)}' +
    '.cr-aviso-corpo{flex:1;min-width:0}' +
    '.cr-aviso-tit{font-size:.88rem;font-weight:600;margin:0 0 .15rem}' +
    '.cr-aviso-txt{font-size:.8rem;line-height:1.45;color:var(--text2);margin:0}' +
    '.cr-aviso-acoes{display:flex;gap:.75rem;margin-top:.5rem;flex-wrap:wrap}' +
    '.cr-aviso-acoes a,.cr-aviso-acoes button{font:inherit;font-size:.78rem;font-weight:600;color:var(--gold-d);' +
      'background:none;border:0;padding:0;cursor:pointer;text-decoration:none}' +
    '.cr-aviso-acoes button{color:var(--muted);font-weight:500}' +
    '.cr-card{margin:0 0 1.25rem;padding:1rem 1.1rem;border-radius:14px;background:var(--card);border:1px solid var(--border)}' +
    '.cr-lbl{font-size:.7rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 .6rem}' +
    '.cr-nums{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem}' +
    '.cr-num b{display:block;font-size:1.35rem;font-weight:600;color:var(--text);line-height:1.1}' +
    '.cr-num span{font-size:.72rem;color:var(--muted);line-height:1.3;display:block;margin-top:.2rem}' +
    '.cr-delta{font-size:.7rem;font-weight:600;margin-left:.25rem}' +
    '.cr-delta--sobe{color:#2f7a3b}.cr-delta--desce{color:#a3402f}' +
    '.cr-nota{font-size:.78rem;line-height:1.45;color:var(--text2);margin:.8rem 0 0}' +
    '.cr-origens{list-style:none;margin:.9rem 0 0;padding:0;display:flex;flex-direction:column;gap:.45rem}' +
    '.cr-origem{font-size:.78rem;color:var(--text2)}' +
    '.cr-origem-top{display:flex;justify-content:space-between;gap:.5rem;margin-bottom:.2rem}' +
    '.cr-barra{height:6px;border-radius:3px;background:var(--paper3);overflow:hidden}' +
    '.cr-barra i{display:block;height:100%;background:var(--gold-l);border-radius:3px}' +
    '.cr-trava{display:flex;justify-content:space-between;align-items:center;gap:.75rem;margin-top:.9rem;' +
      'padding-top:.8rem;border-top:1px solid var(--border);font-size:.78rem;color:var(--text2)}' +
    '.cr-trava a,.cr-acao{color:var(--gold-d);font-weight:600;text-decoration:none;white-space:nowrap}' +
    '.cr-acoes{display:flex;gap:1rem;flex-wrap:wrap;margin-top:.9rem}' +
    '.cr-acao{font-size:.8rem}';

  function injetarCss() {
    if (document.getElementById('cr-css')) return;
    var st = document.createElement('style');
    st.id = 'cr-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* onde as seções entram: logo antes da barra de plano, que já fica
     no topo do painel, perto do "próximo passo". */
  function ancora() {
    return document.getElementById('planCallout') || document.getElementById('dashPasso');
  }

  /* ── 1. avisos ──────────────────────────────────────────────── */
  function renderAvisos(token, lista) {
    if (!lista || !lista.length) return;
    var alvo = ancora();
    if (!alvo || !alvo.parentNode) return;
    var box = document.createElement('section');
    box.className = 'cr-avisos';
    box.setAttribute('aria-label', 'Avisos do Fieldo');
    lista.forEach(function (n) {
      var el = document.createElement('div');
      el.className = 'cr-aviso' + (n.tipo === 'pro_encerrado' ? ' cr-aviso--fim' : '');
      el.setAttribute('role', 'status');
      el.innerHTML =
        '<div class="cr-aviso-corpo">' +
          '<p class="cr-aviso-tit">' + esc(n.titulo) + '</p>' +
          '<p class="cr-aviso-txt">' + esc(n.mensagem) + '</p>' +
          '<div class="cr-aviso-acoes">' +
            (n.link ? '<a href="' + esc(n.link) + '">' + (n.tipo === 'sistema' ? 'Ver' : n.tipo === 'studio_resultado' ? 'Ver o vídeo' : 'Ver planos') + '</a>' : '') +
            '<button type="button">Entendi</button>' +
          '</div>' +
        '</div>';
      el.querySelector('button').addEventListener('click', function () {
        el.remove();
        if (!box.children.length) box.remove();
        req(token, 'PATCH', 'notificacoes?id=eq.' + encodeURIComponent(n.id), { lida_em: new Date().toISOString() })
          .catch(function () {});
      });
      box.appendChild(el);
    });
    alvo.parentNode.insertBefore(box, alvo);
  }

  /* ── 2. desempenho ──────────────────────────────────────────── */
  function delta(atual, antes) {
    if (!antes) return '';
    var d = Math.round(((atual - antes) / antes) * 100);
    if (!d) return '';
    return '<span class="cr-delta cr-delta--' + (d > 0 ? 'sobe' : 'desce') + '">' +
      (d > 0 ? '+' : '') + d + '%</span>';
  }

  function renderDesempenho(m) {
    if (!m || !m.atual) return;
    var alvo = ancora();
    if (!alvo || !alvo.parentNode) return;

    var v = Number(m.atual.visualizacoes) || 0;
    var c = Number(m.atual.cliques_whatsapp) || 0;
    var taxa = v > 0 ? (Math.round((c / v) * 1000) / 10).toString().replace('.', ',') + '%' : '—';
    var ant = m.anterior || null;

    var html =
      '<p class="cr-lbl">Seu perfil nos últimos ' + esc(m.dias) + ' dias</p>' +
      '<div class="cr-nums">' +
        '<div class="cr-num"><b>' + fmt(v) + (ant ? delta(v, ant.visualizacoes) : '') + '</b><span>pessoas viram seu perfil</span></div>' +
        '<div class="cr-num"><b>' + fmt(c) + (ant ? delta(c, ant.cliques_whatsapp) : '') + '</b><span>chamaram no WhatsApp</span></div>' +
        '<div class="cr-num"><b>' + taxa + '</b><span>de quem viu, chamou</span></div>' +
      '</div>';

    if (v === 0) {
      html += '<p class="cr-nota">Ainda ninguém abriu seu perfil neste período. Mandar o link do perfil para clientes antigos e registrar serviço com foto é o que mais traz visita.</p>';
    } else if (m.amostra_pequena) {
      html += '<p class="cr-nota">Ainda são poucas visitas, então esses números mudam bastante de uma semana para outra. É normal no começo.</p>';
    }

    /* v12.41 · cada vídeo do Studio tem a sua origem (studio_<código>):
       aqui elas somam numa linha só; o detalhe por vídeo fica no Studio */
    if (Array.isArray(m.por_origem)) {
      var juntas = {}, ordem = [];
      m.por_origem.forEach(function (o) {
        var k = /^studio_/.test(o.origem) ? 'studio' : o.origem;
        if (!juntas[k]) { juntas[k] = { origem: k, visualizacoes: 0, cliques_whatsapp: 0 }; ordem.push(k); }
        juntas[k].visualizacoes += Number(o.visualizacoes) || 0;
        juntas[k].cliques_whatsapp += Number(o.cliques_whatsapp) || 0;
      });
      m.por_origem = ordem.map(function (k) { return juntas[k]; }).sort(function (a, b) { return b.visualizacoes - a.visualizacoes; });
    }
    if (m.pro && Array.isArray(m.por_origem) && m.por_origem.length) {
      var max = m.por_origem.reduce(function (a, o) { return Math.max(a, Number(o.visualizacoes) || 0); }, 0) || 1;
      html += '<ul class="cr-origens" aria-label="De onde vieram as visitas">' +
        m.por_origem.slice(0, 5).map(function (o) {
          var ov = Number(o.visualizacoes) || 0, oc = Number(o.cliques_whatsapp) || 0;
          return '<li class="cr-origem"><div class="cr-origem-top"><span>' + esc(rotulo(o.origem)) + '</span>' +
            '<span>' + fmt(ov) + (oc ? ' · ' + fmt(oc) + ' no WhatsApp' : '') + '</span></div>' +
            '<div class="cr-barra"><i style="width:' + Math.max(4, Math.round((ov / max) * 100)) + '%"></i></div></li>';
        }).join('') + '</ul>';
    } else if (!m.pro) {
      html += '<div class="cr-trava"><span>Veja de onde vêm seus clientes (Google, Instagram, busca do Fieldo) e compare com o mês anterior.</span>' +
        '<a href="planos.html">Pro →</a></div>';
    }

    html += '<div class="cr-acoes">' +
      '<a class="cr-acao" href="assistente.html?sugestao=perfil_seo">Melhorar meu perfil com o assistente →</a>' +
      '<a class="cr-acao" href="studio.html">Transformar um serviço em vídeo →</a>' +
      '</div>';

    var card = document.createElement('section');
    card.className = 'cr-card';
    card.setAttribute('aria-label', 'Desempenho do seu perfil');
    card.innerHTML = html;
    alvo.parentNode.insertBefore(card, alvo.nextSibling);
  }

  function iniciar() {
    injetarCss();
    var tokenP;
    try { tokenP = FIELDO.Auth.Session.getAccessToken(); } catch (e) { return; }
    Promise.resolve(tokenP).then(function (token) {
      if (!token) return;
      req(token, 'GET', 'notificacoes?lida_em=is.null&select=id,tipo,titulo,mensagem,link,criada_em&order=criada_em.desc&limit=3')
        .then(function (l) { renderAvisos(token, l); })
        .catch(function () {});
      fetch(CFG.REST_URL + '/rpc/minhas_metricas', {
        method: 'POST',
        headers: { apikey: CFG.ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_dias: 30 })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(renderDesempenho)
        .catch(function () {});
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
