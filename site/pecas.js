/* v12.21 · rolagem das peças do topo: cada uma anda numa velocidade
   (--k no CSS). Só enquanto o topo está na tela; nada para quem pediu
   menos movimento. */
(function () {
  var box = document.getElementById('lp2Pecas');
  if (!box || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  var pedido = false, limite = 1400;
  function aplicar() { pedido = false; var y = window.scrollY || 0; if (y <= limite) box.style.setProperty('--sy', y.toFixed(1)); }
  window.addEventListener('scroll', function () { if (!pedido) { pedido = true; requestAnimationFrame(aplicar); } }, { passive: true });
  aplicar();
})();
