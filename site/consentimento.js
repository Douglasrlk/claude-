/* Fieldo · consentimento.js — v12.36
 *
 * Banner de cookies e de armazenamento no navegador (LGPD e o guia de
 * cookies da ANPD).
 *
 * Duas categorias, e só duas, porque é o que o Fieldo usa de verdade:
 *
 *   · Necessários: login, rascunhos, código de recuperação, tema. Sem
 *     eles o app não funciona, por isso não dependem de escolha.
 *   · Medição: um identificador aleatório deste navegador, as páginas
 *     vistas, de onde a visita veio (link, anúncio) e o tipo de
 *     aparelho, gravados no banco do próprio Fieldo. Só com "Aceitar".
 *
 * Não existe terceira categoria de publicidade porque o Fieldo não tem
 * pixel, Google Analytics nem rastreador de outra empresa. Se um dia
 * tiver, ele entra como categoria própria, desligada por padrão.
 *
 * "Recusar" tem o mesmo tamanho e o mesmo peso de "Aceitar", e fechar
 * o banner sem escolher vale como recusa. A escolha fica em
 * localStorage 'fieldo_consent' e pode ser trocada a qualquer momento
 * por qualquer link com o atributo data-abrir-cookies.
 */
(function () {
  'use strict';

  var CHAVE  = 'fieldo_consent';
  var VERSAO = 1;
  /* Prazo de validade da escolha: depois disso o banner volta a aparecer. */
  var VALIDADE_DIAS = 365;

  function ler() {
    try {
      var c = JSON.parse(localStorage.getItem(CHAVE));
      if (!c || c.v !== VERSAO) return null;
      if (c.ts && (Date.now() - Date.parse(c.ts)) > VALIDADE_DIAS * 864e5) return null;
      return c;
    } catch (e) { return null; }
  }

  /* Ao recusar (ou retirar o aceite), apaga o que a medição já tinha
     gravado neste navegador, em qualquer um dos apps do domínio. */
  function limparMedicao() {
    try {
      var apagar = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i) || '';
        if (/^fieldo_(?:[a-z]+_)?(?:analytics_anon_id|origem)$/.test(k)) apagar.push(k);
      }
      apagar.forEach(function (k) { localStorage.removeItem(k); });
      sessionStorage.removeItem('_fieldo_session_id');
    } catch (e) {}
  }

  function gravar(analytics) {
    var c = { v: VERSAO, analytics: !!analytics, ts: new Date().toISOString() };
    try { localStorage.setItem(CHAVE, JSON.stringify(c)); } catch (e) {}
    if (!analytics) limparMedicao();
    try { window.dispatchEvent(new CustomEvent('fieldo:consentimento', { detail: c })); } catch (e) {}
    return c;
  }

  var CSS = '' +
    '#fieldoCookies{position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;max-width:560px;margin:0 auto;' +
      'background:var(--paper,#f5f2ec);color:var(--text,#1a1a24);border:1px solid var(--paper4,#d8d2c4);' +
      'border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:16px 16px 14px;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '#fieldoCookies h2{font-size:16px;margin:0 0 6px;font-weight:600}' +
    '#fieldoCookies p{margin:0 0 12px;color:var(--text2,#4a4855)}' +
    '#fieldoCookies a{color:inherit;text-decoration:underline}' +
    '#fieldoCookies .fc-botoes{display:flex;gap:8px}' +
    '#fieldoCookies button{flex:1;min-height:44px;border-radius:10px;font:600 15px system-ui,sans-serif;cursor:pointer;' +
      'border:1px solid var(--text,#1a1a24);background:transparent;color:var(--text,#1a1a24)}' +
    '#fieldoCookies button.fc-aceitar{background:var(--text,#1a1a24);color:var(--paper,#f5f2ec)}' +
    '#fieldoCookies button:focus-visible{outline:3px solid var(--gold,#9a7218);outline-offset:2px}';

  function montar() {
    if (document.getElementById('fieldoCookies')) return;
    if (!document.getElementById('fieldoCookiesCss')) {
      var st = document.createElement('style');
      st.id = 'fieldoCookiesCss';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    var box = document.createElement('section');
    box.id = 'fieldoCookies';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-labelledby', 'fieldoCookiesTit');
    box.innerHTML = '' +
      '<h2 id="fieldoCookiesTit">Sua privacidade no Fieldo</h2>' +
      '<p>Guardamos no seu navegador só o necessário para o site funcionar, como o login. ' +
      'Se você aceitar, também contamos visitas e de onde elas vieram, no banco do próprio Fieldo, para melhorar o site. ' +
      'Não usamos propaganda nem rastreador de outras empresas. ' +
      '<a href="/privacidade#cookies">Saiba mais</a></p>' +
      '<div class="fc-botoes">' +
        '<button type="button" class="fc-recusar">Recusar</button>' +
        '<button type="button" class="fc-aceitar">Aceitar</button>' +
      '</div>';
    box.querySelector('.fc-recusar').addEventListener('click', function () { gravar(false); fechar(); });
    box.querySelector('.fc-aceitar').addEventListener('click', function () { gravar(true); fechar(); });
    document.body.appendChild(box);
  }

  function fechar() {
    var b = document.getElementById('fieldoCookies');
    if (b) b.parentNode.removeChild(b);
  }

  function abrir() { fechar(); montar(); var b = document.querySelector('#fieldoCookies button'); if (b) b.focus(); }

  window.FieldoConsent = {
    ler: ler,
    analytics: function () { var c = ler(); return !!(c && c.analytics); },
    aceitar: function () { return gravar(true); },
    recusar: function () { return gravar(false); },
    abrir: abrir,
  };

  function iniciar() {
    if (!ler()) montar();
    document.addEventListener('click', function (ev) {
      var a = ev.target && ev.target.closest && ev.target.closest('[data-abrir-cookies]');
      if (!a) return;
      ev.preventDefault();
      abrir();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
