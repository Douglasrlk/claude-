/* ════════════════════════════════════════════════════════════════
   Fieldo · studio-painel.js  (v12.41) — o Studio no painel
   ════════════════════════════════════════════════════════════════
   Um cartão depois do assistente: convite para transformar o último
   serviço em vídeo e, quando já existe vídeo, o número real que ele
   trouxe ("seu último vídeo trouxe 12 visitas"). É o passo 5 do ciclo
   de retenção: a prova do resultado, onde o profissional olha todo dia.

   Independente: se db.studio.js não carregou, se a função do banco
   ainda não existe ou se a rede falhar, o cartão aparece só como
   convite (sem números) ou nem aparece — o painel nunca quebra.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (!window.FIELDO || !FIELDO.Auth || !FIELDO.Auth.isLoggedIn()) return;

  function esc(s) { return FIELDO.UI && FIELDO.UI.esc ? FIELDO.UI.esc(String(s == null ? '' : s)) : String(s || ''); }

  var CSS = '.stp{position:relative;overflow:hidden;background:#0e0e14;color:#f5f2ec;border-radius:16px;padding:1rem 1.05rem 1.05rem;margin-bottom:1.6rem;' +
    'display:grid;grid-template-columns:1fr auto;gap:.9rem;align-items:center;text-decoration:none;box-shadow:0 6px 24px rgba(14,14,20,.18)}' +
    '.stp:before{content:"";position:absolute;inset:auto -40px -60px auto;width:180px;height:180px;border-radius:50%;background:radial-gradient(rgba(212,171,64,.32),rgba(212,171,64,0) 70%)}' +
    '.stp-lbl{font:500 .62rem var(--mono);letter-spacing:.16em;text-transform:uppercase;color:#d4ab40;margin-bottom:.3rem}' +
    '.stp-tit{font:400 1.12rem/1.25 var(--serif);margin:0 0 .25rem}.stp-tit b{font-weight:600;color:#d4ab40}' +
    '.stp-txt{font-size:.78rem;line-height:1.45;color:rgba(245,242,236,.66);margin:0}' +
    '.stp-cta{position:relative;display:inline-flex;align-items:center;gap:.4rem;background:#d4ab40;color:#0e0e14;border-radius:10px;padding:.65rem .85rem;font:600 .8rem var(--sans);white-space:nowrap;min-height:44px}' +
    '.stp-tela{position:relative;width:38px;height:64px;border-radius:7px;border:2px solid rgba(245,242,236,.8);display:flex;align-items:center;justify-content:center;margin-bottom:.45rem}' +
    '@media(max-width:360px){.stp{grid-template-columns:1fr}.stp-cta{justify-self:start}}';

  function montar(info) {
    var ancora = document.querySelector('.mp-agente') || document.querySelector('.acao-primaria');
    if (!ancora || document.getElementById('stpCard')) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var a = document.createElement('a');
    a.className = 'stp'; a.id = 'stpCard';
    var tit, txt, cta = 'Criar vídeo', href = 'studio.html';
    if (info && info.ultimo && info.ultimo.visitas > 0) {
      var n = info.ultimo.visitas, c = (info.ultimo.whatsapp || 0) + (info.ultimo.ligacoes || 0);
      tit = 'Seu último vídeo trouxe <b>' + n + ' visita' + (n === 1 ? '' : 's') + '</b>';
      txt = (c ? c + ' contato' + (c === 1 ? '' : 's') + ' pelo WhatsApp ou telefone. ' : '') + 'O próximo serviço pode trazer mais.';
      cta = 'Novo vídeo'; href = 'studio.html?v=' + encodeURIComponent(info.ultimo.id);
    } else if (info && info.ultimo) {
      tit = 'Seu vídeo está pronto para rodar';
      txt = 'Poste no Status e no Reels: cada visita pelo link dele aparece aqui.';
      cta = 'Ver meus vídeos'; href = 'studio.html?v=' + encodeURIComponent(info.ultimo.id);
    } else {
      tit = 'Seu último serviço <b>vira vídeo</b>';
      txt = 'Antes e depois, avaliação e o link do seu perfil, prontos para o Status e o Reels. Feito no seu celular, em menos de um minuto.';
    }
    a.href = href;
    a.setAttribute('aria-label', 'Fieldo Studio: ' + tit.replace(/<[^>]+>/g, ''));
    a.innerHTML = '<div style="position:relative"><div class="stp-lbl">Fieldo Studio</div><p class="stp-tit">' + tit + '</p><p class="stp-txt">' + esc(txt) + '</p></div>' +
      '<span class="stp-cta"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>' + esc(cta) + '</span>';
    ancora.parentNode.insertBefore(a, ancora.nextSibling);
  }

  function iniciar() {
    if (!FIELDO.Studio) return montar(null);
    FIELDO.Studio.meus().then(function (lista) {
      var gerados = (lista || []).filter(function (v) { return v.gerado_em; });
      montar({ ultimo: gerados[0] || null });
    }).catch(function (e) {
      if (e && e.code === 'indisponivel') return;   /* servidor ainda sem o Studio: não convida para algo que não abre */
      montar(null);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
