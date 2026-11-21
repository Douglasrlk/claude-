/* Fieldo · dados-legais.js — v12.36
 *
 * Um lugar só para quem responde pelo Fieldo. O rodapé de todas as
 * páginas, a Política de Privacidade e os Termos de Uso leem daqui.
 * Trocou o CNPJ ou o endereço? Muda só este arquivo.
 *
 * ── PREENCHER ANTES DE PUBLICAR ──────────────────────────────────
 * O Decreto 7.962/2013 (art. 2º) pede, em local de destaque, o nome
 * empresarial, o CNPJ (ou CPF, enquanto não houver CNPJ) e o endereço
 * físico e eletrônico de quem vende. Enquanto um campo estiver vazio,
 * ele simplesmente não aparece: nada de "[preencher]" no site.
 *
 * O e-mail de privacidade precisa EXISTIR e ser lido antes da
 * publicação. É por ele que chegam os pedidos da LGPD (prazo de
 * resposta: 15 dias) e as comunicações da ANPD.
 */
(function () {
  'use strict';

  var D = {
    marca:             'Fieldo',
    responsavel:       '',   /* PREENCHER: razão social (ou nome completo do responsável, sem CNPJ) */
    cnpj:              '',   /* PREENCHER quando o CNPJ sair. Ex.: 00.000.000/0001-00 */
    endereco:          '',   /* PREENCHER: endereço físico para contato (pode ser comercial) */
    emailPrivacidade:  'privacidade@fieldo-zelo.com.br',
    whatsappSuporte:   '5512988406425',
    termosVersao:      '2026-11-11',
    privacidadeVersao: '2026-11-11',
    /* O Fieldo não manda marketing. Se um dia mandar, ligue aqui: a
       caixa separada de marketing aparece nos cadastros e o aceite
       entra no banco como documento 'marketing'. */
    marketingAtivo:    false,
  };

  window.FIELDO_LEGAL = D;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function waFmt(n) {
    var d = String(n || '').replace(/\D/g, '');
    if (d.length === 13) return '(' + d.slice(2, 4) + ') ' + d.slice(4, 9) + '-' + d.slice(9);
    return d;
  }

  /* Monta o bloco de identificação + links legais. Só entra o que está
     preenchido. */
  function rodapeHtml() {
    var partes = [];
    var quem = D.responsavel ? esc(D.responsavel) : esc(D.marca);
    partes.push(quem);
    if (D.cnpj) partes.push('CNPJ ' + esc(D.cnpj));
    if (D.endereco) partes.push(esc(D.endereco));
    var contato = [];
    if (D.emailPrivacidade) contato.push('<a href="mailto:' + esc(D.emailPrivacidade) + '">' + esc(D.emailPrivacidade) + '</a>');
    if (D.whatsappSuporte) contato.push('<a href="https://wa.me/' + esc(D.whatsappSuporte) + '" rel="noopener">WhatsApp ' + esc(waFmt(D.whatsappSuporte)) + '</a>');
    return '' +
      '<p class="legal-id">' + partes.join(' · ') + '</p>' +
      (contato.length ? '<p class="legal-contato">Contato: ' + contato.join(' · ') + '</p>' : '') +
      '<p class="legal-links">' +
        '<a href="/termos">Termos de Uso</a> · ' +
        '<a href="/privacidade">Política de Privacidade</a> · ' +
        '<a href="/privacidade#cookies" data-abrir-cookies>Preferências de cookies</a>' +
      '</p>';
  }

  function preencher() {
    var alvos = document.querySelectorAll('[data-legal="rodape"]');
    for (var i = 0; i < alvos.length; i++) alvos[i].innerHTML = rodapeHtml();

    /* Campos soltos dentro dos textos legais: <span data-legal-campo="cnpj">.
       Campo vazio esconde a linha inteira marcada com data-legal-linha. */
    var campos = document.querySelectorAll('[data-legal-campo]');
    for (var j = 0; j < campos.length; j++) {
      var k = campos[j].getAttribute('data-legal-campo');
      var v = D[k];
      if (v) {
        campos[j].textContent = k === 'whatsappSuporte' ? waFmt(v) : v;
      } else {
        var linha = campos[j].closest('[data-legal-linha]');
        if (linha) linha.style.display = 'none';
      }
    }
    var links = document.querySelectorAll('a[data-legal-mailto]');
    for (var m = 0; m < links.length; m++) links[m].href = 'mailto:' + D.emailPrivacidade;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', preencher);
  else preencher();
})();
