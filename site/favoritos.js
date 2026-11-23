/* ════════════════════════════════════════════════════════════════
   Fieldo v12.40 · favoritos.js — Área do Cliente, versão 1

   Quem contrata nunca cria conta no Fieldo. Esta é a forma mais
   barata de dar memória a essa pessoa sem pedir cadastro: favoritos e
   "vistos recentemente" guardados SÓ NESTE NAVEGADOR (localStorage).

   O que isto NÃO faz, de propósito (e a tela diz isso):
     - não sincroniza entre aparelhos;
     - não manda nada para o servidor — nem o slug, nem um id anônimo.
       Não é medição: por isso a chave não cai na limpeza de
       consentimento.js (que só apaga analytics_anon_id/origem).

   Guarda só o que já é público no perfil: slug, nome, profissão,
   cidade e a foto. Nada do visitante.
════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var K_FAV = 'fieldo_cliente_favoritos';
  var K_HIST = 'fieldo_cliente_vistos';
  var MAX_FAV = 50;
  var MAX_HIST = 12;
  var SLUG = /^[a-z0-9][a-z0-9-]{1,120}$/;

  function ler(k) {
    try {
      var v = JSON.parse(localStorage.getItem(k));
      return Array.isArray(v) ? v.filter(function (x) { return x && SLUG.test(x.slug || ''); }) : [];
    } catch (e) { return []; }
  }
  function gravar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  function resumo(p) {
    return {
      slug: String(p.slug || ''),
      name: String(p.name || '').slice(0, 120),
      profissao: String(p.profissao || p.specialty || '').slice(0, 120),
      city: String(p.city || '').slice(0, 80),
      foto: /^https:\/\//.test(p.logo_url || '') ? p.logo_url : '',
      em: new Date().toISOString()
    };
  }

  var API = {
    favoritos: function () { return ler(K_FAV); },
    vistos: function () { return ler(K_HIST); },
    eFavorito: function (slug) { return ler(K_FAV).some(function (x) { return x.slug === slug; }); },
    alternar: function (p) {
      var r = resumo(p);
      if (!SLUG.test(r.slug)) return false;
      var l = ler(K_FAV);
      var i = l.findIndex(function (x) { return x.slug === r.slug; });
      if (i >= 0) { l.splice(i, 1); gravar(K_FAV, l); return false; }
      l.unshift(r);
      gravar(K_FAV, l.slice(0, MAX_FAV));
      return true;
    },
    registrarVisita: function (p) {
      var r = resumo(p);
      if (!SLUG.test(r.slug)) return;
      var l = ler(K_HIST).filter(function (x) { return x.slug !== r.slug; });
      l.unshift(r);
      gravar(K_HIST, l.slice(0, MAX_HIST));
    },
    limparVistos: function () { gravar(K_HIST, []); }
  };
  window.FieldoFavoritos = API;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── perfil.html: botão Salvar ───────────────────────────────── */
  var ICONE = '<svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>';

  var _ligado = false;
  API.ligarPerfil = function (prof) {
    if (_ligado || !prof || !SLUG.test(prof.slug || '')) return;
    _ligado = true;
    API.registrarVisita(prof);
    var btn = document.getElementById('btnFav');
    if (!btn) return;
    function pintar(on) {
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('fav-on', on);
      btn.innerHTML = ICONE.replace('<svg', '<svg fill="' + (on ? 'currentColor' : 'none') + '"') +
        '<span>' + (on ? 'Salvo' : 'Salvar') + '</span>';
      btn.setAttribute('aria-label', on ? 'Remover dos salvos' : 'Salvar este profissional neste aparelho');
    }
    pintar(API.eFavorito(prof.slug));
    btn.hidden = false;
    btn.addEventListener('click', function () {
      var on = API.alternar(prof);
      pintar(on);
      try {
        if (window.FIELDO && FIELDO.UI && FIELDO.UI.toast) {
          FIELDO.UI.toast(on ? 'Salvo neste aparelho. Está em Explorar → Seus salvos.' : 'Removido dos salvos.');
        }
      } catch (e) {}
    });
  };

  /* ── explorar.html: "Seus salvos" e "Vistos recentemente" ───── */
  function linha(p) {
    var ini = esc((p.name || '?').trim().charAt(0).toUpperCase());
    return '<li class="cf-item"><a href="/p/' + encodeURIComponent(p.slug) + '">' +
      (p.foto ? '<img src="' + esc(p.foto) + '" alt="" loading="lazy" width="40" height="40">' : '<span class="cf-ini" aria-hidden="true">' + ini + '</span>') +
      '<span class="cf-txt"><strong>' + esc(p.name || 'Profissional') + '</strong>' +
      '<span>' + esc([p.profissao, p.city].filter(Boolean).join(' · ')) + '</span></span></a></li>';
  }

  function montarExplorar() {
    var box = document.getElementById('clienteSalvos');
    if (!box) return;
    var fav = API.favoritos();
    var vis = API.vistos().filter(function (v) { return !fav.some(function (f) { return f.slug === v.slug; }); }).slice(0, 6);
    if (!fav.length && !vis.length) { box.hidden = true; return; }
    var html = '';
    if (fav.length) {
      html += '<h2 class="pub-rotulo">Seus salvos</h2><ul class="cf-lista">' + fav.map(linha).join('') + '</ul>';
    }
    if (vis.length) {
      html += '<div class="cf-cab"><h2 class="pub-rotulo">Vistos recentemente</h2>' +
        '<button type="button" class="cf-limpar" id="cfLimpar">Limpar</button></div>' +
        '<ul class="cf-lista">' + vis.map(linha).join('') + '</ul>';
    }
    html += '<p class="cf-nota">Fica salvo só neste aparelho, sem cadastro. Em outro celular ou navegador a lista começa vazia.</p>';
    box.innerHTML = html;
    box.hidden = false;
    var b = document.getElementById('cfLimpar');
    if (b) b.addEventListener('click', function () { API.limparVistos(); montarExplorar(); });
  }

  var css = '' +
    '.contact-btn.fav[hidden]{display:none}' +
    '.contact-btn.fav.fav-on{color:var(--gold-d,#7a5a10)}' +
    '.cf-box{margin:0 0 1.5rem}' +
    '.cf-cab{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;margin-top:1rem}' +
    '.cf-limpar{font:inherit;font-size:.78rem;background:none;border:0;color:var(--muted,#625d57);cursor:pointer;padding:.25rem 0}' +
    '.cf-lista{list-style:none;margin:.5rem 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.5rem}' +
    '.cf-item a{display:flex;align-items:center;gap:.65rem;padding:.6rem .7rem;border-radius:12px;text-decoration:none;' +
      'color:inherit;border:1px solid var(--border,rgba(14,14,20,.09));background:var(--card,#f5f2ec);min-width:0}' +
    '.cf-item img,.cf-ini{width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0}' +
    '.cf-ini{display:flex;align-items:center;justify-content:center;background:var(--paper3,#e4dfd2);font-weight:600}' +
    '.cf-txt{display:flex;flex-direction:column;min-width:0}' +
    '.cf-txt strong{font-size:.88rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.cf-txt span{font-size:.76rem;color:var(--muted,#625d57);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.cf-nota{font-size:.74rem;color:var(--muted,#625d57);margin:.6rem 0 0}';

  function iniciar() {
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
    montarExplorar();
    /* perfil.html: se o perfil carregou antes deste script, liga agora */
    if (window._prof) API.ligarPerfil(window._prof);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
