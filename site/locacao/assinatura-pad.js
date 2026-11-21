/* ============================================================
   Fieldo Locação · assinatura-pad.js  v1.0
   Campo de desenho da assinatura (dedo, caneta ou mouse).
   É só a REPRESENTAÇÃO VISUAL: a assinatura em si é o aceite
   registrado no banco com as evidências.
   Uso: var pad = AssinaturaPad(canvas); pad.vazio(); pad.limpar(); pad.png();
============================================================ */
function AssinaturaPad(canvas) {
  'use strict';
  var ctx = canvas.getContext('2d'), riscos = 0, desenhando = false, ult = null;

  function ajustar() {
    var r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#14213d';
    riscos = 0;
  }
  function ponto(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  canvas.addEventListener('pointerdown', function (e) {
    desenhando = true; ult = ponto(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!desenhando) return;
    var p = ponto(e);
    ctx.beginPath(); ctx.moveTo(ult.x, ult.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    ult = p; riscos++;
    e.preventDefault();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
    canvas.addEventListener(t, function () { desenhando = false; });
  });

  ajustar();

  return {
    vazio: function () { return riscos < 3; },
    limpar: ajustar,
    /* PNG reduzido (até 600 px de largura) com fundo branco */
    png: function () {
      if (riscos < 3) return null;
      var w = Math.min(600, canvas.width), h = Math.round(canvas.height * (w / canvas.width));
      var c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
      var x = c2.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
      x.drawImage(canvas, 0, 0, w, h);
      return c2.toDataURL('image/png');
    }
  };
}
