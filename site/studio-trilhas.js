/* ════════════════════════════════════════════════════════════════
   FIELDO.StudioTrilhas — trilhas do Fieldo Studio  (v12.41)
   ════════════════════════════════════════════════════════════════
   As trilhas são COMPOSTAS e SINTETIZADAS no aparelho, com Web
   Audio (OfflineAudioContext). Não há arquivo de música:
     - nada a licenciar: o som é gerado aqui, nota por nota;
     - nada a baixar: zero byte de áudio no site;
     - sempre do tamanho exato do vídeo, terminando junto com ele.

   render(nome, segundos) devolve um AudioBuffer estéreo 48 kHz que
   serve à prévia (tocado ao vivo) e à exportação (codificado no MP4).
   Determinístico: o mesmo nome e duração geram o mesmo som, então a
   prévia é exatamente o que vai para o arquivo.

   v12.43 · além das três originais, um COMPOSITOR por estilo: cada
   trilha do catálogo (studio-trilhas-catalogo.js) é uma partitura em
   texto — acordes, bateria em 16 passos, baixo e melodia — tocada pelos
   instrumentos daqui. E a música do aparelho (arquivo do celular), que
   nunca sai do aparelho: aparelho(buffer, segundos, inicio).

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
  function Mesa(ctx, dur, ganho) {
    this.ctx = ctx; this.dur = dur;
    var alvo = 0.9 * (ganho || 1);
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 3.2;
    comp.attack.value = 0.004; comp.release.value = 0.22;
    var master = ctx.createGain();
    /* entrada suave e saída longa: termina junto com o vídeo, sem corte */
    var g = master.gain, fimFade = Math.max(0.6, dur - 0.04), iniFade = Math.max(0.5, dur - 1.6);
    g.setValueAtTime(0.0001, 0);
    g.exponentialRampToValueAtTime(alvo, 0.35);
    g.setValueAtTime(alvo, iniFade);
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

  /* ── v12.43 · instrumentos para os estilos do catálogo ───────────
     Todos seguem o mesmo contrato dos de cima: agendados por janela,
     sem estado, com volume e pan explícitos. */

  function curva(m, k) {
    m._curvas = m._curvas || {};
    if (m._curvas[k]) return m._curvas[k];
    var n = 2048, c = new Float32Array(n), d = Math.tanh(k);
    for (var i = 0; i < n; i++) { var x = i * 2 / n - 1; c[i] = Math.tanh(k * x) / d; }
    return (m._curvas[k] = c);
  }
  function saturar(m, k, os) { var w = m.ctx.createWaveShaper(); w.curve = curva(m, k); w.oversample = os || 'none'; return w; }

  /* 808: seno com queda de afinação no ataque e cauda longa, saturado
     para aparecer no alto-falante do celular (que não reproduz 50 Hz) */
  var oito = agendado(function (m, t, n, dur, vol, ate) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(0, 0, 0), fim = Math.min(t + dur, m.dur), f = hz(n);
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 2.4, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.045);
    if (ate != null) { o.frequency.setValueAtTime(f, Math.max(t + 0.05, fim - 0.09)); o.frequency.exponentialRampToValueAtTime(hz(ate), fim); }
    var sat = saturar(m, 2.2, '2x'), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    env.gain.setValueAtTime(vol, Math.max(t + 0.01, fim - 0.12));
    env.gain.exponentialRampToValueAtTime(0.0001, fim + 0.06);
    o.connect(sat); sat.connect(lp); lp.connect(env); env.connect(out);
    o.start(t); o.stop(fim + 0.1);
  });

  var caixa = agendado(function (m, t, vol, brilho) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(0, 0.3, 0);
    var s = ctx.createBufferSource(); s.buffer = m.ruido(19);
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = brilho || 2000; bp.Q.value = 0.7;
    var env = ctx.createGain(); env.gain.setValueAtTime(vol, t); env.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    s.connect(bp); bp.connect(env); env.connect(out); s.start(t, (t * 5.7) % 0.8); s.stop(t + 0.2);
    var o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(165, t + 0.07);
    var g = ctx.createGain(); g.gain.setValueAtTime(vol * 0.7, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.13);
  });

  var aro = agendado(function (m, t, vol, pan) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(pan || 0, 0.2, 0);
    var o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 1720;
    var g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.05);
    var s = ctx.createBufferSource(); s.buffer = m.ruido(23);
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3400; bp.Q.value = 2;
    var gn = ctx.createGain(); gn.gain.setValueAtTime(vol * 0.6, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
    s.connect(bp); bp.connect(gn); gn.connect(out); s.start(t, (t * 2.3) % 0.9); s.stop(t + 0.04);
  });

  /* cowbell afinado: o timbre que virou assinatura do phonk e do funk automotivo */
  var cowbell = agendado(function (m, t, n, dur, vol, pan) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(pan || 0, 0.25, 0.35), f = hz(n), d = Math.max(0.08, Math.min(dur, 0.45));
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2.1; bp.Q.value = 1.4;
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + 0.002); env.gain.exponentialRampToValueAtTime(vol * 0.3, t + 0.05);
    env.gain.exponentialRampToValueAtTime(0.0001, t + d);
    bp.connect(env); env.connect(out);
    [1, 1.505].forEach(function (k) {
      var o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f * k;
      var g = ctx.createGain(); g.gain.value = 0.5; o.connect(g); g.connect(bp); o.start(t); o.stop(t + d + 0.02);
    });
  });

  /* tambor afinado: atabaque do tamborzão, surdo, timbal, tom de rock */
  var tambor = agendado(function (m, t, n, vol, decai, pan) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(pan || 0, 0.22, 0), f = hz(n), d = decai || 0.25;
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.7, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    var g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.02);
    var s = ctx.createBufferSource(); s.buffer = m.ruido(29);
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 6; bp.Q.value = 1;
    var gn = ctx.createGain(); gn.gain.setValueAtTime(vol * 0.35, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    s.connect(bp); bp.connect(gn); gn.connect(out); s.start(t, (t * 1.9) % 0.9); s.stop(t + 0.05);
  });

  /* log drum do amapiano: grave com "dobra" de afinação e saturação leve */
  var logdrum = agendado(function (m, t, n, dur, vol) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(0, 0.12, 0.1), f = hz(n), d = Math.max(0.12, Math.min(dur, 0.55));
    var o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
    var s2 = ctx.createOscillator(); s2.type = 'sine'; s2.frequency.setValueAtTime(f * 1.5, t); s2.frequency.exponentialRampToValueAtTime(f, t + 0.07);
    var sat = saturar(m, 1.6), lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(500, t + d);
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + 0.004); env.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(sat); s2.connect(sat); sat.connect(lp); lp.connect(env); env.connect(out);
    o.start(t); s2.start(t); o.stop(t + d + 0.02); s2.stop(t + d + 0.02);
  });

  /* sanfona: duas palhetas levemente desafinadas + oitava abaixo, com vibrato de fole */
  var sanfona = agendado(function (m, t, n, dur, vol, pan) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(pan || 0, 0.3, 0.12), fim = Math.min(t + dur, m.dur);
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1350; bp.Q.value = 0.6;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(vol, t + 0.025); env.gain.setValueAtTime(vol * 0.85, Math.max(t + 0.03, fim - 0.05));
    env.gain.linearRampToValueAtTime(0.0001, fim + 0.06);
    bp.connect(lp); lp.connect(env); env.connect(out);
    var lfo = ctx.createOscillator(); lfo.frequency.value = 5.6; var prof = ctx.createGain(); prof.gain.value = 7;
    lfo.connect(prof); lfo.start(t); lfo.stop(fim + 0.08);
    [[0, 'sawtooth', 0.5], [11, 'sawtooth', 0.42], [-1200, 'square', 0.22]].forEach(function (c) {
      var o = ctx.createOscillator(); o.type = c[1]; o.frequency.value = hz(n); o.detune.value = c[0];
      prof.connect(o.detune);
      var g = ctx.createGain(); g.gain.value = c[2]; o.connect(g); g.connect(bp); o.start(t); o.stop(fim + 0.08);
    });
  });

  /* lead "supersaw": três serras desafinadas, filtro que abre no ataque */
  var lead = agendado(function (m, t, n, dur, vol, pan, brilho) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(pan || 0, 0.35, 0.35), fim = Math.min(t + dur, m.dur), b = brilho || 4200;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(b, t); lp.frequency.exponentialRampToValueAtTime(b * 0.35, Math.min(fim, t + 0.4));
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + 0.008); env.gain.setValueAtTime(vol * 0.8, Math.max(t + 0.01, fim - 0.04));
    env.gain.exponentialRampToValueAtTime(0.0001, fim + 0.08);
    lp.connect(env); env.connect(out);
    [-14, 0, 14].forEach(function (c) {
      var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(n); o.detune.value = c;
      var g = ctx.createGain(); g.gain.value = 0.33; o.connect(g); g.connect(lp); o.start(t); o.stop(fim + 0.1);
    });
  });

  /* lead quadrado curto: o "chop" de voz sintética do funk e do future bass */
  var chip = agendado(function (m, t, n, dur, vol, pan) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(pan || 0, 0.3, 0.4), fim = Math.min(t + dur, m.dur);
    var o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = hz(n);
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + 0.005); env.gain.exponentialRampToValueAtTime(vol * 0.5, t + 0.08);
    env.gain.exponentialRampToValueAtTime(0.0001, fim + 0.03);
    o.connect(lp); lp.connect(env); env.connect(out); o.start(t); o.stop(fim + 0.05);
  });

  var assobio = agendado(function (m, t, n, dur, vol, pan) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(pan || 0, 0.45, 0.2), fim = Math.min(t + dur, m.dur);
    var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz(n);
    o.frequency.setValueAtTime(hz(n) * 0.97, t); o.frequency.exponentialRampToValueAtTime(hz(n), t + 0.05);
    var lfo = ctx.createOscillator(); lfo.frequency.value = 5.2; var pr = ctx.createGain(); pr.gain.value = 14;
    lfo.connect(pr); pr.connect(o.detune); lfo.start(t); lfo.stop(fim + 0.1);
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(vol, t + 0.04); env.gain.setValueAtTime(vol, Math.max(t + 0.05, fim - 0.05));
    env.gain.linearRampToValueAtTime(0.0001, fim + 0.07);
    o.connect(env); env.connect(out); o.start(t); o.stop(fim + 0.1);
  });

  /* violão/cavaco: as notas do acorde "raspadas" uma depois da outra */
  var violao = agendado(function (m, t, notas, vol, sobe, decai) {
    if (!m.vivo(t)) return;
    var lista = sobe === false ? notas.slice().reverse() : notas;
    lista.forEach(function (n, i) { pluck(m, t + i * 0.013, n, vol * (1 - i * 0.07), (i - lista.length / 2) * 0.12, decai || 0.9); });
  });

  var metal = agendado(function (m, t, notas, dur, vol) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(0, 0.35, 0.15), fim = Math.min(t + dur, m.dur);
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(3200, t + 0.05); lp.frequency.exponentialRampToValueAtTime(1100, fim);
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + 0.03); env.gain.exponentialRampToValueAtTime(0.0001, fim + 0.1);
    lp.connect(env); env.connect(out);
    notas.forEach(function (n) {
      [-6, 6].forEach(function (c) {
        var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(n); o.detune.value = c;
        var g = ctx.createGain(); g.gain.value = 0.22; o.connect(g); g.connect(lp); o.start(t); o.stop(fim + 0.12);
      });
    });
  });

  /* guitarra distorcida: quinta + oitava (power chord) numa saturação forte */
  var guitarra = agendado(function (m, t, n, dur, vol, pan) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(pan || 0, 0.2, 0), fim = Math.min(t + dur, m.dur);
    var sat = saturar(m, 6), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2900;
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + 0.006); env.gain.setValueAtTime(vol * 0.8, Math.max(t + 0.01, fim - 0.03));
    env.gain.exponentialRampToValueAtTime(0.0001, fim + 0.05);
    sat.connect(lp); lp.connect(env); env.connect(out);
    [n, n + 7, n + 12].forEach(function (x, i) {
      var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(x); o.detune.value = i * 4 - 4;
      var g = ctx.createGain(); g.gain.value = 0.3; o.connect(g); g.connect(sat); o.start(t); o.stop(fim + 0.06);
    });
  });

  var sino = agendado(function (m, t, n, dur, vol, pan) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(pan || 0, 0.45, 0.3), d = Math.max(0.3, dur || 1.1);
    [[1, 1], [2.76, 0.4], [5.4, 0.15]].forEach(function (p) {
      var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz(n) * p[0];
      var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * p[1], t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + d / p[0]);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.05);
    });
  });

  var triangulo = agendado(function (m, t, vol, aberto) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(0.35, 0.2, 0), d = aberto ? 0.45 : 0.07;
    [3150, 4740, 6320].forEach(function (f, i) {
      var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      var g = ctx.createGain(); g.gain.setValueAtTime(vol / (i + 1), t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.02);
    });
  });

  var guizo = agendado(function (m, t, vol) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(-0.3, 0.25, 0);
    var s = ctx.createBufferSource(); s.buffer = m.ruido(31);
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 7600; bp.Q.value = 2.2;
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    [0, 0.03, 0.06].forEach(function (d, i) { env.gain.setValueAtTime(vol * (1 - i * 0.25), t + d); env.gain.exponentialRampToValueAtTime(vol * 0.15, t + d + 0.025); });
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    s.connect(bp); bp.connect(env); env.connect(out); s.start(t, (t * 4.1) % 0.9); s.stop(t + 0.18);
  });

  /* chiado de vinil (lo-fi): estalos esparsos sobre ruído bem baixo */
  var vinil = agendado(function (m, t, dur, vol) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(0, 0, 0), fim = Math.min(t + dur, m.dur);
    if (!m._vinil) {
      var n = Math.ceil(1.2 * ctx.sampleRate), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0), r = rng(37);
      for (var i = 0; i < n; i++) d[i] = (r() * 2 - 1) * 0.08 + (r() < 0.0009 ? (r() * 2 - 1) : 0);
      m._vinil = b;
    }
    var s = ctx.createBufferSource(); s.buffer = m._vinil; s.loop = true;
    var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    var g = ctx.createGain(); g.gain.value = vol;
    s.connect(hp); hp.connect(g); g.connect(out); s.start(t); s.stop(fim);
  });

  /* subida (riser) antes da virada */
  var subida = agendado(function (m, t, dur, vol) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, out = m.saida(0, 0.5, 0), fim = Math.min(t + dur, m.dur);
    var s = ctx.createBufferSource(); s.buffer = m.ruido(41); s.loop = true;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.8;
    bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(7000, fim);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, fim - 0.02); g.gain.linearRampToValueAtTime(0.0001, fim);
    s.connect(bp); bp.connect(g); g.connect(out); s.start(t); s.stop(fim + 0.01);
  });

  /* pad com "bombeamento" (sidechain) no tempo: house, future bass */
  var padBomba = agendado(function (m, t, dur, notas, vol, brilho, batida) {
    if (!m.vivo(t)) return;
    var ctx = m.ctx, fim = Math.min(t + dur, m.dur), out = m.saida(0, 0.35, 0.1);
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = brilho; lp.Q.value = 0.6;
    var env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t);
    for (var tb = t; tb < fim; tb += batida) {
      env.gain.setValueAtTime(vol * 0.12, tb);
      env.gain.linearRampToValueAtTime(vol, Math.min(fim, tb + batida * 0.62));
    }
    env.gain.linearRampToValueAtTime(0.0001, fim + 0.15);
    lp.connect(env); env.connect(out);
    notas.forEach(function (n) {
      [-12, 0, 12].forEach(function (c, k) {
        var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(n); o.detune.value = c + k;
        var g = ctx.createGain(); g.gain.value = 0.18; o.connect(g); g.connect(lp); o.start(t); o.stop(fim + 0.2);
      });
    });
  });

  /* ── notação das partituras ──────────────────────────────────────
     Nota:   "C4", "F#5", "Bb3"            (Dó central = C4 = MIDI 60)
     Acorde: "Am", "F", "Cmaj7", "G7", "Dm9", "Esus4", "Bdim", "C6", "Fadd9"
     Linha de 16 passos (semicolcheias) por compasso, compassos com "|":
       nota ou grau   toca;    "-"  segura a nota anterior;   "."  pausa
     No baixo, graus em relação à fundamental do acorde do compasso:
       R (fundamental), 3, b3, 5, 6, b7, 7, 8 (oitava), 9 (nona); "R-" etc.
     Bateria: "x" forte, "o" fraco, "." nada — 16 caracteres por compasso. */
  var NOMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function nota(s) {
    var mt = /^([A-G])(#|b)?(-?\d)$/.exec(String(s).trim());
    if (!mt) throw new Error('nota inválida: ' + s);
    return 12 * (Number(mt[3]) + 1) + NOMES[mt[1]] + (mt[2] === '#' ? 1 : mt[2] === 'b' ? -1 : 0);
  }
  var QUALIDADES = {
    '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus2: [0, 2, 7],
    sus4: [0, 5, 7], dim: [0, 3, 6], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], add9: [0, 4, 7, 14], '9': [0, 4, 7, 10, 14],
    m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14], '5': [0, 7, 12]
  };
  /* fundamental entre G3 e F#4: as vozes ficam na região média, como num teclado */
  function acorde(s) {
    var mt = /^([A-G])(#|b)?(.*)$/.exec(String(s).trim()), q = mt && QUALIDADES[mt[3]];
    if (!mt || !q) throw new Error('acorde inválido: ' + s);
    var pc = (NOMES[mt[1]] + (mt[2] === '#' ? 1 : mt[2] === 'b' ? -1 : 0) + 12) % 12;
    var raiz = 55 + ((pc - 7 + 12) % 12);
    return { raiz: raiz, notas: q.map(function (i) { return raiz + i; }) };
  }
  var GRAUS = { R: 0, b2: 1, '2': 2, b3: 3, '3': 4, '4': 5, b5: 6, '5': 7, b6: 8, '6': 9, b7: 10, '7': 11, '8': 12, '9': 14, '-5': -5, '-8': -12 };
  /* "x . - o" → eventos {passo, dur (em passos), v (valor), forte} */
  function linha(texto) {
    var compassos = String(texto).split('|'), ev = [];
    compassos.forEach(function (cmp, c) {
      var tk = cmp.trim().split(/\s+/).filter(Boolean);
      if (tk.length !== 16) throw new Error('compasso com ' + tk.length + ' passos (precisa de 16): ' + cmp.trim());
      tk.forEach(function (x, i) {
        var p = c * 16 + i;
        if (x === '-') { if (ev.length && ev[ev.length - 1].fim === p) { ev[ev.length - 1].dur++; ev[ev.length - 1].fim++; } return; }
        if (x === '.') return;
        ev.push({ passo: p, dur: 1, fim: p + 1, v: x });
      });
    });
    return { ev: ev, passos: compassos.length * 16 };
  }
  function ritmo(texto) {
    var s = String(texto).replace(/[\s|]/g, '');
    if (s.length % 16) throw new Error('bateria precisa de múltiplos de 16: ' + texto);
    return s;
  }

  /* ── o compositor por estilo ─────────────────────────────────────
     def = {
       bpm, swing (0..0.3), acordes: ["Am","F",...] (1 por compasso, em ciclo),
       intro (compassos só com harmonia), ganho (mixagem final),
       bateria: { bumbo, caixa, palma, aro, chimbal, chimbalAberto, chocalho,
                  triangulo, guizo, tom:[nota, padrao], tom2:[...], cowbell:[nota, padrao] },
       baixo:   { inst: 'oito'|'baixo'|'logdrum'|'tambor', oitava, padrao (graus), vol },
       harmonia:{ inst: 'pad'|'padBomba'|'epiano'|'violao'|'stab'|'metal'|'sanfona'|'guitarra'|'arpejo',
                  padrao (x/o em 16 passos, para os rítmicos), vol, brilho, oitava },
       melodia: { inst, notas (linha de compassos), vol, entra (compasso), oitava },
       contra:  { ...segunda melodia, mesmo formato },
       subida:  true → riser no compasso antes da bateria entrar
       final:   'stab' | 'pad' | 'sino'
     } */
  function tocarMelodia(m, mel, t0Bloco, passo, total, n) {
    var L = mel._l || (mel._l = linha(mel.notas)), desloc = (mel.oitava || 0) * 12;
    var cicloPassos = L.passos, base = (n * 16) % cicloPassos;
    L.ev.forEach(function (e) {
      if (e.passo < base || e.passo >= base + 16) return;
      var t = t0Bloco + (e.passo - base) * passo, d = e.dur * passo * 0.96, nn = nota(e.v) + desloc, v = mel.vol, pan = mel.pan || 0;
      switch (mel.inst) {
        case 'sanfona': sanfona(m, t, nn, d, v, pan); break;
        case 'lead': lead(m, t, nn, d, v, pan, mel.brilho); break;
        case 'chip': chip(m, t, nn, d, v, pan); break;
        case 'assobio': assobio(m, t, nn, d, v, pan); break;
        case 'cowbell': cowbell(m, t, nn, d, v, pan); break;
        case 'sino': sino(m, t, nn, Math.max(0.5, d * 1.6), v, pan); break;
        case 'epiano': epiano(m, t, nn, d, v, pan); break;
        case 'pluck': pluck(m, t, nn, v, pan, Math.max(0.25, d)); break;
        case 'metal': metal(m, t, [nn], d, v); break;
        case 'guitarra': guitarra(m, t, nn, d, v, pan); break;
        default: pluck(m, t, nn, v, pan, d);
      }
    });
  }

  function estilo(def) {
    return function (m) {
      var bpm = def.bpm, b = 60 / bpm, passo = b / 4, compasso = b * 4, dur = m.dur;
      var cifras = def.acordes.map(acorde), intro = def.intro == null ? 1 : def.intro;
      var bat = {}, chaves = Object.keys(def.bateria || {});
      chaves.forEach(function (k) {
        var x = def.bateria[k];
        bat[k] = Array.isArray(x) ? { nota: nota(x[0]), r: ritmo(x[1]) } : { r: ritmo(x) };
      });
      var baixoL = def.baixo ? linha(def.baixo.padrao) : null;
      var harmL = def.harmonia && def.harmonia.padrao ? ritmo(def.harmonia.padrao) : null;
      var fimMusica = dur - (def.cauda || 1.8);
      function sw(i) { return i % 2 ? passo * (def.swing || 0) : 0; }
      for (var c = 0, t0 = 0; t0 < dur; c++, t0 += compasso) {
        var cif = cifras[c % cifras.length], ult = t0 + compasso >= fimMusica, comBateria = c >= intro;
        var H = def.harmonia || {}, vh = H.vol || 0.05, oh = (H.oitava || 0) * 12;
        var notasH = cif.notas.map(function (n) { return n + oh; });

        if (ult) {
          /* final: golpe, acorde que soa até o vídeo acabar */
          var resto = dur - t0;
          if (def.final === 'stab' || !def.final) { bumbo(m, t0, 0.75); stab(m, t0, notasH.map(function (n) { return n + 12; }), 0.11); prato(m, t0, 0.1, true); }
          if (def.final === 'sino') sino(m, t0, notasH[notasH.length - 1] + 12, resto, 0.12, 0);
          if (def.final === 'guitarra') guitarra(m, t0, cif.raiz - 12, resto, 0.1, 0);
          pad(m, t0, resto, notasH, 0.06, 1500);
          if (def.baixo) baixo(m, t0, cif.raiz - 24, Math.min(resto, 1.6), 0.28);
          break;
        }

        /* harmonia */
        if (H.inst === 'pad' || !H.inst) pad(m, t0, compasso + 0.05, notasH, vh, H.brilho || 1500);
        else if (H.inst === 'padBomba') padBomba(m, t0, compasso + 0.02, notasH, vh, H.brilho || 2200, b);
        else if (H.inst === 'arpejo') {
          var ordem = H.ordem || [0, 1, 2, 1, 0, 2, 1, 2];
          for (var a = 0; a < 16; a += (H.passos || 2)) {
            var ix = ordem[(a / (H.passos || 2)) % ordem.length] % notasH.length;
            pluck(m, t0 + a * passo + sw(a), notasH[ix] + 12, vh, a % 4 ? 0.25 : -0.25, H.decai || 0.45);
          }
          if (H.fundo) pad(m, t0, compasso + 0.05, notasH, H.fundo, 1100);
        } else if (harmL) {
          var ini = (c * 16) % harmL.length;
          for (var h = 0; h < 16; h++) {
            var ch = harmL[ini + h]; if (ch === '.') continue;
            var th = t0 + h * passo + sw(h), forte = ch === 'x' ? 1 : 0.6;
            if (H.inst === 'violao') violao(m, th, notasH, vh * forte, h % 4 !== 2, H.decai);
            else if (H.inst === 'epiano') notasH.forEach(function (n, i) { epiano(m, th + i * 0.01, n, b * (H.segura || 1), vh * forte, (i - 1) * 0.2); });
            else if (H.inst === 'stab') stab(m, th, notasH.map(function (n) { return n + 12; }), vh * forte);
            else if (H.inst === 'metal') metal(m, th, notasH, b * (H.segura || 0.5), vh * forte);
            else if (H.inst === 'sanfona') notasH.forEach(function (n) { sanfona(m, th, n, b * (H.segura || 0.45), vh * forte / notasH.length, 0); });
            else if (H.inst === 'guitarra') guitarra(m, th, cif.raiz - 12 + oh, b * (H.segura || 0.45), vh * forte, 0);
          }
          if (H.fundo) pad(m, t0, compasso + 0.05, notasH, H.fundo, 1100);
        }

        /* subida antes da entrada da bateria */
        if (def.subida && c === intro - 1) subida(m, t0 + compasso * 0.5, compasso * 0.5, 0.09);

        /* baixo */
        if (baixoL && (comBateria || def.baixo.desdeInicio)) {
          var B = def.baixo, bi = (c * 16) % baixoL.passos;
          baixoL.ev.forEach(function (e) {
            if (e.passo < bi || e.passo >= bi + 16) return;
            var g = e.v.replace(/^R/, 'R'), semi = GRAUS[g];
            var nn = semi == null ? nota(g) : cif.raiz - 24 + (B.oitava || 0) * 12 + semi;
            var tb = t0 + (e.passo - bi) * passo + sw(e.passo), db = e.dur * passo * 0.95;
            if (B.inst === 'oito') oito(m, tb, nn, db, B.vol || 0.5);
            else if (B.inst === 'logdrum') logdrum(m, tb, nn + 12, db, B.vol || 0.45);
            else if (B.inst === 'tambor') tambor(m, tb, nn + 12, B.vol || 0.5, Math.max(0.2, db));
            else baixo(m, tb, nn, db, B.vol || 0.3);
          });
        }

        /* bateria */
        if (comBateria) {
          chaves.forEach(function (k) {
            var d = bat[k], r = d.r, ini = (c * 16) % r.length;
            for (var i = 0; i < 16; i++) {
              var ch = r[ini + i]; if (ch === '.') continue;
              var t = t0 + i * passo + sw(i), f = ch === 'x' ? 1 : 0.55;
              switch (k) {
                case 'bumbo': bumbo(m, t, 0.78 * f); break;
                case 'caixa': caixa(m, t, 0.32 * f); break;
                case 'palma': palma(m, t, 0.24 * f); break;
                case 'aro': aro(m, t, 0.22 * f, 0.2); break;
                case 'chimbal': prato(m, t, 0.05 * f, false, -0.2); break;
                case 'chimbalAberto': prato(m, t, 0.07 * f, true, 0.2); break;
                case 'chocalho': chocalho(m, t, 0.06 * f, 0.3); break;
                case 'triangulo': triangulo(m, t, 0.05 * f, ch === 'x'); break;
                case 'guizo': guizo(m, t, 0.07 * f); break;
                case 'tom': case 'tom2': case 'tom3': tambor(m, t, d.nota, 0.42 * f, 0.28, k === 'tom2' ? 0.3 : -0.2); break;
                case 'cowbell': cowbell(m, t, d.nota, passo * 1.5, 0.12 * f, 0.15); break;
              }
            }
          });
        }

        /* melodias */
        [def.melodia, def.contra].forEach(function (mel) {
          if (!mel || c < (mel.entra == null ? intro : mel.entra)) return;
          tocarMelodia(m, mel, t0, passo, compasso, c - (mel.entra == null ? intro : mel.entra));
        });
        if (def.vinil) vinil(m, t0, compasso + 0.02, def.vinil);
        if (def.extra) def.extra({ m: m, c: c, t0: t0, b: b, passo: passo, acorde: cif, i: { sino: sino, subida: subida, prato: prato, tambor: tambor, caixa: caixa } });
      }
    };
  }

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
      var m = new Mesa(ctx, dur, tr.ganho);
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
    return { id: k, nome: TRILHAS[k].nome, descricao: TRILHAS[k].descricao, genero: 'Fieldo', bpm: TRILHAS[k].bpm };
  }).concat([{ id: 'nenhuma', nome: 'Sem música', descricao: 'Só a imagem', genero: '' }]);

  /* v12.43 · catálogo: cada def vira uma trilha tocada pelo compositor de estilos.
     O id é o que vai para o banco (studio_videos.trilha: ^[a-z0-9_]{2,32}$). */
  function registrar(defs) {
    defs.forEach(function (d) {
      if (!/^[a-z0-9_]{2,32}$/.test(d.id) || TRILHAS[d.id] || d.id === 'aparelho' || d.id === 'nenhuma') throw new Error('id de trilha inválido: ' + d.id);
      TRILHAS[d.id] = { nome: d.nome, descricao: d.descricao, bpm: d.bpm, ganho: d.ganho || 1, compor: estilo(d) };
      LISTA.splice(LISTA.length - 1, 0, { id: d.id, nome: d.nome, descricao: d.descricao, genero: d.genero, bpm: d.bpm });
    });
  }

  /* Música do aparelho: o trecho escolhido, do tamanho exato do vídeo.
     Mais curta que o vídeo: repete. Entrada suave e saída de 1,5 s, como
     as compostas. Reamostrada para 48 kHz. Nada sai do aparelho. */
  function aparelho(buffer, segundos, inicio) {
    var Off = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    if (!buffer || !Off) return Promise.resolve(null);
    var dur = Math.max(2, Math.min(120, Number(segundos) || 15)), ini = Math.max(0, Math.min(Number(inicio) || 0, Math.max(0, buffer.duration - 1)));
    try {
      var ctx = new Off(2, Math.ceil(dur * SR), SR), g = ctx.createGain(), t = 0, trecho = buffer.duration - ini;
      g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(1, 0.25);
      g.gain.setValueAtTime(1, Math.max(0.3, dur - 1.6)); g.gain.exponentialRampToValueAtTime(0.0001, Math.max(0.35, dur - 0.04));
      g.connect(ctx.destination);
      var primeira = true;
      while (t < dur) {
        var src = ctx.createBufferSource(); src.buffer = buffer; src.connect(g);
        var de = primeira ? ini : 0, quanto = Math.min(dur - t, buffer.duration - de);
        src.start(t, de, quanto);
        t += quanto; primeira = false;
        if (trecho <= 0.05 && buffer.duration <= 0.05) break;
      }
      return ctx.startRendering().catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  /* Abre um arquivo de áudio do aparelho (mp3, m4a, wav, ogg…). */
  function lerArquivo(file) {
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC || !file) return Promise.reject(new Error('Este navegador não abre arquivos de música.'));
    if (file.size > 60 * 1024 * 1024) return Promise.reject(new Error('Arquivo grande demais (mais de 60 MB).'));
    return file.arrayBuffer().then(function (ab) {
      var ctx = new AC();
      return new Promise(function (ok, falha) {
        var feito = false;
        var r = ctx.decodeAudioData(ab, function (b) { if (!feito) { feito = true; ok(b); } }, function () { if (!feito) { feito = true; falha(new Error('Não foi possível ler essa música. Tente um MP3 ou M4A.')); } });
        if (r && r.then) r.then(function (b) { if (!feito) { feito = true; ok(b); } }, function () { if (!feito) { feito = true; falha(new Error('Não foi possível ler essa música. Tente um MP3 ou M4A.')); } });
      }).then(function (b) { try { ctx.close(); } catch (e) {} return b; }, function (e) { try { ctx.close(); } catch (x) {} throw e; });
    });
  }

  global.FIELDO = global.FIELDO || {};
  global.FIELDO.StudioTrilhas = { render: render, lista: LISTA, registrar: registrar, aparelho: aparelho, lerArquivo: lerArquivo,
    SAMPLE_RATE: SR, _nota: nota, _acorde: acorde, _linha: linha };
})(window);
