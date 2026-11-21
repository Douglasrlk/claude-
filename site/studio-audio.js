/* ════════════════════════════════════════════════════════════════
   FIELDO.StudioAudio — mixagem do Studio v2  (v12.43)
   ════════════════════════════════════════════════════════════════
   Junta num só AudioBuffer (48 kHz, estéreo, do tamanho exato do vídeo):
     · a música (trilha composta ou do aparelho), com volume;
     · o som original de cada clipe de vídeo, no lugar, na velocidade e
       no volume escolhidos;
     · "abaixar a música" (ducking): enquanto um clipe com som toca, a
       música desce para 30 % e volta depois.
   O mesmo buffer serve à prévia e à exportação. Tudo no aparelho.
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var SR = 48000, cache = {};

  function Off(dur) {
    var C = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    return C ? new C(2, Math.max(1, Math.ceil(dur * SR)), SR) : null;
  }

  /* Som de um vídeo. null se o vídeo não tem áudio ou o navegador não decodifica. */
  function extrair(url) {
    if (cache[url]) return cache[url];
    var p = fetch(url, { mode: 'cors', credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('http_' + r.status);
      return r.arrayBuffer();
    }).then(function (ab) {
      var ctx = Off(1);
      if (!ctx) return null;
      return new Promise(function (ok) {
        var feito = false;
        var fim = function (b) { if (!feito) { feito = true; ok(b || null); } };
        try {
          var r = ctx.decodeAudioData(ab, fim, function () { fim(null); });
          if (r && r.then) r.then(fim, function () { fim(null); });
        } catch (e) { fim(null); }
      });
    }).catch(function () { return null; });
    cache[url] = p;
    return p;
  }

  /**
   * opts = { dur, musica (AudioBuffer|null), volume (0..1), abaixar (bool),
   *          clipes: [{ buffer (AudioBuffer|null), ini, dur, de, ate, vel, vol }] }
   * Promise<AudioBuffer|null>
   */
  function mixar(opts) {
    var dur = Math.max(1, Number(opts.dur) || 1), musica = opts.musica || null;
    var vm = opts.volume == null ? 1 : Math.max(0, Math.min(1, Number(opts.volume)));
    var clipes = (opts.clipes || []).filter(function (c) { return c.buffer && c.vol > 0.001; });
    if (!musica && !clipes.length) return Promise.resolve(null);
    /* só a música, no volume cheio: não precisa remixar */
    if (musica && !clipes.length && vm >= 0.999) return Promise.resolve(musica);
    var ctx = Off(dur);
    if (!ctx) return Promise.resolve(musica);
    try {
      if (musica && vm > 0.001) {
        var sm = ctx.createBufferSource(), gm = ctx.createGain();
        sm.buffer = musica; gm.gain.setValueAtTime(vm, 0);
        if (opts.abaixar) {
          clipes.forEach(function (c) {
            var a = Math.max(0, c.ini - 0.25), b = Math.min(dur, c.ini + c.dur);
            gm.gain.setValueAtTime(vm, a);
            gm.gain.linearRampToValueAtTime(vm * 0.3, a + 0.25);
            gm.gain.setValueAtTime(vm * 0.3, Math.max(a + 0.26, b - 0.05));
            gm.gain.linearRampToValueAtTime(vm, b + 0.3);
          });
        }
        sm.connect(gm); gm.connect(ctx.destination); sm.start(0);
      }
      clipes.forEach(function (c) {
        var s = ctx.createBufferSource(), g = ctx.createGain(), trecho = Math.max(0.05, (c.ate - c.de));
        s.buffer = c.buffer; s.playbackRate.value = c.vel || 1;
        var fimC = c.ini + c.dur;
        g.gain.setValueAtTime(0.0001, c.ini); g.gain.linearRampToValueAtTime(c.vol, c.ini + 0.06);
        g.gain.setValueAtTime(c.vol, Math.max(c.ini + 0.07, fimC - 0.08)); g.gain.linearRampToValueAtTime(0.0001, fimC);
        s.connect(g); g.connect(ctx.destination);
        s.start(c.ini, Math.min(c.de, Math.max(0, c.buffer.duration - 0.05)), trecho);
      });
      return ctx.startRendering().catch(function () { return musica; });
    } catch (e) { return Promise.resolve(musica); }
  }

  global.FIELDO = global.FIELDO || {};
  global.FIELDO.StudioAudio = { extrair: extrair, mixar: mixar, SAMPLE_RATE: SR };
})(window);
