/* ════════════════════════════════════════════════════════════════
   FIELDO.StudioExport — grava o vídeo do Studio no aparelho  (v12.41)
   ════════════════════════════════════════════════════════════════
   Três caminhos, do melhor para o de socorro, escolhidos pelo que o
   navegador REALMENTE suporta (perguntado na hora, não por user-agent):

   1. WebCodecs + MP4 (Chrome/Android, Edge, Safari 16.4+)
      Quadro a quadro, fora do tempo real: 30 fps exatos, H.264, áudio
      AAC (ou Opus onde não há AAC). Mais rápido que o tempo real em
      celular com codificador de hardware, e um quadro lento não vira
      tropeço no vídeo. É o formato que WhatsApp, Instagram e TikTok
      aceitam sem conversão.
   2. MediaRecorder (navegador sem WebCodecs)
      Grava a tela do vídeo tocando, em tempo real. MP4 onde existe,
      WebM nos demais. Pede a tela aberta enquanto grava.
   3. Carrossel (nenhum dos dois)
      Uma imagem por cena, para postar como sequência de fotos.

   Se o caminho 1 falhar no meio (codificador recusou, memória), o 2 é
   tentado sozinho. Cancelar para tudo e libera o codificador.

   Depende de vendor/mp4-muxer (MIT) só no caminho 1.

   v12.43 · com clipe de vídeo na linha do tempo, cada quadro espera o
   <video> chegar no instante exato (linha.quadroExato) antes de desenhar.
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var M = function () { return global.FIELDO.StudioMotor; };
  var BITRATE_VIDEO = 7000000, BITRATE_AUDIO = 128000;
  var CODECS_H264 = ['avc1.640028', 'avc1.4d0028', 'avc1.420028'];

  function cancelado() { var e = new Error('cancelado'); e.code = 'cancelado'; return e; }

  /* cede a vez à tela sem o atraso mínimo de 4 ms do setTimeout */
  var _mc = null, _filaMc = [];
  function ceder() {
    if (!global.MessageChannel) return new Promise(function (ok) { setTimeout(ok, 0); });
    if (!_mc) { _mc = new MessageChannel(); _mc.port1.onmessage = function () { var f = _filaMc.shift(); if (f) f(); }; }
    return new Promise(function (ok) { _filaMc.push(ok); _mc.port2.postMessage(0); });
  }

  function tela(W, H, anexar) {
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    if (anexar) {
      /* Safari só captura canvas que está no documento */
      c.setAttribute('aria-hidden', 'true');
      c.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;pointer-events:none;';
      document.body.appendChild(c);
    }
    return c;
  }

  var _caps = null;
  /** O que este aparelho consegue gravar. Cacheado na sessão. */
  function capacidades() {
    if (_caps) return _caps;
    var mot = M(), W = mot.W, H = mot.H, FPS = mot.FPS;
    _caps = (async function () {
      var r = { caminho: 'carrossel', formato: 'carrossel', mime: 'image/jpeg', codec: null, audio: null };
      if (global.VideoEncoder && global.VideoFrame && global.Mp4Muxer) {
        for (var i = 0; i < CODECS_H264.length && !r.codec; i++) {
          try {
            var s = await VideoEncoder.isConfigSupported({ codec: CODECS_H264[i], width: W, height: H, bitrate: BITRATE_VIDEO, framerate: FPS });
            if (s && s.supported) r.codec = CODECS_H264[i];
          } catch (e) {}
        }
        if (r.codec) {
          r.caminho = 'webcodecs'; r.formato = 'mp4'; r.mime = 'video/mp4';
          if (global.AudioEncoder && global.AudioData) {
            var tenta = [['aac', 'mp4a.40.2'], ['opus', 'opus']];
            for (var k = 0; k < tenta.length && !r.audio; k++) {
              try {
                var a = await AudioEncoder.isConfigSupported({ codec: tenta[k][1], sampleRate: 48000, numberOfChannels: 2, bitrate: BITRATE_AUDIO });
                if (a && a.supported) r.audio = { muxer: tenta[k][0], codec: tenta[k][1] };
              } catch (e) {}
            }
          }
        }
      }
      r.gravador = gravadorDisponivel();
      if (r.caminho === 'carrossel' && r.gravador) {
        r.caminho = 'mediarecorder'; r.formato = r.gravador.formato; r.mime = r.gravador.mime;
      }
      return r;
    })();
    return _caps;
  }

  function gravadorDisponivel() {
    if (!global.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
    var tipos = [
      ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'], ['video/mp4;codecs=avc1,mp4a', 'mp4'], ['video/mp4', 'mp4'],
      ['video/webm;codecs=vp9,opus', 'webm'], ['video/webm;codecs=vp8,opus', 'webm'], ['video/webm', 'webm']
    ];
    for (var i = 0; i < tipos.length; i++) {
      try { if (MediaRecorder.isTypeSupported(tipos[i][0])) return { mime: tipos[i][0], formato: tipos[i][1] }; } catch (e) {}
    }
    return null;
  }

  /* ── caminho 1: WebCodecs ─────────────────────────────────────── */
  async function viaWebCodecs(linha, audio, caps, onProgresso, sinal) {
    var mot = M(), W = mot.W, H = mot.H, FPS = mot.FPS;
    var usarAudio = !!(audio && caps.audio);
    var alvo = new Mp4Muxer.ArrayBufferTarget();
    var muxer = new Mp4Muxer.Muxer({
      target: alvo,
      video: { codec: 'avc', width: W, height: H, frameRate: FPS },
      audio: usarAudio ? { codec: caps.audio.muxer, numberOfChannels: 2, sampleRate: audio.sampleRate } : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset'
    });
    var erro = null;
    var venc = new VideoEncoder({
      output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); },
      error: function (e) { erro = e; }
    });
    venc.configure({ codec: caps.codec, width: W, height: H, bitrate: BITRATE_VIDEO, framerate: FPS, latencyMode: 'quality' });
    var aenc = null;
    try {
      var c = tela(W, H, false), ctx = c.getContext('2d', { alpha: false });
      var total = Math.round(linha.duracao * FPS), passo = 1e6 / FPS;
      for (var i = 0; i < total; i++) {
        if (sinal && sinal.cancelado) throw cancelado();
        if (erro) throw erro;
        /* clipe de vídeo na cena: espera o <video> chegar no instante exato */
        var pq = linha.quadroExato ? linha.quadroExato(i / FPS) : null;
        if (pq) await pq;
        linha.desenhar(ctx, i / FPS);
        var q = new VideoFrame(c, { timestamp: Math.round(i * passo), duration: Math.round(passo) });
        venc.encode(q, { keyFrame: i % (FPS * 2) === 0 });
        q.close();
        while (venc.encodeQueueSize > 4) { await new Promise(function (ok) { setTimeout(ok, 4); }); if (erro) throw erro; }
        if (onProgresso) onProgresso(0.04 + 0.88 * (i + 1) / total, 'video');
        if (i % 2 === 1) await ceder();
      }
      await venc.flush();
      if (erro) throw erro;

      if (usarAudio) {
        aenc = new AudioEncoder({
          output: function (chunk, meta) { muxer.addAudioChunk(chunk, meta); },
          error: function (e) { erro = e; }
        });
        aenc.configure({ codec: caps.audio.codec, sampleRate: audio.sampleRate, numberOfChannels: 2, bitrate: BITRATE_AUDIO });
        var sr = audio.sampleRate, n = Math.min(audio.length, Math.round(linha.duracao * sr)), BLOCO = 4800;
        var L = audio.getChannelData(0), R = audio.numberOfChannels > 1 ? audio.getChannelData(1) : L;
        for (var off = 0; off < n; off += BLOCO) {
          if (sinal && sinal.cancelado) throw cancelado();
          var m = Math.min(BLOCO, n - off), dados = new Float32Array(m * 2);
          dados.set(L.subarray(off, off + m), 0); dados.set(R.subarray(off, off + m), m);
          var ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: m, numberOfChannels: 2, timestamp: Math.round(off / sr * 1e6), data: dados });
          aenc.encode(ad); ad.close();
          if (erro) throw erro;
        }
        await aenc.flush();
        if (erro) throw erro;
        if (onProgresso) onProgresso(0.97, 'audio');
      }
      muxer.finalize();
      return { blob: new Blob([alvo.buffer], { type: 'video/mp4' }), formato: 'mp4', mime: 'video/mp4', caminho: 'webcodecs', audio: usarAudio ? caps.audio.muxer : null };
    } finally {
      try { if (venc.state !== 'closed') venc.close(); } catch (e) {}
      try { if (aenc && aenc.state !== 'closed') aenc.close(); } catch (e) {}
    }
  }

  /* ── caminho 2: MediaRecorder (tempo real) ────────────────────── */
  function viaGravador(linha, audio, gravador, onProgresso, sinal) {
    var mot = M(), W = mot.W, H = mot.H, FPS = mot.FPS;
    return new Promise(function (resolver, rejeitar) {
      var c = tela(W, H, true), ctx = c.getContext('2d', { alpha: false });
      linha.desenhar(ctx, 0);
      var stream = c.captureStream(FPS), actx = null, fonte = null, pedacos = [], acabou = false, raf = 0;
      function limpar() {
        cancelAnimationFrame(raf);
        try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        try { if (fonte) fonte.stop(); } catch (e) {}
        try { if (actx) actx.close(); } catch (e) {}
        if (c.parentNode) c.parentNode.removeChild(c);
      }
      try {
        if (audio) {
          var AC = global.AudioContext || global.webkitAudioContext;
          actx = new AC({ sampleRate: audio.sampleRate });
          var dest = actx.createMediaStreamDestination();
          fonte = actx.createBufferSource(); fonte.buffer = audio; fonte.connect(dest);
          dest.stream.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
        }
        var rec = new MediaRecorder(stream, { mimeType: gravador.mime, videoBitsPerSecond: BITRATE_VIDEO, audioBitsPerSecond: BITRATE_AUDIO });
      } catch (e) { limpar(); return rejeitar(e); }
      rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) pedacos.push(ev.data); };
      rec.onerror = function (ev) { if (acabou) return; acabou = true; limpar(); rejeitar(ev.error || new Error('gravador')); };
      rec.onstop = function () {
        limpar();
        if (sinal && sinal.cancelado) return rejeitar(cancelado());
        var tipo = gravador.mime.split(';')[0];
        resolver({ blob: new Blob(pedacos, { type: tipo }), formato: gravador.formato, mime: tipo, caminho: 'mediarecorder', audio: audio ? 'sim' : null });
      };
      var inicio = 0;
      function quadro() {
        var agora = actx ? actx.currentTime : performance.now() / 1000;
        var t = agora - inicio;
        if (sinal && sinal.cancelado) { acabou = true; try { rec.stop(); } catch (e) {} return; }
        if (t >= linha.duracao) { if (linha.pararVideos) linha.pararVideos(); linha.desenhar(ctx, linha.duracao); acabou = true; setTimeout(function () { try { rec.stop(); } catch (e) {} }, 120); return; }
        if (linha.sincronizar) linha.sincronizar(t, true);
        linha.desenhar(ctx, t);
        if (onProgresso) onProgresso(0.04 + 0.92 * t / linha.duracao, 'tempo-real');
        raf = requestAnimationFrame(quadro);
      }
      var comecar = function () {
        rec.start(250);
        inicio = actx ? actx.currentTime : performance.now() / 1000;
        if (fonte) fonte.start(actx.currentTime);
        raf = requestAnimationFrame(quadro);
      };
      if (actx && actx.state === 'suspended') actx.resume().then(comecar, comecar); else comecar();
    });
  }

  /* ── caminho 3: carrossel ─────────────────────────────────────── */
  async function carrossel(linha, onProgresso) {
    var mot = M(), c = tela(mot.W, mot.H, false), ctx = c.getContext('2d', { alpha: false });
    var tempos = linha.quadrosChave(), out = [];
    for (var i = 0; i < tempos.length; i++) {
      var pq = linha.quadroExato ? linha.quadroExato(tempos[i]) : null;
      if (pq) await pq;
      linha.desenhar(ctx, tempos[i]);
      out.push(await new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', 0.92); }));
      if (onProgresso) onProgresso((i + 1) / tempos.length, 'carrossel');
      await ceder();
    }
    return out;
  }

  /**
   * Grava. opts = { linha (de StudioMotor.montar), audio (AudioBuffer|null),
   *                 onProgresso(p 0..1, fase), sinal {cancelado}, forcar ('mediarecorder'|'carrossel') }
   * Promise<{ blob | imagens[], formato, mime, caminho, ms }>
   */
  async function exportar(opts) {
    var t0 = performance.now(), caps = await capacidades();
    var linha = opts.linha, audio = opts.audio || null, prog = opts.onProgresso, sinal = opts.sinal || {};
    var caminho = opts.forcar || caps.caminho;
    if (prog) prog(0.02, 'preparando');

    if (caminho === 'webcodecs') {
      /* sem AAC/Opus por WebCodecs e com música: o gravador leva o som */
      if (audio && !caps.audio && caps.gravador) caminho = 'mediarecorder';
      else {
        try {
          var r = await viaWebCodecs(linha, audio, caps, prog, sinal);
          r.ms = Math.round(performance.now() - t0); return r;
        } catch (e) {
          if (e && e.code === 'cancelado') throw e;
          if (!caps.gravador) { caminho = 'carrossel'; }
          else caminho = 'mediarecorder';
          if (global.console) console.warn('[Studio] WebCodecs falhou, tentando o gravador:', e && e.message);
        }
      }
    }
    if (caminho === 'mediarecorder' && caps.gravador) {
      var g = await viaGravador(linha, audio, caps.gravador, prog, sinal);
      g.ms = Math.round(performance.now() - t0); return g;
    }
    var imgs = await carrossel(linha, prog);
    return { imagens: imgs, formato: 'carrossel', mime: 'image/jpeg', caminho: 'carrossel', ms: Math.round(performance.now() - t0) };
  }

  global.FIELDO = global.FIELDO || {};
  global.FIELDO.StudioExport = { capacidades: capacidades, exportar: exportar, carrossel: carrossel, _reset: function () { _caps = null; } };
})(window);
