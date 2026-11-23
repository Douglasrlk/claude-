/* ════════════════════════════════════════════════════════════════
   FIELDO.Videos — vídeo curto no relatório de serviço  (v12.43)
   ════════════════════════════════════════════════════════════════
   Até 3 vídeos por relatório, até 30 s cada. O cliente assiste no
   relatório; o Studio usa o mesmo vídeo como cena.

   Tudo acontece no aparelho:
     ler(file)     duração e tamanho, sem subir nada;
     capa(v)       um quadro em JPEG, para a miniatura e o "poster";
     reduzir(v)    corta para 30 s e/ou diminui para 720p quando o
                   arquivo passa do limite do bucket (50 MB). Usa
                   MediaRecorder em tempo real: 30 s levam ~30 s;
     enviar(...)   sobe vídeo + capa para o bucket "videos", pasta do dono.

   O banco confere a forma (até 3, ≤ 30,5 s, URL válida); o tamanho é
   travado pelo bucket. A duração é medida aqui porque o servidor não
   abre o arquivo — quem burlar o aparelho só consegue um arquivo de até
   50 MB, o mesmo limite de qualquer upload.

   Depende de db.js (FIELDO.config, FIELDO.Auth.Session).
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var F = global.FIELDO;
  if (!F || !F.config) { if (global.console) console.error('[videos-servico.js] carregue db.js antes.'); return; }

  var LIMITE_S = 30, MAX_POR_RELATORIO = 3, MAX_BYTES = 50 * 1024 * 1024, ALVO_BYTES = 45 * 1024 * 1024;
  var BUCKET = 'videos';

  function erro(msg, code) { var e = new Error(msg); e.code = code || 'video'; return e; }

  /* Lê duração e dimensões. Não decodifica o vídeo inteiro. */
  function ler(file) {
    return new Promise(function (ok, falha) {
      if (!file || !/^video\//.test(file.type || '') && !/\.(mp4|mov|m4v|webm|3gp)$/i.test(file.name || '')) {
        return falha(erro('Esse arquivo não é um vídeo.', 'nao_e_video'));
      }
      var url = URL.createObjectURL(file), v = document.createElement('video'), feito = false;
      v.preload = 'metadata'; v.muted = true; v.playsInline = true;
      var tm = setTimeout(function () { fim(erro('Não foi possível abrir esse vídeo neste aparelho.', 'nao_abriu')); }, 15000);
      function fim(e, r) {
        if (feito) return; feito = true; clearTimeout(tm);
        if (e) { URL.revokeObjectURL(url); falha(e); } else ok(r);
      }
      v.onloadedmetadata = function () {
        var d = v.duration;
        /* alguns WebM gravados no celular vêm com duração "Infinity" até tocar até o fim */
        if (!isFinite(d)) {
          v.currentTime = 1e7;
          v.ontimeupdate = function () { v.ontimeupdate = null; d = v.duration; v.currentTime = 0; pronto(d); };
          return;
        }
        pronto(d);
      };
      function pronto(d) {
        fim(null, { file: file, url: url, duracao: Math.round(d * 100) / 100, w: v.videoWidth || null, h: v.videoHeight || null, bytes: file.size || 0 });
      }
      v.onerror = function () { fim(erro('Não foi possível abrir esse vídeo neste aparelho. Tente gravar de novo pela câmera.', 'nao_abriu')); };
      v.src = url;
    });
  }

  function precisaReduzir(v) { return v.duracao > LIMITE_S + 0.4 || v.bytes > ALVO_BYTES; }

  function esperar(el, ev, ms) {
    return new Promise(function (ok, falha) {
      var t = setTimeout(function () { el.removeEventListener(ev, h); falha(erro('tempo_esgotado')); }, ms || 8000);
      function h() { clearTimeout(t); el.removeEventListener(ev, h); ok(); }
      el.addEventListener(ev, h);
    });
  }

  /* Um quadro do vídeo em JPEG (lado maior 720 px). */
  function capa(v, em) {
    var el = document.createElement('video');
    el.muted = true; el.playsInline = true; el.preload = 'auto'; el.src = v.url;
    return esperar(el, 'loadeddata', 12000).then(function () {
      el.currentTime = Math.min(v.duracao / 2, em == null ? 0.6 : em);
      return esperar(el, 'seeked', 8000);
    }).then(function () {
      var w = el.videoWidth, h = el.videoHeight, s = Math.min(1, 720 / Math.max(w, h));
      var c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
      c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
      return new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', 0.82); });
    }).then(function (b) { el.removeAttribute('src'); el.load(); return b; });
  }

  function mimeGravacao() {
    if (!global.MediaRecorder) return null;
    var tipos = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (var i = 0; i < tipos.length; i++) { try { if (MediaRecorder.isTypeSupported(tipos[i])) return tipos[i]; } catch (e) {} }
    return null;
  }

  function podeReduzir() { return !!(mimeGravacao() && HTMLCanvasElement.prototype.captureStream); }

  /**
   * Regrava um trecho de até 30 s em 720p. Tempo real.
   * opts = { inicio (s), onProgresso(0..1), sinal {cancelado}, actx (AudioContext criado no toque) }
   * Promise<{ blob, duracao, w, h, mime }>
   */
  function reduzir(v, opts) {
    opts = opts || {};
    var mime = mimeGravacao();
    if (!mime || !HTMLCanvasElement.prototype.captureStream) return Promise.reject(erro('Este navegador não consegue cortar vídeo. Corte para até 30 s na galeria do celular e envie de novo.', 'sem_gravador'));
    var inicio = Math.max(0, Math.min(Number(opts.inicio) || 0, Math.max(0, v.duracao - 1)));
    var dur = Math.min(LIMITE_S, v.duracao - inicio);
    var el = document.createElement('video');
    el.playsInline = true; el.preload = 'auto'; el.src = v.url; el.muted = false; el.volume = 1;
    var actx = opts.actx || null, pedacos = [], raf = 0, rec = null, stream = null;
    function limpar() {
      cancelAnimationFrame(raf);
      try { el.pause(); } catch (e) {}
      try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      el.removeAttribute('src'); try { el.load(); } catch (e) {}
    }
    return esperar(el, 'loadedmetadata', 12000).then(function () {
      var w = el.videoWidth, h = el.videoHeight, s = Math.min(1, 1280 / Math.max(w, h));
      var cw = Math.round(w * s / 2) * 2, ch = Math.round(h * s / 2) * 2;
      var c = document.createElement('canvas'); c.width = cw; c.height = ch;
      var ctx = c.getContext('2d', { alpha: false });
      stream = c.captureStream(30);
      try {
        if (actx) {
          var src = actx.createMediaElementSource(el), dest = actx.createMediaStreamDestination();
          src.connect(dest);   /* não vai para o alto-falante: só para o arquivo */
          dest.stream.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
        }
      } catch (e) { /* sem áudio: o vídeo sai mudo, mas sai */ }
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3000000, audioBitsPerSecond: 128000 });
      rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) pedacos.push(ev.data); };
      el.currentTime = inicio;
      return esperar(el, 'seeked', 8000).then(function () {
        return new Promise(function (ok, falha) {
          rec.onstop = function () {
            limpar();
            if (opts.sinal && opts.sinal.cancelado) return falha(erro('cancelado', 'cancelado'));
            var tipo = mime.split(';')[0];
            ok({ blob: new Blob(pedacos, { type: tipo }), duracao: Math.round(dur * 100) / 100, w: cw, h: ch, mime: tipo });
          };
          rec.onerror = function (ev) { limpar(); falha(ev.error || erro('Falha ao regravar o vídeo.')); };
          function quadro() {
            var t = el.currentTime - inicio;
            ctx.drawImage(el, 0, 0, cw, ch);
            if (opts.onProgresso) opts.onProgresso(Math.min(1, t / dur));
            if ((opts.sinal && opts.sinal.cancelado) || t >= dur || el.ended) { try { rec.stop(); } catch (e) {} return; }
            raf = requestAnimationFrame(quadro);
          }
          rec.start(500);
          var p = el.play();
          (p && p.then ? p : Promise.resolve()).then(function () { raf = requestAnimationFrame(quadro); }, function (e) {
            limpar(); falha(erro('O navegador não deixou tocar o vídeo para cortar. Toque em "Cortar" de novo.', 'autoplay'));
          });
        });
      });
    });
  }

  function aleatorio() {
    var b = new Uint8Array(8); (global.crypto || global.msCrypto).getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  function subir(caminho, blob, tipo) {
    var cfg = F.config;
    return F.Auth.Session.getAccessToken().then(function (token) {
      if (!token) throw erro('Sua sessão expirou. Entre de novo.', 'sessao');
      return fetch(cfg.STORAGE_URL + '/' + BUCKET + '/' + caminho, {
        method: 'POST',
        headers: { apikey: cfg.ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': tipo, 'x-upsert': 'false' },
        body: blob
      });
    }).then(function (r) {
      if (r.status === 413) throw erro('O vídeo passou de 50 MB. Corte ou grave em qualidade menor.', 'grande');
      if (!r.ok) throw erro('O vídeo não subiu (' + r.status + '). Tente de novo com internet melhor.', 'upload');
      return cfg.SUPABASE_URL + '/storage/v1/object/public/' + BUCKET + '/' + caminho;
    });
  }

  function extensao(tipo, nome) {
    if (/webm/.test(tipo)) return 'webm';
    if (/quicktime/.test(tipo) || /\.mov$/i.test(nome || '')) return 'mov';
    return 'mp4';
  }

  /**
   * Sobe os vídeos de um relatório. itens = [{ blob|file, duracao, w, h, capaBlob }]
   * Promise<[{url, duracao, capa, w, h}]> na mesma ordem (falha = exceção).
   */
  function enviar(itens, reportId, onProgresso) {
    var uid = F.Auth.getId();
    if (!uid) return Promise.reject(erro('Sua sessão expirou. Entre de novo.', 'sessao'));
    var feitos = 0, total = itens.length;
    return itens.reduce(function (p, it) {
      return p.then(function (lista) {
        var blob = it.blob || it.file, tipo = blob.type || 'video/mp4', base = uid + '/' + reportId + '/' + aleatorio();
        if (blob.size > MAX_BYTES) throw erro('O vídeo passou de 50 MB. Corte ou grave em qualidade menor.', 'grande');
        return subir(base + '.' + extensao(tipo, blob.name), blob, tipo).then(function (url) {
          return (it.capaBlob ? subir(base + '.jpg', it.capaBlob, 'image/jpeg').catch(function () { return null; }) : Promise.resolve(null))
            .then(function (capaUrl) {
              feitos++; if (onProgresso) onProgresso(feitos, total);
              return lista.concat([{ url: url, duracao: Math.min(LIMITE_S, Math.round(it.duracao * 100) / 100), capa: capaUrl,
                w: it.w || null, h: it.h || null }]);
            });
        });
      });
    }, Promise.resolve([]));
  }

  /* Remove do bucket arquivos de um vídeo que saiu do relatório. Melhor esforço. */
  function apagar(item) {
    var cfg = F.config, re = new RegExp('/storage/v1/object/public/' + BUCKET + '/([^?#]+)');
    var paths = [item && item.url, item && item.capa].map(function (u) { var m = re.exec(String(u || '')); return m && m[1]; }).filter(Boolean);
    if (!paths.length) return Promise.resolve();
    return F.Auth.Session.getAccessToken().then(function (token) {
      return fetch(cfg.STORAGE_URL + '/' + BUCKET, { method: 'DELETE',
        headers: { apikey: cfg.ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }) });
    }).catch(function () {});
  }

  function mmss(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  F.Videos = {
    LIMITE_S: LIMITE_S, MAX_POR_RELATORIO: MAX_POR_RELATORIO, MAX_BYTES: MAX_BYTES,
    ler: ler, capa: capa, precisaReduzir: precisaReduzir, podeReduzir: podeReduzir, reduzir: reduzir,
    enviar: enviar, apagar: apagar, mmss: mmss
  };
})(window);
