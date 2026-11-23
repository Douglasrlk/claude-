/* ════════════════════════════════════════════════════════════════
   Fieldo v12.40 · galeria.js — fotos em tela cheia com zoom

   Pedido do dono (18/11): o cliente precisa abrir a foto com um toque,
   ampliar e conferir o trabalho de perto. Antes a foto abria crua numa
   aba nova, sem voltar, sem passar para a próxima e com o zoom do
   navegador brigando com a página.

   Uso: qualquer <a data-galeria="grupo" href="URL-da-foto"> vira gatilho.
   Links do mesmo grupo formam a sequência. Sem JS, o link continua
   abrindo a foto — este arquivo só melhora o que já funciona.

   Gestos:
     toque duplo / duplo clique   amplia 2,5× no ponto tocado (de novo: volta)
     pinça com dois dedos         1× a 5×
     arrastar                     com zoom: move a foto · sem zoom: troca de foto
                                  (para baixo, sem zoom: fecha)
     roda do mouse                zoom no desktop
     ← → Esc                      teclado
════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.FieldoGaleria) return;

  var MAX = 5, DUPLO = 2.5;
  var ov, img, cont, btnAnt, btnProx, btnFechar, btnZoom, dica;
  var lista = [], idx = 0, voltarFoco = null;
  var z = 1, x = 0, y = 0;                       /* zoom e deslocamento */
  var ptrs = {}, pinca = null, arr = null, ultimoToque = 0, moveu = false;

  var css = '' +
    '.fg{position:fixed;inset:0;z-index:9999;background:rgba(8,8,12,.96);display:none;' +
      'touch-action:none;-webkit-user-select:none;user-select:none;overscroll-behavior:contain}' +
    '.fg.on{display:block}' +
    '.fg-palco{position:absolute;inset:0;overflow:hidden;display:flex;align-items:center;justify-content:center}' +
    '.fg-img{max-width:100%;max-height:100%;object-fit:contain;transform-origin:0 0;will-change:transform;' +
      'cursor:zoom-in;-webkit-user-drag:none}' +
    '.fg.zoom .fg-img{cursor:grab}' +
    '.fg-img.anim{transition:transform .22s ease}' +
    '.fg-topo{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;' +
      'padding:max(.6rem,env(safe-area-inset-top)) .6rem .6rem;color:#fff;font:500 .85rem system-ui,sans-serif;' +
      'background:linear-gradient(rgba(0,0,0,.55),transparent);pointer-events:none}' +
    '.fg-topo > *{pointer-events:auto}' +
    '.fg-b{width:44px;height:44px;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;' +
      'display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}' +
    '.fg-b:hover{background:rgba(255,255,255,.24)}' +
    '.fg-b:focus-visible{outline:2px solid #fff;outline-offset:2px}' +
    '.fg-b[hidden]{display:none}' +
    '.fg-acoes{display:flex;gap:.5rem}' +
    '.fg-nav{position:absolute;top:50%;transform:translateY(-50%)}' +
    '.fg-ant{left:.6rem}.fg-prox{right:.6rem}' +
    '.fg-dica{position:absolute;left:0;right:0;bottom:max(1rem,env(safe-area-inset-bottom));text-align:center;' +
      'color:rgba(255,255,255,.75);font:400 .78rem system-ui,sans-serif;pointer-events:none;transition:opacity .4s}' +
    '@media(hover:none){.fg-nav{display:none}}';

  function svg(d) {
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }

  function montar() {
    if (ov) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    ov = document.createElement('div');
    ov.className = 'fg';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Foto ampliada');
    ov.innerHTML =
      '<div class="fg-palco"><img class="fg-img" alt="" draggable="false"/></div>' +
      '<div class="fg-topo"><span class="fg-cont" aria-live="polite"></span>' +
        '<div class="fg-acoes">' +
          '<button type="button" class="fg-b fg-zoom" aria-label="Ampliar">' + svg('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>') + '</button>' +
          '<button type="button" class="fg-b fg-fechar" aria-label="Fechar">' + svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>') + '</button>' +
        '</div></div>' +
      '<button type="button" class="fg-b fg-nav fg-ant" aria-label="Foto anterior">' + svg('<polyline points="15 18 9 12 15 6"/>') + '</button>' +
      '<button type="button" class="fg-b fg-nav fg-prox" aria-label="Próxima foto">' + svg('<polyline points="9 18 15 12 9 6"/>') + '</button>' +
      '<div class="fg-dica">Toque duas vezes ou use dois dedos para ampliar</div>';
    document.body.appendChild(ov);
    img = ov.querySelector('.fg-img');
    cont = ov.querySelector('.fg-cont');
    btnAnt = ov.querySelector('.fg-ant');
    btnProx = ov.querySelector('.fg-prox');
    btnFechar = ov.querySelector('.fg-fechar');
    btnZoom = ov.querySelector('.fg-zoom');
    dica = ov.querySelector('.fg-dica');

    btnFechar.addEventListener('click', fechar);
    btnAnt.addEventListener('click', function () { ir(-1); });
    btnProx.addEventListener('click', function () { ir(1); });
    btnZoom.addEventListener('click', function () {
      var r = img.getBoundingClientRect();
      zoomEm(z > 1 ? 1 : DUPLO, r.left + r.width / 2, r.top + r.height / 2, true);
    });
    img.addEventListener('load', function () { resetar(false); });

    var palco = ov.querySelector('.fg-palco');
    palco.addEventListener('pointerdown', baixo);
    palco.addEventListener('pointermove', mover);
    palco.addEventListener('pointerup', cima);
    palco.addEventListener('pointercancel', cima);
    palco.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoomEm(z * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY, false);
    }, { passive: false });
    /* clique no fundo escuro (fora da foto, sem zoom) fecha */
    palco.addEventListener('click', function (e) {
      if (e.target === palco && z === 1 && !moveu) fechar();
    });
    document.addEventListener('keydown', function (e) {
      if (!ov.classList.contains('on')) return;
      if (e.key === 'Escape') fechar();
      else if (e.key === 'ArrowLeft') ir(-1);
      else if (e.key === 'ArrowRight') ir(1);
      else if (e.key === 'Tab') {                     /* foco preso no diálogo */
        var f = [].slice.call(ov.querySelectorAll('button:not([hidden])')).filter(function (b) { return b.offsetParent; });
        if (!f.length) return;
        var i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
  }

  /* ── transformação ── */
  function aplicar(anim) {
    img.classList.toggle('anim', !!anim);
    img.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + z + ')';
    ov.classList.toggle('zoom', z > 1.01);
    btnZoom.setAttribute('aria-label', z > 1.01 ? 'Voltar ao tamanho normal' : 'Ampliar');
  }
  /* a imagem fica centrada pelo flex; transform-origin 0 0 → x/y medidos
     a partir do canto da caixa da imagem em escala 1 */
  function base() { var r = img.getBoundingClientRect(); return { l: r.left - x, t: r.top - y, w: r.width / z, h: r.height / z }; }
  function limitar() {
    var b = base(), W = window.innerWidth, H = window.innerHeight;
    var w = b.w * z, h = b.h * z;
    /* sem sobrar fundo escuro dentro da tela quando a foto é maior que ela */
    var minX = w > W ? W - b.l - w : (W - w) / 2 - b.l, maxX = w > W ? -b.l : minX;
    var minY = h > H ? H - b.t - h : (H - h) / 2 - b.t, maxY = h > H ? -b.t : minY;
    x = Math.min(maxX, Math.max(minX, x));
    y = Math.min(maxY, Math.max(minY, y));
  }
  function zoomEm(nz, cx, cy, anim) {
    nz = Math.min(MAX, Math.max(1, nz));
    var b = base();
    /* ponto da foto sob o dedo continua sob o dedo */
    var px = (cx - b.l - x) / z, py = (cy - b.t - y) / z;
    x = cx - b.l - px * nz;
    y = cy - b.t - py * nz;
    z = nz;
    if (z === 1) { x = 0; y = 0; } else limitar();
    aplicar(anim);
    esconderDica();
  }
  function resetar(anim) { z = 1; x = 0; y = 0; if (img) aplicar(anim); }
  function esconderDica() { if (dica) dica.style.opacity = '0'; }

  /* ── ponteiros: pinça, arrasto, toque duplo, deslizar ── */
  function baixo(e) {
    if (e.target.closest('.fg-b')) return;
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (er) {}
    var ids = Object.keys(ptrs);
    if (ids.length === 2) {
      var a = ptrs[ids[0]], b = ptrs[ids[1]];
      pinca = { d: Math.hypot(a.x - b.x, a.y - b.y), z: z };
      arr = null;
    } else if (ids.length === 1) {
      arr = { x0: e.clientX, y0: e.clientY, x: x, y: y };
      moveu = false;
    }
  }
  function mover(e) {
    if (!ptrs[e.pointerId]) return;
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(ptrs);
    if (pinca && ids.length >= 2) {
      var a = ptrs[ids[0]], b = ptrs[ids[1]];
      zoomEm(pinca.z * Math.hypot(a.x - b.x, a.y - b.y) / (pinca.d || 1), (a.x + b.x) / 2, (a.y + b.y) / 2, false);
      moveu = true;
      return;
    }
    if (!arr) return;
    var dx = e.clientX - arr.x0, dy = e.clientY - arr.y0;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moveu = true;
    if (z > 1) {
      x = arr.x + dx; y = arr.y + dy; limitar(); aplicar(false);
    } else {
      /* sem zoom: a foto acompanha o dedo, para trocar ou fechar */
      img.classList.remove('anim');
      img.style.transform = Math.abs(dx) > Math.abs(dy)
        ? 'translate(' + dx + 'px,0)'
        : 'translate(0,' + Math.max(0, dy) + 'px)';
      ov.style.background = dy > 0 && Math.abs(dy) > Math.abs(dx)
        ? 'rgba(8,8,12,' + Math.max(.4, .96 - dy / 600) + ')' : '';
    }
  }
  function cima(e) {
    var p = ptrs[e.pointerId];
    delete ptrs[e.pointerId];
    if (pinca) { if (Object.keys(ptrs).length < 2) pinca = null; arr = null; return; }
    if (!arr || !p) return;
    var dx = e.clientX - arr.x0, dy = e.clientY - arr.y0;
    arr = null;
    ov.style.background = '';
    if (z === 1 && moveu) {
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) && lista.length > 1) { ir(dx < 0 ? 1 : -1); return; }
      if (dy > 110 && Math.abs(dy) > Math.abs(dx)) { fechar(); return; }
      aplicar(true);
      return;
    }
    /* com setPointerCapture o alvo do evento é o palco, não a foto:
       confere pela posição se o toque caiu em cima da imagem */
    var ri = img.getBoundingClientRect();
    var naFoto = e.clientX >= ri.left && e.clientX <= ri.right && e.clientY >= ri.top && e.clientY <= ri.bottom;
    if (!moveu && naFoto) {
      var agora = Date.now();
      if (agora - ultimoToque < 300) {
        zoomEm(z > 1.01 ? 1 : DUPLO, e.clientX, e.clientY, true);
        ultimoToque = 0;
      } else ultimoToque = agora;
    }
  }

  /* ── abrir / navegar / fechar ── */
  function mostrar(i) {
    idx = (i + lista.length) % lista.length;
    resetar(false);
    var it = lista[idx];
    img.src = it.src;
    img.alt = it.alt || ('Foto ' + (idx + 1));
    cont.textContent = lista.length > 1 ? (idx + 1) + ' / ' + lista.length : '';
    btnAnt.hidden = btnProx.hidden = lista.length < 2;
    /* pré-carrega a vizinha para a troca não piscar */
    if (lista.length > 1) { var pre = new Image(); pre.src = lista[(idx + 1) % lista.length].src; }
  }
  function ir(d) { if (lista.length > 1) mostrar(idx + d); }

  function abrir(itens, i, origem) {
    montar();
    lista = itens; voltarFoco = origem || document.activeElement;
    ptrs = {}; pinca = null; arr = null;
    mostrar(i || 0);
    dica.style.opacity = '';
    ov.classList.add('on');
    document.documentElement.style.overflow = 'hidden';
    btnFechar.focus();
    setTimeout(esconderDica, 3500);
    try { history.pushState({ fg: 1 }, ''); } catch (e) {}
  }
  function fechar(deHistorico) {
    if (!ov || !ov.classList.contains('on')) return;
    ov.classList.remove('on');
    document.documentElement.style.overflow = '';
    img.removeAttribute('src');
    if (voltarFoco && voltarFoco.focus) voltarFoco.focus();
    /* botão "voltar" do celular fecha a galeria em vez de sair da página */
    if (deHistorico !== true) { try { if (history.state && history.state.fg) history.back(); } catch (e) {} }
  }
  window.addEventListener('popstate', function () { fechar(true); });

  /* gatilho: <a data-galeria="grupo" href="..."> */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-galeria]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button > 0) return;
    e.preventDefault();
    var grupo = a.getAttribute('data-galeria');
    var links = [].slice.call(document.querySelectorAll('a[data-galeria="' + grupo.replace(/"/g, '') + '"]'));
    var itens = links.map(function (l) {
      var im = l.querySelector('img');
      return { src: l.getAttribute('href'), alt: im ? im.getAttribute('alt') : '' };
    });
    abrir(itens, Math.max(0, links.indexOf(a)), a);
  });

  window.FieldoGaleria = { abrir: abrir, fechar: fechar };
})();
