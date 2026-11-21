/* ════════════════════════════════════════════════════════════════
   FIELDO.StudioTrilhas — trilhas do Fieldo Studio  (v12.41)
   ════════════════════════════════════════════════════════════════
   As três trilhas são COMPOSTAS e SINTETIZADAS no aparelho, com Web
   Audio (OfflineAudioContext). Não há arquivo de música:
     - nada a licenciar: o som é gerado aqui, nota por nota;
     - nada a baixar: zero byte de áudio no site;
     - sempre do tamanho exato do vídeo, terminando junto com ele.

   render(nome, segundos) devolve um AudioBuffer estéreo 48 kHz que
   serve à prévia (tocado ao vivo) e à exportação (codificado no MP4).
   Determinístico: o mesmo nome e duração geram o mesmo som, então a
   prévia é exatamente o que vai para o arquivo.

   Arquivo independente: não toca em db.js nem em nenhuma outra tela.
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var SR = 48000;

  function hz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  /* PRNG com semente: o ruído (prato, chocalho, reverb) sai igual sempre */
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function ruido(ctx, seg, seed) {
    var n = Math.ceil(seg * ctx.sampleRate), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0), r = rng(seed);
    for (var i = 0; i < n; i++) d[i] = r() * 2 - 1;
    return b;
  }

  /* resposta de sala: ruído estéreo com queda exponencial (reverb leve) */
  function impulso(ctx, seg, queda) {
    var n = Math.ceil(seg * ctx.sampleRate), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = b.getChannelData(c), r = rng(91 + c * 7);
      for (var i = 0; i < n; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / n, queda);
    }
    return b;
  }

  /* ── mesa: instrumentos → (seco, reverb, eco) → compressor → saída ── */
  function Mesa(ctx, dur) {
    this.ctx = ctx; this.dur = dur;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 3.2;
    comp.attack.value = 0.004; comp.release.value = 0.22;
    var master = ctx.createGain();
    /* entrada suave e saída longa: termina junto com o vídeo, sem corte */
    var g = master.gain, fimFade = Math.max(0.6, dur - 0.04), iniFade = Math.max(0.5, dur - 1.6);
    g.setValueAtTime(0.0001, 0);
    g.exponentialRampToValueAtTime(0.9, 0.35);
    g.setValueAtTime(0.9, iniFade);
    g.exponentialRampToValueAtTime(0.0001, fimFade);
    comp.connect(master); master.connect(ctx.destination);

    this.seco = ctx.createGain(); this.seco.connect(comp);

    var conv = ctx.createConvolver(); conv.buffer = impulso(ctx, 1.8, 3.4);
    this.rev = ctx.createGain(); this.rev.gain.value = 0.26;
    this.rev.connect(conv); conv.connect(comp);

    var eco = ctx.createDelay(1.5), fb = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2600; fb.gain.value = 0.32;
    this.eco = ctx.createGain(); this.eco.gain.value = 0.22;
    this.eco.connect(eco); eco.connect(lp); lp.connect(fb); fb.connect(eco); lp.connect(comp);
    this.ecoDelay = eco;
    this._ruidos = {};
  }
  Mesa.prototype.saida = function (pan, rev, eco) {
    var ctx = this.ctx, g = ctx.createGain(), p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan || 0; g.connect(p); p.connect(this.seco); } else g.connect(this.seco);
    if (rev) { var r = ctx.createGain(); r.gain.value = rev; g.connect(r); r.connect(this.rev); }
    if (eco) { var e = ctx.createGain(); e.gain.value = eco; g.connect(e); e.connect(this.eco); }
    return g;
  };
  Mesa.prototype.ruido = function (seed) {
    return this._ruidos[seed] || (this._ruidos[seed] = ruido(this.ctx, 1.2, seed));
  };
  Mesa.prototype.vivo = function (t) { return t >= 0 && t < this.dur - 0.05; };

  /* ── agendamento por janelas ─────────────────────────────────────
     Um OfflineAudioContext processa TODO nó conectado em TODO bloco de
     128 amostras, tocando ou não. Criar as ~1.500 notas de uma vez fazia
     uma trilha de 16 s levar 5 s para gerar (medido). As notas entram
     numa fila e são criadas janela a janela, com suspend(): o grafo vivo
     fica com as notas daquele segundo, não com a música inteira. */
  function agendado(fn) {
    return function (m, t) {
      if (!m.vivo(t)) return;
      if (m.fila) { m.fila.push({ t: t, fn: fn, a: Array.prototype.slice.call(arguments) }); return; }
      fn.apply(null, arguments);
    };
  }

  /* ── instrumentos ─────────────────────────────────────────────── */
  var pad = agendado(function (m, t, dur, notas, vol, brilho) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, fim = Math.min(t + dur, m.dur), out = m.saida(0, 0.55, 0);
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.4;
    lp.frequency.setValueAtTime(brilho * 0.55, t);
    lp.frequency.linearRampToValueAtTime(brilho, t + dur * 0.6);
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(vol, t + Math.min(0.7, dur * 0.35));
    env.gain.setValueAtTime(vol, Math.max(t + 0.71, fim - 0.6));
    env.gain.linearRampToValueAtTime(0.0001, fim + 0.5);
    lp.connect(env); env.connect(out);
    notas.forEach(function (n, i) {
      [-7, 7].forEach(function (cents, k) {
        var o = ctx.createOscillator(); o.type = k ? 'sawtooth' : 'triangle';
        o.frequency.value = hz(n); o.detune.value = cents + i;
        var gg = ctx.createGain(); gg.gain.value = k ? 0.32 : 0.6;
        o.connect(gg); gg.connect(lp); o.start(t); o.stop(fim + 0.6);
      });
    });
  });

  var pluck = agendado(function (m, t, n, vol, pan, decai) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(pan, 0.25, 0.6), d = decai || 0.55;
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + d);
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5200, t); lp.frequency.exponentialRampToValueAtTime(900, t + d);
    lp.connect(env); env.connect(out);
    var o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = hz(n);
    var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = hz(n + 12);
    var g2 = ctx.createGain(); g2.gain.value = 0.35;
    o1.connect(lp); o2.connect(g2); g2.connect(lp);
    o1.start(t); o2.start(t); o1.stop(t + d + 0.05); o2.stop(t + d + 0.05);
  });

  /* piano elétrico: fundamental + parcial de sino que some rápido */
  var epiano = agendado(function (m, t, n, dur, vol, pan) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(pan, 0.45, 0.15), fim = Math.min(t + dur, m.dur);
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    env.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.5);
    env.gain.exponentialRampToValueAtTime(0.0001, fim + 0.9);
    env.connect(out);
    var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz(n); o.connect(env);
    var sino = ctx.createOscillator(); sino.type = 'sine'; sino.frequency.value = hz(n) * 3.01;
    var gs = ctx.createGain(); gs.gain.setValueAtTime(vol * 0.5, t); gs.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    sino.connect(gs); gs.connect(out);
    o.start(t); sino.start(t); o.stop(fim + 1); sino.stop(t + 0.4);
  });

  var baixo = agendado(function (m, t, n, dur, vol) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(0, 0, 0), fim = Math.min(t + dur, m.dur);
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    env.gain.exponentialRampToValueAtTime(vol * 0.55, t + dur * 0.5);
    env.gain.exponentialRampToValueAtTime(0.0001, fim + 0.08);
    lp.connect(env); env.connect(out);
    var o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(n);
    var s = ctx.createOscillator(); s.type = 'sine'; s.frequency.value = hz(n);
    var gs = ctx.createGain(); gs.gain.value = 0.8;
    o.connect(lp); s.connect(gs); gs.connect(env);
    o.start(t); s.start(t); o.stop(fim + 0.1); s.stop(fim + 0.1);
  });

  var bumbo = agendado(function (m, t, vol) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(0, 0, 0);
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    var env = ctx.createGain(); env.gain.setValueAtTime(vol, t); env.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(env); env.connect(out); o.start(t); o.stop(t + 0.4);
    /* clique de ataque, para o bumbo existir em alto-falante de celular */
    var c = ctx.createBufferSource(); c.buffer = m.ruido(3);
    var hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 3200;
    var gc = ctx.createGain(); gc.gain.setValueAtTime(vol * 0.18, t); gc.gain.exponentialRampToValueAtTime(0.0001, t + 0.015);
    c.connect(hp); hp.connect(gc); gc.connect(out); c.start(t); c.stop(t + 0.02);
  });

  var palma = agendado(function (m, t, vol) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(0, 0.35, 0);
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.8;
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    [0, 0.011, 0.022].forEach(function (d) {
      env.gain.setValueAtTime(vol, t + d); env.gain.exponentialRampToValueAtTime(vol * 0.2, t + d + 0.009);
    });
    env.gain.setValueAtTime(vol * 0.8, t + 0.03); env.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    var s = ctx.createBufferSource(); s.buffer = m.ruido(5);
    s.connect(bp); bp.connect(env); env.connect(out); s.start(t); s.stop(t + 0.25);
  });

  var prato = agendado(function (m, t, vol, aberto, pan) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(pan || 0, 0.1, 0), d = aberto ? 0.22 : 0.045;
    var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7200;
    var env = ctx.createGain(); env.gain.setValueAtTime(vol, t); env.gain.exponentialRampToValueAtTime(0.0001, t + d);
    var s = ctx.createBufferSource(); s.buffer = m.ruido(aberto ? 11 : 13);
    s.connect(hp); hp.connect(env); env.connect(out); s.start(t, (t * 7.3) % 0.8); s.stop(t + d + 0.02);
  });

  var chocalho = agendado(function (m, t, vol, pan) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(pan || 0, 0.15, 0);
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 6200; bp.Q.value = 1.1;
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(vol, t + 0.012); env.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    var s = ctx.createBufferSource(); s.buffer = m.ruido(17);
    s.connect(bp); bp.connect(env); env.connect(out); s.start(t, (t * 3.1) % 0.9); s.stop(t + 0.09);
  });

  var stab = agendado(function (m, t, notas, vol) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(0, 0.3, 0.45);
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.16);
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + 0.005); env.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    lp.connect(env); env.connect(out);
    notas.forEach(function (n, i) {
      var o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = hz(n); o.detune.value = i * 3 - 3;
      var g = ctx.createGain(); g.gain.value = 0.22; o.connect(g); g.connect(lp); o.start(t); o.stop(t + 0.22);
    });
  });

  /* ── as três trilhas ──────────────────────────────────────────── */
  var TRILHAS = {
    /* Leve — pop acústico, 100 bpm, Dó maior (C G Am F). O padrão. */
    leve: {
      nome: 'Leve', descricao: 'Animada e acolhedora', bpm: 100,
      compor: function (m) {
        var b = 60 / this.bpm, compasso = b * 4, dur = m.dur;
        var acordes = [[60, 64, 67], [59, 62, 67], [57, 60, 64], [57, 60, 65]], raiz = [36, 43, 45, 41];
        var arp = [0, 1, 2, 1, 0, 2, 1, 2];
        var fimRitmo = dur - 1.9;
        for (var c = 0, t0 = 0; t0 < dur; c++, t0 += compasso) {
          var k = c % 4, ac = acordes[k], ult = t0 + compasso >= fimRitmo;
          pad(m, t0, ult ? dur - t0 : compasso + 0.05, ac.map(function (n) { return n - 12; }), 0.05, 1400);
          if (ult) { pad(m, t0, dur - t0, [48, 55, 64], 0.06, 1500); epiano(m, t0, 72, dur - t0, 0.08, 0); break; }
          baixo(m, t0, raiz[k], b * 1.8, 0.32); baixo(m, t0 + b * 2, raiz[k], b * 1.6, 0.26);
          for (var i = 0; i < 8; i++) {
            var t = t0 + i * b / 2;
            pluck(m, t, ac[arp[i]] + 12, i % 2 ? 0.07 : 0.1, i % 2 ? 0.25 : -0.25, 0.5);
          }
          if (c >= 1) {
            for (var q = 0; q < 4; q++) {
              var tb = t0 + q * b;
              if (q === 0 || q === 2) bumbo(m, tb, 0.55);
              if (q === 1 || q === 3) palma(m, tb, 0.13);
            }
            for (var s = 0; s < 8; s++) chocalho(m, t0 + s * b / 2, s % 2 ? 0.045 : 0.07, 0.3);
          }
        }
      }
    },

    /* Ritmo — dançante, 118 bpm, Lá menor (Am F C G). Para antes e depois de impacto. */
    ritmo: {
      nome: 'Ritmo', descricao: 'Batida forte, para impressionar', bpm: 118,
      compor: function (m) {
        var b = 60 / this.bpm, compasso = b * 4, dur = m.dur;
        var acordes = [[57, 60, 64], [57, 60, 65], [55, 60, 64], [55, 59, 62]], raiz = [33, 29, 36, 31];
        var fimRitmo = dur - 1.7;
        for (var c = 0, t0 = 0; t0 < dur; c++, t0 += compasso) {
          var k = c % 4, ac = acordes[k], ult = t0 + compasso >= fimRitmo;
          pad(m, t0, ult ? dur - t0 : compasso + 0.05, ac, 0.035, 1800);
          if (ult) { bumbo(m, t0, 0.7); stab(m, t0, ac.map(function (n) { return n + 12; }), 0.12); pad(m, t0, dur - t0, [45, 52, 57, 64], 0.06, 1600); break; }
          for (var q = 0; q < 4; q++) {
            var tb = t0 + q * b;
            bumbo(m, tb, 0.8);
            if (q === 1 || q === 3) palma(m, tb, 0.26);
            prato(m, tb + b / 2, 0.09, true, 0.2);
            stab(m, tb + b / 2, ac.map(function (n) { return n + 12; }), c === 0 ? 0.05 : 0.085);
            baixo(m, tb, raiz[k], b * 0.45, 0.34); baixo(m, tb + b / 2, raiz[k] + 12, b * 0.4, 0.22);
          }
          for (var h = 0; h < 16; h++) if (h % 4 !== 2) prato(m, t0 + h * b / 4, h % 2 ? 0.025 : 0.04, false, -0.2);
        }
      }
    },

    /* Calma — piano e camadas suaves, 72 bpm, Fá maior. Para trabalho delicado. */
    calma: {
      nome: 'Calma', descricao: 'Suave e elegante', bpm: 72,
      compor: function (m) {
        var b = 60 / this.bpm, compasso = b * 4, dur = m.dur;
        var acordes = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [46, 50, 53, 57]], raiz = [41, 36, 38, 34];
        var melodia = [72, 69, 67, 69, 72, 74, 72, 69, 65, 67, 69, 67, 69, 72, 69, 65];
        for (var c = 0, t0 = 0; t0 < dur; c++, t0 += compasso) {
          var k = c % 4, ac = acordes[k], ult = t0 + compasso >= dur - 1.2;
          pad(m, t0, ult ? dur - t0 : compasso + 0.1, ac, 0.04, 1100);
          baixo(m, t0, raiz[k], compasso * 0.9, 0.2);
          ac.forEach(function (n, i) { epiano(m, t0 + i * 0.045, n, compasso * 0.8, 0.07, (i - 1.5) * 0.2); });
          if (ult) break;
          for (var i = 0; i < 4; i++) {
            var nota = melodia[(c * 4 + i) % melodia.length];
            if ((c * 4 + i) % 3 !== 2) epiano(m, t0 + i * b + (i % 2 ? b * 0.5 : 0), nota, b * 1.2, 0.055, 0.15);
          }
        }
      }
    }
  };

  var cache = {};

  /**
   * Gera a trilha. Promise<AudioBuffer|null> (null para 'nenhuma' ou se o
   * navegador não tem Web Audio — o vídeo segue sem som, sem travar).
   */
  function render(nome, segundos) {
    var tr = TRILHAS[nome];
    if (!tr) return Promise.resolve(null);
    var Off = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    if (!Off) return Promise.resolve(null);
    var dur = Math.max(2, Math.min(120, Number(segundos) || 15));
    var chave = nome + ':' + dur.toFixed(3);
    if (cache[chave]) return cache[chave];
    var p;
    try {
      var ctx = new Off(2, Math.ceil(dur * SR), SR);
      var m = new Mesa(ctx, dur);
      m.ecoDelay.delayTime.value = (60 / tr.bpm) * 0.75;
      m.fila = [];
      tr.compor(m);
      var fila = m.fila.sort(function (a, b) { return a.t - b.t; });
      m.fila = null;
      var criar = function (ini, fim) {
        fila.forEach(function (ev) { if (ev.t >= ini && ev.t < fim) ev.fn.apply(null, ev.a); });
      };
      var JANELA = 0.5, ANTES = 0.04;
      if (typeof ctx.suspend === 'function') {
        criar(-1, JANELA);
        for (var w = JANELA; w < dur; w += JANELA) {
          (function (ini) {
            ctx.suspend(ini - ANTES).then(function () { criar(ini, ini + JANELA); ctx.resume(); });
          })(w);
        }
      } else {
        criar(-1, dur + 1);   /* navegador sem suspend(): tudo de uma vez, só mais lento */
      }
      p = ctx.startRendering().catch(function () { return null; });
    } catch (e) {
      p = Promise.resolve(null);
    }
    cache = {}; cache[chave] = p;   /* guarda só a última: áudio de 20 s ocupa ~7 MB */
    return p;
  }

  var LISTA = Object.keys(TRILHAS).map(function (k) {
    return { id: k, nome: TRILHAS[k].nome, descricao: TRILHAS[k].descricao };
  }).concat([{ id: 'nenhuma', nome: 'Sem música', descricao: 'Só a imagem' }]);

  global.FIELDO = global.FIELDO || {};
  global.FIELDO.StudioTrilhas = { render: render, lista: LISTA, SAMPLE_RATE: SR };
})(window);
