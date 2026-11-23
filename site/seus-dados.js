/* Fieldo · seus-dados.js — v12.36 (LGPD, art. 18)
 *
 * Duas peças, para as três contas (profissional, locadora, síndico):
 *
 * 1. Painel "Seus dados": monta-se dentro de qualquer elemento com
 *    [data-seus-dados]. Baixar meus dados (na hora, JSON), pedir
 *    correção, pedir exclusão, preferências de cookies.
 *
 * 2. Aviso de aceite: em páginas com [data-pedir-aceite] no <body>,
 *    quem tem conta e ainda não aceitou a versão atual dos Termos e da
 *    Política vê uma janela para ler e aceitar. É o caso de todas as
 *    contas criadas antes da v12.36, quando os Termos não existiam.
 *    Enquanto não aceitar, a janela volta a cada página do painel; os
 *    botões de baixar dados e pedir exclusão continuam ao alcance.
 *
 * Depende de db.js (FIELDO.Titular, FIELDO.Aceite, FIELDO.rest) e de
 * dados-legais.js (FIELDO_LEGAL). As funções do banco estão em
 * supabase/migrations/2026-11-11_lgpd_aceite_titular_retencao.sql.
 */
(function () {
  'use strict';

  function L() { return window.FIELDO_LEGAL || { termosVersao: '2026-11-11', privacidadeVersao: '2026-11-11', emailPrivacidade: 'privacidade@fieldo-zelo.com.br', whatsappSuporte: '5512988406425' }; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function dataBr(iso) { try { return new Date(iso).toLocaleDateString('pt-BR'); } catch (e) { return ''; } }

  var CSS = '' +
    '.sd-card{background:var(--paper,#f5f2ec);border:1px solid var(--paper4,#d8d2c4);border-radius:14px;padding:1.1rem;margin:1rem 0;color:var(--text,#1a1a24)}' +
    '.sd-card h2{font-size:1.05rem;margin:0 0 .4rem;font-weight:600}' +
    '.sd-card p{margin:.3rem 0 .8rem;color:var(--text2,#4a4855);font-size:.92rem;line-height:1.5}' +
    '.sd-acoes{display:grid;gap:.5rem}' +
    '.sd-btn{min-height:44px;border-radius:10px;border:1px solid var(--text,#1a1a24);background:transparent;color:var(--text,#1a1a24);font:600 .95rem system-ui,sans-serif;cursor:pointer;padding:.55rem .9rem;text-align:left}' +
    '.sd-btn--perigo{border-color:#b3261e;color:#b3261e}' +
    '.sd-btn:focus-visible{outline:3px solid var(--gold,#9a7218);outline-offset:2px}' +
    '.sd-form{display:none;margin-top:.6rem}' +
    '.sd-form.aberto{display:grid;gap:.5rem}' +
    '.sd-form label{font-size:.88rem;font-weight:600}' +
    '.sd-form textarea,.sd-form input{width:100%;box-sizing:border-box;border:1px solid var(--paper5,#cbc4b4);border-radius:10px;padding:.6rem;font:16px system-ui,sans-serif;background:#fff;color:#1a1a24}' +
    '.sd-msg{font-size:.9rem;margin-top:.6rem;color:var(--text,#1a1a24)}' +
    '#sdAceite{position:fixed;inset:0;z-index:10000;background:rgba(14,14,20,.55);display:flex;align-items:center;justify-content:center;padding:1rem}' +
    '#sdAceite .sd-card{max-width:520px;width:100%;margin:0;max-height:90vh;overflow:auto}' +
    '#sdAceite label{display:flex;gap:.6rem;align-items:flex-start;font-size:.92rem;line-height:1.45;margin:.4rem 0 .9rem;cursor:pointer}' +
    '#sdAceite input[type=checkbox]{width:20px;height:20px;margin-top:2px;flex-shrink:0}' +
    '.sd-btn--prim{background:var(--text,#1a1a24);color:var(--paper,#f5f2ec);text-align:center}' +
    '.sd-btn[disabled]{opacity:.45;cursor:not-allowed}';

  function css() {
    if (document.getElementById('sdCss')) return;
    var st = document.createElement('style'); st.id = 'sdCss'; st.textContent = CSS; document.head.appendChild(st);
  }

  function baixar(btn, msg) {
    if (!window.FIELDO || !FIELDO.Titular) { msg.textContent = 'Não consegui carregar o app. Recarregue a página.'; return; }
    btn.disabled = true; msg.textContent = 'Juntando seus dados…';
    FIELDO.Titular.meusDados().then(function (dados) {
      var blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'meus-dados-fieldo-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      msg.textContent = 'Pronto. O arquivo foi baixado para o seu aparelho.';
    }).catch(function (e) {
      console.error('[seus-dados] meus_dados:', e);
      msg.innerHTML = 'Não deu certo agora. Tente de novo ou peça por <a href="mailto:' + esc(L().emailPrivacidade) + '">' + esc(L().emailPrivacidade) + '</a>.';
    }).then(function () { btn.disabled = false; });
  }

  function pedir(tipo, contato, detalhe, msg, depois) {
    if (!window.FIELDO || !FIELDO.Titular) { msg.textContent = 'Não consegui carregar o app. Recarregue a página.'; return; }
    msg.textContent = 'Registrando…';
    FIELDO.Titular.pedir(tipo, contato, detalhe).then(function (r) {
      var num = r && r.numero, prazo = r && r.prazo_resposta;
      msg.textContent = 'Pedido nº ' + num + ' registrado. Você recebe resposta até ' + dataBr(prazo) + '.';
      if (depois) depois(num);
    }).catch(function (e) {
      console.error('[seus-dados] pedido:', e);
      msg.innerHTML = 'Não consegui registrar agora. Mande o pedido para <a href="mailto:' + esc(L().emailPrivacidade) + '">' + esc(L().emailPrivacidade) + '</a> e ele vale do mesmo jeito.';
    });
  }

  function montarPainel(box) {
    css();
    var logado = false;
    try { logado = !!(window.FIELDO && FIELDO.Auth && FIELDO.Auth.isLoggedIn && FIELDO.Auth.isLoggedIn()); } catch (e) {}
    if (!logado) {
      box.innerHTML = '<section class="sd-card"><h2>Seus dados</h2>' +
        '<p>Para baixar seus dados ou pedir a exclusão, entre na sua conta neste aparelho. ' +
        'Não tem conta, ou é cliente de um profissional? Escreva para <a href="mailto:' + esc(L().emailPrivacidade) + '">' + esc(L().emailPrivacidade) + '</a> ' +
        'e respondemos em até 15 dias.</p></section>';
      return;
    }
    box.innerHTML = '' +
      '<section class="sd-card" aria-labelledby="sdTit">' +
        '<h2 id="sdTit">Seus dados</h2>' +
        '<p>Pela LGPD você pode ter uma cópia de tudo o que o Fieldo guarda sobre a sua conta e pedir correção ou exclusão. Pedidos são respondidos em até 15 dias. ' +
        '<a href="/privacidade">Política de Privacidade</a> · <a href="/termos">Termos de Uso</a></p>' +
        '<div class="sd-acoes">' +
          '<button type="button" class="sd-btn" data-sd="baixar">Baixar meus dados</button>' +
          '<button type="button" class="sd-btn" data-sd="abrir-correcao" aria-expanded="false" aria-controls="sdFormCor">Pedir correção de um dado</button>' +
          '<div class="sd-form" id="sdFormCor">' +
            '<label for="sdCorTxt">O que está errado e como deveria ficar</label>' +
            '<textarea id="sdCorTxt" rows="3" maxlength="2000"></textarea>' +
            '<button type="button" class="sd-btn sd-btn--prim" data-sd="enviar-correcao">Enviar pedido</button>' +
          '</div>' +
          '<button type="button" class="sd-btn" data-abrir-cookies>Preferências de cookies</button>' +
          '<button type="button" class="sd-btn sd-btn--perigo" data-sd="abrir-exclusao" aria-expanded="false" aria-controls="sdFormExc">Pedir exclusão da conta</button>' +
          '<div class="sd-form" id="sdFormExc">' +
            '<p>Apaga de vez o perfil, relatórios, orçamentos, avaliações, fotos e contratos. Antes, baixe seus dados e os PDFs que quiser guardar. Confirmamos com você pelo WhatsApp ou e-mail antes de apagar.</p>' +
            '<label for="sdExcContato">WhatsApp ou e-mail para confirmarmos</label>' +
            '<input id="sdExcContato" type="text" maxlength="160" autocomplete="tel"/>' +
            '<button type="button" class="sd-btn sd-btn--perigo" data-sd="enviar-exclusao">Confirmar pedido de exclusão</button>' +
          '</div>' +
        '</div>' +
        '<div class="sd-msg" role="status" aria-live="polite"></div>' +
      '</section>';

    var msg = box.querySelector('.sd-msg');
    box.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-sd]');
      if (!b) return;
      var acao = b.getAttribute('data-sd');
      if (acao === 'baixar') return baixar(b, msg);
      if (acao === 'abrir-correcao' || acao === 'abrir-exclusao') {
        var f = box.querySelector(acao === 'abrir-correcao' ? '#sdFormCor' : '#sdFormExc');
        var aberto = f.classList.toggle('aberto');
        b.setAttribute('aria-expanded', aberto ? 'true' : 'false');
        if (aberto) { var c = f.querySelector('textarea,input'); if (c) c.focus(); }
        return;
      }
      if (acao === 'enviar-correcao') {
        var t = (box.querySelector('#sdCorTxt').value || '').trim();
        if (t.length < 5) { msg.textContent = 'Conte o que precisa ser corrigido.'; return; }
        return pedir('correcao', null, t, msg);
      }
      if (acao === 'enviar-exclusao') {
        var contato = (box.querySelector('#sdExcContato').value || '').trim();
        if (contato.length < 6) { msg.textContent = 'Informe um WhatsApp ou e-mail para confirmarmos com você.'; return; }
        return pedir('exclusao', contato, 'Pedido feito pelo app', msg, function (num) {
          var link = 'https://wa.me/' + L().whatsappSuporte + '?text=' + encodeURIComponent('Pedido de exclusão da minha conta no Fieldo, nº ' + num + '.');
          msg.innerHTML = esc(msg.textContent) + ' Se quiser agilizar, <a href="' + link + '" target="_blank" rel="noopener">avise pelo WhatsApp</a>.';
        });
      }
    });
  }

  /* ── 2. aviso de aceite para contas antigas ─────────────────────── */

  /* A marca "já aceitou esta versão neste aparelho" mora em db.js
     (FIELDO.Aceite), com o mesmo namespace de app da sessão. */
  function jaAceitouLocal() {
    var v = L();
    try { return FIELDO.Aceite.jaLocal(v.termosVersao, v.privacidadeVersao); } catch (e) { return false; }
  }
  function marcarLocal() {
    var v = L();
    try { FIELDO.Aceite.marcarLocal(v.termosVersao, v.privacidadeVersao); } catch (e) {}
  }

  function mostrarAviso(origem) {
    if (document.getElementById('sdAceite')) return;
    css();
    var v = L();
    var w = document.createElement('div');
    w.id = 'sdAceite';
    w.setAttribute('role', 'dialog');
    w.setAttribute('aria-modal', 'true');
    w.setAttribute('aria-labelledby', 'sdAcTit');
    w.innerHTML = '' +
      '<div class="sd-card">' +
        '<h2 id="sdAcTit">Termos de Uso e Política de Privacidade</h2>' +
        '<p>O Fieldo agora tem Termos de Uso e uma Política de Privacidade, que explicam o que guardamos, por quanto tempo, como cancelar o Pro e como pedir seus dados. Para continuar usando o app, leia e aceite.</p>' +
        '<p><a href="/termos" target="_blank" rel="noopener">Ler os Termos de Uso</a> · <a href="/privacidade" target="_blank" rel="noopener">Ler a Política de Privacidade</a></p>' +
        '<label for="sdAcChk"><input type="checkbox" id="sdAcChk"/> <span>Tenho 18 anos ou mais e aceito os Termos de Uso e a Política de Privacidade.</span></label>' +
        '<div class="sd-acoes">' +
          '<button type="button" class="sd-btn sd-btn--prim" id="sdAcOk" disabled>Aceitar e continuar</button>' +
        '</div>' +
        '<p style="margin-top:.9rem">Não quer aceitar? Você pode <a href="#" id="sdAcDados">baixar seus dados ou pedir a exclusão da conta</a>.</p>' +
        '<div class="sd-msg" role="status" aria-live="polite"></div>' +
      '</div>';
    document.body.appendChild(w);
    var chk = w.querySelector('#sdAcChk'), ok = w.querySelector('#sdAcOk'), msg = w.querySelector('.sd-msg');
    chk.addEventListener('change', function () { ok.disabled = !chk.checked; });
    ok.addEventListener('click', function () {
      if (!chk.checked) return;
      ok.disabled = true; msg.textContent = 'Registrando…';
      FIELDO.Aceite.registrar([
        { documento: 'termos',      versao: v.termosVersao,      origem: origem },
        { documento: 'privacidade', versao: v.privacidadeVersao, origem: origem },
      ]).then(function (gravou) {
        /* gravou === false: ficou pendente no aparelho e o db.js reenvia */
        marcarLocal();
        w.parentNode.removeChild(w);
        if (!gravou) console.warn('[aceite] guardado no aparelho, será reenviado');
      });
    });
    w.querySelector('#sdAcDados').addEventListener('click', function (ev) {
      ev.preventDefault();
      var box = document.createElement('div');
      w.querySelector('.sd-card').appendChild(box);
      montarPainel(box);
      this.parentNode.style.display = 'none';
    });
    chk.focus();
  }

  function verificarAceite() {
    var corpo = document.body;
    if (!corpo || !corpo.hasAttribute('data-pedir-aceite')) return;
    if (!window.FIELDO || !FIELDO.Auth || !FIELDO.Auth.isLoggedIn || !FIELDO.Auth.isLoggedIn()) return;
    if (jaAceitouLocal()) return;
    var v = L();
    var origem = corpo.getAttribute('data-pedir-aceite') || 'painel';
    FIELDO.rest.get('/aceites?select=documento,versao&aceito=eq.true&documento=in.(termos,privacidade)' +
                    '&versao=in.(' + encodeURIComponent(v.termosVersao) + ',' + encodeURIComponent(v.privacidadeVersao) + ')')
      .then(function (linhas) {
        var t = false, p = false;
        (linhas || []).forEach(function (l) {
          if (l.documento === 'termos' && l.versao === v.termosVersao) t = true;
          if (l.documento === 'privacidade' && l.versao === v.privacidadeVersao) p = true;
        });
        if (t && p) { marcarLocal(); return; }
        mostrarAviso(origem);
      })
      .catch(function (e) {
        /* Banco ainda sem a tabela (SQL não aplicado) ou sem rede: não
           trava o profissional no meio do trabalho. Tenta na próxima. */
        console.warn('[aceite] não deu para conferir agora:', e);
      });
  }

  function iniciar() {
    var caixas = document.querySelectorAll('[data-seus-dados]');
    for (var i = 0; i < caixas.length; i++) montarPainel(caixas[i]);
    /* dá tempo de o db.js restaurar a sessão */
    setTimeout(verificarAceite, 600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
