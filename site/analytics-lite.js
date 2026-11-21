/* Fieldo · analytics-lite.js — v10.23 · consentimento v12.36
 *
 * Tracker mínimo para páginas que não carregam db.js. Hoje é só a
 * index.html, e é assim de propósito: ela é a landing pública, a
 * página mais sensível a peso do site inteiro, e não tem nenhuma outra
 * razão pra carregar 240KB de db.js além desta. Colar db.js aqui só
 * pra medir custaria exatamente a conversão que a medição quer explicar
 * — a troca errada.
 *
 * Por isso este arquivo reimplementa o mínimo de FIELDO.Analytics
 * (ver db.js): mesmo formato de evento, mesmo destino (analytics_events),
 * mesma regra de atribuição de origem (FIELDO.Origem, duplicada aqui em
 * miniatura). Se um dia esta página passar a carregar db.js por outro
 * motivo, este arquivo fica redundante e pode sair.
 *
 * Igual ao resto do projeto: nunca pode atrapalhar a página. Todo fetch
 * é best-effort, com .catch mudo — um analytics fora do ar não pode
 * travar quem só queria criar o perfil.
 */
(function () {
  'use strict';

  /* v12.36 · LGPD: nada é medido sem "Aceitar" no banner de cookies
     (consentimento.js). Mesma regra de FIELDO.Consentimento em db.js. */
  function consentiu() {
    try {
      var c = JSON.parse(localStorage.getItem('fieldo_consent'));
      if (!c || c.v !== 1 || c.analytics !== true) return false;
      if (c.ts && (Date.now() - Date.parse(c.ts)) > 365 * 864e5) return false;
      return true;
    } catch (e) { return false; }
  }

  var SUPABASE_URL = 'https://jrsctnncoljdcvdofxsg.supabase.co';
  var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impyc2N0bm5jb2xqZGN2ZG9meHNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTEzMzgsImV4cCI6MjA5MDc4NzMzOH0.XJj5d37fOgK4nN9B3xI_x7P1HE_4lvnYC_qx_5eF0FI';

  function uuid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /* Mesmas chaves de localStorage que db.js usa (prefixo fieldo_, sem
     namespace de app) — se esta pessoa navegar daqui pra entrar.html,
     que já carrega FIELDO.Analytics de verdade, o mesmo anonymous_id e
     a mesma origem continuam valendo. É o que liga "visitante" a
     "cadastro" na mesma linha do funil. */
  function lsGet(k) { try { return JSON.parse(localStorage.getItem('fieldo_' + k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem('fieldo_' + k, JSON.stringify(v)); } catch (e) {} }

  function anonymousId() {
    var id = lsGet('analytics_anon_id');
    if (id) return id;
    id = uuid();
    lsSet('analytics_anon_id', id);
    return id;
  }

  function sessionId() {
    try {
      var id = sessionStorage.getItem('_fieldo_session_id');
      if (!id) { id = uuid(); sessionStorage.setItem('_fieldo_session_id', id); }
      return id;
    } catch (e) { return uuid(); }
  }

  function device() {
    var ua = navigator.userAgent || '';
    if (/iPad|Tablet|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
    if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  /* Mesma regra de FIELDO.Origem em db.js — de/utm_source:utm_campaign/
     fbclid/referrer externo, primeiro toque só. Duplicada aqui de
     propósito mínimo; qualquer mudança na regra precisa espelhar as
     duas cópias (a outra vive em db.js, módulo Origem). */
  function origem() {
    try {
      var atual = lsGet('origem');
      if (atual) return atual;
    } catch (e) {}
    function param(nome) {
      var m = new RegExp('[?&]' + nome + '=([^&#]*)').exec(location.search || '');
      return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
    }
    function limpar(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120); }
    var achado = null;
    var de = param('de');
    if (de) achado = limpar(de);
    else {
      var src = param('utm_source'), camp = param('utm_campaign');
      if (src) achado = limpar(camp ? src + ':' + camp : src);
      else if (param('fbclid')) achado = 'meta:sem-utm';
      else if (document.referrer) {
        var host = (/^https?:\/\/([^\/]+)/.exec(document.referrer) || [])[1] || '';
        if (host && host !== location.host) achado = limpar('ref:' + host.replace(/^www\./, ''));
      }
    }
    if (achado) lsSet('origem', achado);
    return achado;
  }

  function track(eventName, props) {
    if (!consentiu()) return;
    try {
      var body = JSON.stringify({
        event_name:   String(eventName).slice(0, 60),
        anonymous_id: anonymousId(),
        session_id:   sessionId(),
        user_id:      null,
        pathname:     location.pathname,
        referrer:     document.referrer || null,
        origem:       origem(),
        device:       device(),
        props:        props || {},
      });
      fetch(SUPABASE_URL + '/rest/v1/analytics_events', {
        method: 'POST',
        headers: {
          apikey:          ANON_KEY,
          'Authorization': 'Bearer ' + ANON_KEY,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal',
        },
        body: body,
        keepalive: true, /* sobrevive ao próprio clique que já está navegando pra entrar.html */
      }).catch(function () {});
    } catch (e) { /* nunca atrapalha a página */ }
  }

  window.FieldoAnalyticsLite = { track: track };

  /* v12.36 · sem aceite, a contagem desta página espera a resposta do
     banner. Aceitou depois de abrir: conta agora, uma vez. */
  var contou = false;
  function contar() {
    if (contou || !consentiu()) return;
    contou = true;
    track('page_view');
    track('landing_view');
  }
  contar();
  window.addEventListener('fieldo:consentimento', contar);
})();
