/* Fieldo · a11y.js — v12.36
 *
 * Partes do app usam <div onclick> no lugar de <button>. Para o leitor
 * de tela e para quem navega pelo teclado, isso não é um botão: não
 * recebe foco com Tab e não responde a Enter.
 *
 * Este arquivo dá a esses elementos o papel de botão, foco pelo Tab e
 * Enter/Espaço, inclusive nos que o JavaScript cria depois (lista de
 * serviços, estrelas da avaliação). Fica de fora o que não é botão de
 * verdade: o fundo escuro de modal (aria-hidden, "overlay", "backdrop")
 * e a caixa do modal que só para o clique de vazar.
 *
 * É o remendo, não o ideal. Tela nova deve nascer com <button>.
 */
(function () {
  'use strict';
  var SEL = 'div[onclick],span[onclick],li[onclick],img[onclick],td[onclick],tr[onclick]';

  function ehBotao(el) {
    var oc = el.getAttribute('onclick') || '';
    if (/^\s*event\.stopPropagation\(\)\s*;?\s*$/.test(oc)) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (/(^|\s)(\S*overlay\S*|\S*backdrop\S*)(\s|$)/i.test(el.className || '')) return false;
    if (el.getAttribute('role') === 'dialog') return false;
    return true;
  }

  function ajustar(raiz) {
    var lista = (raiz && raiz.querySelectorAll) ? raiz.querySelectorAll(SEL) : [];
    for (var i = 0; i < lista.length; i++) {
      var el = lista[i];
      if (el.hasAttribute('data-a11y')) continue;
      el.setAttribute('data-a11y', ehBotao(el) ? '1' : '0');
      if (el.getAttribute('data-a11y') !== '1') continue;
      if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    }
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var el = ev.target;
    if (!el || !el.getAttribute || el.getAttribute('data-a11y') !== '1') return;
    ev.preventDefault();
    el.click();
  });

  function iniciar() {
    ajustar(document);
    if (!window.MutationObserver) return;
    var pend = false;
    new MutationObserver(function () {
      if (pend) return;
      pend = true;
      setTimeout(function () { pend = false; ajustar(document); }, 120);
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
