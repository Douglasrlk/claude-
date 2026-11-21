/* ════════════════════════════════════════════════════════════════
   Fieldo · modo "app da Play Store"  (v12.45)
   ════════════════════════════════════════════════════════════════
   O app Android do Fieldo é este mesmo site aberto numa Trusted Web
   Activity (TWA). A política de pagamentos do Google Play não deixa um
   app vender assinatura de recurso digital (o Pro) por fora do Google
   Play Billing, nem apontar o caminho para comprar fora: link, botão
   ou "fale com a gente para assinar".

   O que a política permite: o app dar acesso a um plano comprado em
   outro lugar. Então, DENTRO do app:
     · quem é Pro continua Pro (nada muda no acesso);
     · nenhuma tela vende o Pro: links e botões para planos.html e
       ativar.html somem, e abrir essas páginas manda para o painel;
     · os avisos de limite continuam explicando o limite, sem oferta.
   No navegador (o site), nada muda.

   Como o app é reconhecido:
     · o app abre /painel.html?app=play (start_url do Android);
     · toda abertura pela TWA chega com document.referrer
       "android-app://br.com.fieldozelo.app" (inclusive link de
       WhatsApp que abre direto no app).
   A marca fica em sessionStorage: vale para a sessão do app e NÃO vaza
   para o Chrome comum (a TWA usa o mesmo perfil do Chrome; localStorage
   seria compartilhado e esconderia a venda também no site).
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var PACOTE = 'br.com.fieldozelo.app', CHAVE = 'fieldo_app_play';
  var ehApp = false;
  try {
    if (/[?&]app=play(&|$)/.test(location.search) ||
        String(document.referrer || '').indexOf('android-app://' + PACOTE) === 0) {
      sessionStorage.setItem(CHAVE, '1');
    }
    ehApp = sessionStorage.getItem(CHAVE) === '1';
  } catch (e) { ehApp = false; }

  /* fonte de verdade para o resto do código: a classe no <html>
     (window.FIELDO é recriado pelo db.js, então nada fica guardado lá) */
  if (!ehApp) return;

  /* páginas de compra: dentro do app levam ao painel */
  if (/^\/(planos|ativar)(\.html)?\/?$/.test(location.pathname)) {
    location.replace('/painel.html');
    return;
  }

  document.documentElement.classList.add('app-play');
  var css = document.createElement('style');
  css.textContent =
    'html.app-play a[href*="planos.html"],html.app-play a[href*="ativar.html"],' +
    'html.app-play .fd-upg-primary,html.app-play .fd-upg-wa,html.app-play #planCta,' +
    'html.app-play .plan-bar-cta,html.app-play [data-venda]{display:none!important}';
  (document.head || document.documentElement).appendChild(css);

  /* rede de segurança: link para compra criado depois (menus, modais)
     não navega, mesmo que algum estilo o deixe visível */
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (a && /(planos|ativar)\.html/.test(a.getAttribute('href') || '')) { ev.preventDefault(); ev.stopPropagation(); }
  }, true);
})();
