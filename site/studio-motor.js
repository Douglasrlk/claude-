/* ════════════════════════════════════════════════════════════════
   FIELDO.StudioMotor — o vídeo do Fieldo Studio  (v12.41)
   ════════════════════════════════════════════════════════════════
   Monta e desenha o vídeo vertical 1080×1920 de um serviço concluído:
   abertura, antes e depois, detalhes, avaliação do cliente e fechamento
   com QR do perfil. Tudo em Canvas 2D, no aparelho do profissional.

   O desenho é uma FUNÇÃO DO TEMPO: desenhar(ctx, t) pinta o quadro do
   instante t, sem estado. Por isso a prévia (ao vivo, em resolução
   menor) e a exportação (quadro a quadro, em 1080×1920) saem
   idênticas, e um quadro lento nunca atrasa o vídeo final.

   Três modelos:
     classico  — foto sangrando, gradiente escuro, dourado do Fieldo (todos)
     impacto   — cortes rápidos, tipografia forte, cor de destaque (Pro)
     editorial — papel claro, fotos em moldura, serifa (Pro)

   Zonas seguras: Reels, Status e TikTok cobrem ~220 px no topo, ~380 px
   na base e ~140 px à direita com botões. Todo texto importante fica
   entre y=240 e y=1560 e longe da borda direita.

   v12.43 · Studio v2:
     · cena de VÍDEO (clipe do relatório, até 30 s): corte, velocidade;
       na prévia o <video> toca sincronizado; na exportação cada quadro
       espera o vídeo chegar no instante exato (quadroExato);
     · linha do tempo editável: ordem, duração, texto e transição por cena;
     · filtros de cor e 8 transições;
     · encerramentos: cartão, WhatsApp, contato, logo ou nenhum — com o
       link e o QR do perfil opcionais.

   Depende de qrcode_min.js (já existe no projeto). Não toca em db.js.
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var W = 1080, H = 1920, FPS = 30;
  var PAD = 84, MAXW = W - PAD - 150;

  var COR = {
    papel: '#f5f2ec', papel2: '#ede9df', tinta: '#0e0e14', tinta2: '#1e1e28',
    ouro: '#d4ab40', ouroL: '#b8880d', ouroD: '#9a7218', texto: '#1a1a24'
  };

  var MODELOS = {
    classico:  { id: 'classico',  nome: 'Clássico',  descricao: 'Foto em tela cheia e o dourado do Fieldo', pro: false, claro: false, forte: false, ritmo: 1,    tr: 0.5 },
    impacto:   { id: 'impacto',   nome: 'Impacto',   descricao: 'Cortes rápidos e letras fortes',            pro: true,  claro: false, forte: true,  ritmo: 0.8,  tr: 0.3 },
    editorial: { id: 'editorial', nome: 'Editorial', descricao: 'Papel claro e fotos em moldura',            pro: true,  claro: true,  forte: false, ritmo: 1.08, tr: 0.6 }
  };

  var MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

  /* ── utilidades ───────────────────────────────────────────────── */
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function eo(x) { x = clamp01(x); return 1 - Math.pow(1 - x, 3); }
  function eio(x) { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function eback(x) { x = clamp01(x); var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  function lerp(a, b, x) { return a + (b - a) * x; }
  function entra(lt, ini, d) { return eo((lt - ini) / (d || 0.7)); }

  function limpa(s, max) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
    return max && s.length > max ? s.slice(0, max - 1).trim() + '…' : s;
  }

  function hexRgba(hex, a) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 'rgba(212,171,64,' + a + ')';
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  var _medidor = null;
  function medidor() {
    if (!_medidor) _medidor = document.createElement('canvas').getContext('2d');
    return _medidor;
  }

  function temLetterSpacing(ctx) { return 'letterSpacing' in ctx; }
  function espacar(ctx, px) {
    if (temLetterSpacing(ctx)) { ctx.letterSpacing = px + 'px'; return function (s) { return s; }; }
    return function (s) { return String(s).split('').join(' '); };
  }
  function semEspaco(ctx) { if (temLetterSpacing(ctx)) ctx.letterSpacing = '0px'; }

  /* quebra em linhas pela largura real da fonte */
  function quebrar(font, texto, maxW, maxLinhas) {
    var c = medidor(); c.font = font;
    var palavras = limpa(texto).split(' '), linhas = [], atual = '';
    for (var i = 0; i < palavras.length; i++) {
      var tenta = atual ? atual + ' ' + palavras[i] : palavras[i];
      if (c.measureText(tenta).width <= maxW || !atual) { atual = tenta; }
      else { linhas.push(atual); atual = palavras[i]; }
    }
    if (atual) linhas.push(atual);
    if (linhas.length > maxLinhas) {
      linhas = linhas.slice(0, maxLinhas);
      var u = linhas[maxLinhas - 1];
      while (u.length > 1 && c.measureText(u + '…').width > maxW) u = u.slice(0, -1);
      linhas[maxLinhas - 1] = u.replace(/[\s,.;:–-]+$/, '') + '…';
    }
    /* palavra única maior que a linha: reduz por corte, nunca vaza */
    return linhas.map(function (l) {
      while (l.length > 1 && c.measureText(l).width > maxW) l = l.slice(0, -2) + '…';
      return l;
    });
  }

  /* maior tamanho em que o texto cabe inteiro nas linhas permitidas */
  function ajustar(molde, textoS, maxW, maxLinhas, tamanhos) {
    for (var i = 0; i < tamanhos.length; i++) {
      var f = molde.replace('{t}', tamanhos[i]), l = quebrar(f, textoS, maxW, 99);
      if (l.length <= maxLinhas) return { tam: tamanhos[i], font: f, linhas: l };
    }
    var t = tamanhos[tamanhos.length - 1], ff = molde.replace('{t}', t);
    return { tam: t, font: ff, linhas: quebrar(ff, textoS, maxW, maxLinhas) };
  }

  function texto(ctx, s, x, y, font, cor, alpha, dy, align) {
    if (alpha <= 0.001 || !s) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = font; ctx.fillStyle = cor;
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y + (dy || 0));
    ctx.restore();
  }

  function retArred(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* símbolo oficial ("o lote aberto"), o mesmo de share-card.js */
  function marcaFieldo(ctx, x, y, s, cor, alpha) {
    var k = s / 24, r = 5 * k;
    function px(v) { return x + v * k; } function py(v) { return y + v * k; }
    ctx.save(); ctx.globalAlpha *= (alpha == null ? 1 : alpha);
    ctx.strokeStyle = cor || '#fff'; ctx.lineWidth = 2 * k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(px(14.6), py(4)); ctx.lineTo(px(15), py(4));
    ctx.arcTo(px(20), py(4), px(20), py(9), r); ctx.lineTo(px(20), py(15));
    ctx.arcTo(px(20), py(20), px(15), py(20), r); ctx.lineTo(px(9), py(20));
    ctx.arcTo(px(4), py(20), px(4), py(15), r); ctx.lineTo(px(4), py(9));
    ctx.arcTo(px(4), py(4), px(9), py(4), r); ctx.stroke();
    ctx.fillStyle = COR.ouro; ctx.beginPath(); ctx.arc(px(11.8), py(4), 1.2 * k, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function estrela(ctx, cx, cy, r) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  /* ── fotos ────────────────────────────────────────────────────── */

  /* Uma foto "retrato" ocupa a tela inteira. Uma deitada (ou quadrada)
     cortada para 9:16 perderia 2/3 da imagem — então ela entra inteira,
     numa moldura, sobre a própria foto desfocada. */
  function ehRetrato(w, h) { return h / w >= 1.18; }

  function carregarUma(url, timeoutMs) {
    var ctl = global.AbortController ? new AbortController() : null;
    var tm = setTimeout(function () { if (ctl) ctl.abort(); }, timeoutMs || 20000);
    return fetch(url, { mode: 'cors', credentials: 'omit', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('http_' + r.status); return r.blob(); })
      .then(function (blob) {
        clearTimeout(tm);
        if (!/^image\//.test(blob.type || 'image/jpeg') && blob.type) throw new Error('nao_e_imagem');
        return decodificar(blob);
      }, function (e) { clearTimeout(tm); throw e; });
  }

  function decodificar(blob) {
    if (global.createImageBitmap) {
      return createImageBitmap(blob).catch(function () { return viaImg(blob); });
    }
    return viaImg(blob);
  }
  function viaImg(blob) {
    return new Promise(function (ok, falha) {
      var u = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { URL.revokeObjectURL(u); ok(img); };
      img.onerror = function () { URL.revokeObjectURL(u); falha(new Error('decodificacao')); };
      img.src = u;
    });
  }

  function canvas(w, h) {
    var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c;
  }

  /* reduz para o necessário: cobrir 1080×1920 com zoom de até 1,18,
     ou caber na moldura. Foto de 12 MP vira ~3 MB de memória, não 48. */
  function preparar(url, src) {
    var w = src.width, h = src.height, retrato = ehRetrato(w, h);
    var s = retrato ? Math.max(1274 / w, 2266 / h) : Math.max(1320 / w, 1100 / h);
    s = Math.min(1, s);
    var c = canvas(w * s, h * s), g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
    if (src.close) try { src.close(); } catch (e) {}

    /* fundo desfocado: redução em dois passos + ampliação suave */
    var m1 = canvas(108, 192), g1 = m1.getContext('2d');
    capaEm(g1, c, 0, 0, 108, 192, 1, 0, 0);
    var m2 = canvas(27, 48), g2 = m2.getContext('2d');
    g2.imageSmoothingQuality = 'high'; g2.drawImage(m1, 0, 0, 27, 48);
    var fundo = canvas(270, 480), gf = fundo.getContext('2d');
    gf.imageSmoothingEnabled = true; gf.imageSmoothingQuality = 'high'; gf.drawImage(m2, 0, 0, 270, 480);

    return { url: url, img: c, w: c.width, h: c.height, retrato: retrato, fundo: fundo, nota: notaFoto(c) };
  }

  /* Triagem local, sem IA: nitidez (variância do laplaciano), contraste
     e exposição numa miniatura de 64 px. Serve para escolher a capa e a
     ordem dos detalhes; não decide sozinha o que entra no vídeo. */
  function notaFoto(c) {
    try {
      var n = 64, m = canvas(n, n), g = m.getContext('2d', { willReadFrequently: true });
      g.drawImage(c, 0, 0, n, n);
      var d = g.getImageData(0, 0, n, n).data, L = new Float32Array(n * n), soma = 0;
      for (var i = 0; i < n * n; i++) { L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; soma += L[i]; }
      var media = soma / (n * n), v = 0, lap = 0, lapS = 0, cont = 0;
      for (i = 0; i < n * n; i++) v += (L[i] - media) * (L[i] - media);
      for (var y = 1; y < n - 1; y++) for (var x = 1; x < n - 1; x++) {
        var k = y * n + x, l = 4 * L[k] - L[k - 1] - L[k + 1] - L[k - n] - L[k + n];
        lap += l; lapS += l * l; cont++;
      }
      var lapVar = lapS / cont - Math.pow(lap / cont, 2), desvio = Math.sqrt(v / (n * n));
      var exposicao = 1 - Math.min(1, Math.abs(media - 128) / 128);
      return Math.log(1 + lapVar) * 1.0 + desvio / 32 + exposicao * 1.5;
    } catch (e) { return 0; }   /* canvas contaminado (CORS): sem nota, mantém a ordem */
  }

  /* Carrega todas as fotos do roteiro em paralelo (3 de cada vez). */
  function prepararFotos(urls, onProgresso) {
    var lista = urls.filter(function (u, i) { return u && urls.indexOf(u) === i; });
    var res = {}, falhas = [], feitas = 0, fila = lista.slice();
    function proxima() {
      var u = fila.shift();
      if (!u) return Promise.resolve();
      return carregarUma(u).then(function (src) { res[u] = preparar(u, src); }, function () { falhas.push(u); })
        .then(function () { feitas++; if (onProgresso) onProgresso(feitas, lista.length); return proxima(); });
    }
    return Promise.all([proxima(), proxima(), proxima()]).then(function () { return { fotos: res, falhas: falhas }; });
  }

  /* filtro de cor ativo (Studio v2): vale para foto e vídeo, nunca para texto */
  var FILTROS = {
    nenhum: '', vivo: 'saturate(1.35) contrast(1.08)', quente: 'sepia(0.22) saturate(1.25) hue-rotate(-6deg)',
    frio: 'saturate(1.05) hue-rotate(10deg) brightness(1.03)', pb: 'grayscale(1) contrast(1.12)',
    cinema: 'contrast(1.16) saturate(0.82) brightness(0.95)', suave: 'brightness(1.06) contrast(0.92) saturate(0.9)'
  };
  var FILTRO_ATIVO = '';

  function dimensoes(img) {
    return { w: img.videoWidth || img.width, h: img.videoHeight || img.height };
  }

  /* ── vídeos (clipes do relatório, Studio v2) ─────────────────────
     Um <video> por clipe, mudo (o som do clipe entra na mixagem de
     studio-audio.js), com crossOrigin: sem isso o canvas fica
     "contaminado" e a exportação não consegue ler os quadros. */
  function esperarEvento(el, ev, ms) {
    return new Promise(function (ok, falha) {
      var t = setTimeout(function () { el.removeEventListener(ev, h); falha(new Error('tempo_' + ev)); }, ms || 10000);
      function h() { clearTimeout(t); el.removeEventListener(ev, h); ok(); }
      el.addEventListener(ev, h);
    });
  }

  function prepararVideo(item) {
    var el = document.createElement('video');
    el.crossOrigin = 'anonymous'; el.muted = true; el.defaultMuted = true; el.playsInline = true; el.preload = 'auto';
    el.setAttribute('playsinline', ''); el.setAttribute('muted', '');
    var p = esperarEvento(el, 'loadeddata', 25000);
    el.src = item.url;
    return p.then(function () {
      el.currentTime = Math.min(0.4, (el.duration || 1) / 2);
      return esperarEvento(el, 'seeked', 8000).catch(function () {});
    }).then(function () {
      var w = el.videoWidth, h = el.videoHeight;
      if (!w || !h) throw new Error('video_sem_imagem');
      var sc = Math.min(1, 720 / Math.max(w, h)), snap = canvas(w * sc, h * sc);
      snap.getContext('2d').drawImage(el, 0, 0, snap.width, snap.height);
      var m1 = canvas(108, 192), g1 = m1.getContext('2d');
      capaEm(g1, snap, 0, 0, 108, 192, 1, 0, 0);
      var m2 = canvas(27, 48), g2 = m2.getContext('2d'); g2.drawImage(m1, 0, 0, 27, 48);
      var fundo = canvas(270, 480), gf = fundo.getContext('2d'); gf.imageSmoothingQuality = 'high'; gf.drawImage(m2, 0, 0, 270, 480);
      el.currentTime = 0;
      return { url: item.url, el: el, img: snap, w: w, h: h, retrato: ehRetrato(w, h), fundo: fundo,
               duracao: isFinite(el.duration) ? el.duration : Number(item.duracao) || 0, video: true, nota: 0 };
    });
  }

  function prepararVideos(itens, onProgresso) {
    var res = {}, falhas = [], feitos = 0;
    return (itens || []).reduce(function (p, it) {
      return p.then(function () {
        return prepararVideo(it).then(function (v) { res[it.url] = v; }, function () { falhas.push(it.url); })
          .then(function () { feitos++; if (onProgresso) onProgresso(feitos, itens.length); });
      });
    }, Promise.resolve()).then(function () { return { videos: res, falhas: falhas }; });
  }

  /* desenha a imagem cobrindo o retângulo, com zoom e deslocamento (-1..1) */
  function capaEm(ctx, img, x, y, w, h, zoom, px, py) {
    var dm = dimensoes(img), iw = dm.w, ih = dm.h;
    if (!iw || !ih) return;
    var s = Math.max(w / iw, h / ih) * (zoom || 1);
    var dw = iw * s, dh = ih * s, folgaX = (dw - w) / 2, folgaY = (dh - h) / 2;
    var dx = x - folgaX + folgaX * (px || 0), dy = y - folgaY + folgaY * (py || 0);
    if (FILTRO_ATIVO) {
      ctx.save(); var atual = ctx.filter && ctx.filter !== 'none' ? ctx.filter + ' ' : '';
      ctx.filter = atual + FILTRO_ATIVO; ctx.drawImage(img, dx, dy, dw, dh); ctx.restore();
    }
    else ctx.drawImage(img, dx, dy, dw, dh);
  }

  /* movimento de câmera (Ken Burns) determinístico por índice */
  function camera(i, lt, dur, forte) {
    var p = eio(lt / dur), sobe = i % 2 === 0;
    var z0 = forte ? 1.10 : 1.04, z1 = forte ? 1.02 : 1.13;
    var lado = [[-0.6, 0.6], [0.5, -0.5], [0, 0], [-0.4, 0.3]][i % 4];
    return {
      zoom: sobe ? lerp(z0, z1, p) : lerp(z1, z0, p),
      px: lerp(lado[0], lado[1], p),
      py: i % 3 === 1 ? lerp(-0.3, 0.3, p) : 0
    };
  }

  /* Foto em tela cheia (retrato) ou em moldura sobre o fundo desfocado. */
  function fotoTela(ctx, F, lt, dur, i, M, opts) {
    opts = opts || {};
    var cam = opts.semCamera ? { zoom: 1, px: 0, py: 0 } : camera(i, lt, dur, M.forte);
    if (!F) { ctx.fillStyle = M.claro ? COR.papel2 : COR.tinta2; ctx.fillRect(0, 0, W, H); return; }
    if (F.retrato && !M.claro && !opts.moldura) {
      capaEm(ctx, F.img, 0, 0, W, H, cam.zoom, cam.px, cam.py);
      return;
    }
    /* fundo */
    if (M.claro) {
      ctx.fillStyle = COR.papel; ctx.fillRect(0, 0, W, H);
    } else {
      capaEm(ctx, F.fundo, 0, 0, W, H, 1.15, 0, 0);
      ctx.fillStyle = 'rgba(14,14,20,.45)'; ctx.fillRect(0, 0, W, H);
    }
    /* moldura */
    var mx = M.claro ? 60 : 48, mw = W - mx * 2;
    var mh = F.retrato ? Math.min(opts.alturaMax || 1180, mw * 1.33) : Math.min(opts.alturaMax || 1100, mw * F.h / F.w);
    var my = opts.y != null ? opts.y : (M.claro ? 250 : Math.round((H - mh) / 2 - 140));
    ctx.save();
    ctx.shadowColor = M.claro ? 'rgba(14,14,20,.18)' : 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 60; ctx.shadowOffsetY = 18;
    retArred(ctx, mx, my, mw, mh, 28); ctx.fillStyle = M.claro ? '#fff' : '#000'; ctx.fill();
    ctx.restore();
    ctx.save(); retArred(ctx, mx, my, mw, mh, 28); ctx.clip();
    capaEm(ctx, F.img, mx, my, mw, mh, 1 + (cam.zoom - 1) * 0.6, cam.px * 0.5, cam.py * 0.5);
    ctx.restore();
    return { x: mx, y: my, w: mw, h: mh };
  }

  function gradienteBase(ctx, ini, forca) {
    var g = ctx.createLinearGradient(0, H * ini, 0, H);
    g.addColorStop(0, 'rgba(14,14,20,0)');
    g.addColorStop(0.45, 'rgba(14,14,20,' + (0.55 * forca) + ')');
    g.addColorStop(0.78, 'rgba(14,14,20,' + (0.86 * forca) + ')');
    g.addColorStop(1, 'rgba(14,14,20,' + (0.94 * forca) + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function gradienteTopo(ctx) {
    var g = ctx.createLinearGradient(0, 0, 0, 380);
    g.addColorStop(0, 'rgba(14,14,20,.5)'); g.addColorStop(1, 'rgba(14,14,20,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 380);
  }

  function selo(ctx, x, y, rotulo, fundo, cor, alpha, alinhar) {
    if (alpha <= 0.001) return;
    ctx.save(); ctx.globalAlpha *= alpha;
    ctx.font = '500 30px "DM Mono", monospace';
    var esp = espacar(ctx, 6), s = esp(rotulo), w = ctx.measureText(s).width + 52, h = 64;
    var x0 = alinhar === 'right' ? x - w : x;
    retArred(ctx, x0, y, w, h, 32); ctx.fillStyle = fundo; ctx.fill();
    ctx.fillStyle = cor; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(s, x0 + 26, y + h / 2 + 1);
    semEspaco(ctx); ctx.restore();
  }

  /* ── as cenas ─────────────────────────────────────────────────── */
  var CENAS = {};

  CENAS.abertura = function (ctx, lt, c, S) {
    var M = S.M, F = S.capaF;
    if (M.claro) {
      ctx.fillStyle = COR.papel; ctx.fillRect(0, 0, W, H);
      var a = entra(lt, 0, 0.9);
      ctx.save(); ctx.globalAlpha = a;
      ctx.translate(0, (1 - a) * 40);
      var box = fotoTela(ctx, F, lt, c.dur, 0, M, { moldura: true, y: 170, alturaMax: 900 });
      ctx.restore();
      var y0 = (box ? box.y + box.h : 1070) + 96, T = c.titE;
      ctx.font = '500 28px "DM Mono", monospace';
      var espE = espacar(ctx, 5);
      texto(ctx, espE(c.eyebrow), PAD, y0, '500 28px "DM Mono", monospace', COR.ouroD, entra(lt, 0.35), (1 - entra(lt, 0.35)) * 24);
      semEspaco(ctx);
      T.linhas.forEach(function (l, i) {
        var e = entra(lt, 0.5 + i * 0.1);
        texto(ctx, l, PAD, y0 + T.tam * 1.1 + i * T.tam * 1.04, T.font + ', Georgia, serif', COR.tinta, e, (1 - e) * 30);
      });
      var yn = y0 + T.tam * 1.1 + (T.linhas.length - 1) * T.tam * 1.04 + 74, en = entra(lt, 0.9);
      texto(ctx, S.nome, PAD, yn, '600 38px "DM Sans", sans-serif', COR.texto, en, (1 - en) * 20);
      texto(ctx, S.sub, PAD, yn + 50, '400 32px "DM Sans", sans-serif', 'rgba(26,26,36,.62)', en, (1 - en) * 20);
      return;
    }
    fotoTela(ctx, F, lt, c.dur, 0, M);
    gradienteTopo(ctx);
    gradienteBase(ctx, 0.36, 1);
    /* sem marca d'água (Pro), o símbolo assina a abertura no canto esquerdo */
    if (!S.marca) marcaFieldo(ctx, PAD, 236, 40, '#fff', entra(lt, 0.1) * 0.85);
    var y = 1180, e1 = entra(lt, 0.25), acento = S.acento;
    if (M.forte) {
      ctx.save(); ctx.globalAlpha = e1;
      ctx.fillStyle = acento; ctx.fillRect(PAD, y - 40, lerp(0, 92, e1), 10); ctx.restore();
      texto(ctx, c.eyebrow, PAD, y + 20, '600 30px "DM Sans", sans-serif', acento, e1, (1 - e1) * 20);
      var TF = c.titF, lh = TF.tam * 1.02;
      TF.linhas.forEach(function (l, i) {
        var e = eback((lt - 0.4 - i * 0.08) / 0.55);
        if (lt < 0.4 + i * 0.08) return;
        ctx.save(); ctx.globalAlpha = clamp01(e);
        var sy = y + 40 + TF.tam + i * lh;
        ctx.translate(PAD, sy); ctx.scale(lerp(0.85, 1, clamp01(e)), lerp(0.85, 1, clamp01(e)));
        texto(ctx, l, 0, 0, TF.font + ', sans-serif', '#fff', 1, 0);
        ctx.restore();
      });
      var yn = y + 40 + TF.tam + (TF.linhas.length - 1) * lh + 82, en = entra(lt, 0.95);
      texto(ctx, S.nome.toUpperCase(), PAD, yn, '700 38px "DM Sans", sans-serif', '#fff', en, (1 - en) * 20);
      texto(ctx, S.sub, PAD, yn + 50, '500 32px "DM Sans", sans-serif', 'rgba(255,255,255,.66)', en, (1 - en) * 20);
      return;
    }
    ctx.save(); ctx.globalAlpha = e1; ctx.fillStyle = COR.ouroD; ctx.fillRect(PAD, y - 10, lerp(0, 34, e1), 2); ctx.restore();
    ctx.font = '500 28px "DM Mono", monospace';
    var esp = espacar(ctx, 5);
    texto(ctx, esp(c.eyebrow), PAD + 50, y, '500 28px "DM Mono", monospace', COR.ouro, e1, (1 - e1) * 22);
    semEspaco(ctx);
    var T = c.tit, lhc = T.tam * 1.04;
    T.linhas.forEach(function (l, i) {
      var e = entra(lt, 0.45 + i * 0.1, 0.8);
      texto(ctx, l, PAD, y + 16 + T.tam + i * lhc, T.font + ', Georgia, serif', COR.papel, e, (1 - e) * 36);
    });
    var yl = y + 16 + T.tam + (T.linhas.length - 1) * lhc + 50, el = entra(lt, 0.85);
    ctx.save(); ctx.globalAlpha = el * 0.9; ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(PAD, yl, lerp(0, 140, el), 2); ctx.restore();
    var en2 = entra(lt, 0.95);
    texto(ctx, S.nome, PAD, yl + 62, '600 40px "DM Sans", sans-serif', COR.papel, en2, (1 - en2) * 20);
    texto(ctx, S.sub, PAD, yl + 112, '400 33px "DM Sans", sans-serif', 'rgba(255,255,255,.6)', en2, (1 - en2) * 20);
  };

  CENAS.antesDepois = function (ctx, lt, c, S) {
    var M = S.M, A = S.fotos[S.r.antes], D = S.fotos[S.r.depois];
    var cor = M.forte ? S.acento : COR.ouro;
    if (M.claro) {
      /* editorial: as duas fotos empilhadas, uma de cada vez */
      ctx.fillStyle = COR.papel; ctx.fillRect(0, 0, W, H);
      var mx = 60, mw = W - 120, mh = 690;
      [[A, 210, 0, 'ANTES'], [D, 210 + mh + 60, 0.9, 'DEPOIS']].forEach(function (q, k) {
        var e = entra(lt, q[2], 0.8);
        if (e <= 0) return;
        ctx.save(); ctx.globalAlpha = e; ctx.translate(0, (1 - e) * 50);
        ctx.save(); ctx.shadowColor = 'rgba(14,14,20,.16)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 14;
        retArred(ctx, mx, q[1], mw, mh, 26); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
        ctx.save(); retArred(ctx, mx, q[1], mw, mh, 26); ctx.clip();
        if (q[0]) { var cam = camera(k, lt, c.dur, false); capaEm(ctx, q[0].img, mx, q[1], mw, mh, 1 + (cam.zoom - 1) * 0.5, 0, 0); }
        ctx.restore();
        selo(ctx, mx + 28, q[1] + 28, q[3], k ? COR.tinta : 'rgba(255,255,255,.92)', k ? COR.papel : COR.tinta, 1);
        ctx.restore();
      });
      return;
    }
    /* clássico e impacto: cortina que revela o depois sobre o antes */
    var cortina = M.forte ? eio((lt - 0.55) / 1.1) : eio((lt - 0.9) / 1.6);
    var split = cortina * W, zoom = lerp(1.04, 1.1, eio(lt / c.dur));
    function foto(F) {
      if (!F) { ctx.fillStyle = COR.tinta2; ctx.fillRect(0, 0, W, H); return; }
      if (F.retrato) { capaEm(ctx, F.img, 0, 0, W, H, zoom, 0, 0); return; }
      capaEm(ctx, F.fundo, 0, 0, W, H, 1.15, 0, 0);
      ctx.fillStyle = 'rgba(14,14,20,.45)'; ctx.fillRect(0, 0, W, H);
      var mw = W - 96, mh = Math.min(1100, mw * F.h / F.w), my = (H - mh) / 2 - 140;
      ctx.save(); retArred(ctx, 48, my, mw, mh, 28); ctx.clip();
      capaEm(ctx, F.img, 48, my, mw, mh, 1 + (zoom - 1) * 0.6, 0, 0); ctx.restore();
    }
    foto(A);
    if (split > 0.5) {
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, split, H); ctx.clip(); foto(D); ctx.restore();
    }
    gradienteTopo(ctx);
    gradienteBase(ctx, 0.62, 0.9);
    /* divisória com alça */
    if (cortina > 0 && cortina < 1) {
      ctx.save();
      ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 18;
      ctx.fillRect(split - 3, 0, 6, H);
      ctx.beginPath(); ctx.arc(split, H * 0.44, 46, 0, Math.PI * 2); ctx.fillStyle = cor; ctx.fill();
      ctx.shadowBlur = 0; ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(split - 12, H * 0.44 - 14); ctx.lineTo(split - 24, H * 0.44); ctx.lineTo(split - 12, H * 0.44 + 14);
      ctx.moveTo(split + 12, H * 0.44 - 14); ctx.lineTo(split + 24, H * 0.44); ctx.lineTo(split + 12, H * 0.44 + 14); ctx.stroke();
      ctx.restore();
    }
    var aAntes = (1 - clamp01((cortina - 0.55) / 0.2)) * entra(lt, 0.1, 0.5);
    var aDepois = clamp01((cortina - 0.25) / 0.3);
    selo(ctx, W - 150, 330, 'ANTES', 'rgba(14,14,20,.72)', '#fff', aAntes, 'right');
    selo(ctx, PAD, 330, 'DEPOIS', M.forte ? S.acento : COR.ouro, M.forte ? '#fff' : COR.tinta, aDepois);
    var ef = entra(lt, (M.forte ? 1.5 : 2.4), 0.7);
    if (M.forte) texto(ctx, 'ANTES E DEPOIS', PAD, 1480, '800 84px "DM Sans", sans-serif', '#fff', ef, (1 - ef) * 30);
    else texto(ctx, 'Antes e depois', PAD, 1480, 'italic 500 84px Fraunces, Georgia, serif', COR.papel, ef, (1 - ef) * 30);
    texto(ctx, c.legenda, PAD, 1540, '400 32px "DM Sans", sans-serif', 'rgba(255,255,255,.66)', ef, (1 - ef) * 20);
  };

  CENAS.foto = function (ctx, lt, c, S) {
    var M = S.M, F = S.fotos[c.url];
    var box = fotoTela(ctx, F, lt, c.dur, c.indice + 1, M);
    if (M.claro) {
      var y = box ? box.y + box.h + 120 : 1500, e = entra(lt, 0.25);
      texto(ctx, c.contador, PAD, y, '500 28px "DM Mono", monospace', COR.ouroD, e, (1 - e) * 20);
      texto(ctx, c.legenda, PAD, y + 70, 'italic 500 60px Fraunces, Georgia, serif', COR.tinta, e, (1 - e) * 24);
      return;
    }
    if (!box) gradienteBase(ctx, 0.66, 0.85); else gradienteBase(ctx, 0.7, 0.7);
    var e2 = entra(lt, 0.2, 0.6);
    if (M.forte) {
      ctx.save(); ctx.globalAlpha = e2; ctx.fillStyle = S.acento; ctx.fillRect(PAD, 1420, 10, 110); ctx.restore();
      texto(ctx, c.legendaF, PAD + 36, 1478, '800 54px "DM Sans", sans-serif', '#fff', e2, (1 - e2) * 20);
      texto(ctx, c.contador, PAD + 36, 1528, '600 28px "DM Sans", sans-serif', 'rgba(255,255,255,.7)', e2, (1 - e2) * 20);
      return;
    }
    ctx.font = '500 26px "DM Mono", monospace';
    var esp = espacar(ctx, 4);
    texto(ctx, esp(c.contador), PAD, 1470, '500 26px "DM Mono", monospace', COR.ouro, e2, (1 - e2) * 16);
    semEspaco(ctx);
    texto(ctx, c.legenda, PAD, 1532, 'italic 500 56px Fraunces, Georgia, serif', COR.papel, e2, (1 - e2) * 20);
  };

  /* clipe de vídeo: o quadro do <video> sincronizado pela linha do tempo.
     Sem movimento de câmera (o vídeo já se mexe); em pé ocupa a tela,
     deitado entra em moldura sobre o próprio quadro desfocado. */
  CENAS.video = function (ctx, lt, c, S) {
    var M = S.M, V = c.V;
    if (!V) { ctx.fillStyle = M.claro ? COR.papel2 : COR.tinta2; ctx.fillRect(0, 0, W, H); return; }
    var F = { img: V.el.readyState >= 2 ? V.el : V.img, fundo: V.fundo, retrato: V.retrato, w: V.w, h: V.h };
    var box = fotoTela(ctx, F, lt, c.dur, 0, M, { semCamera: true });
    if (!M.claro && (c.texto || c.legenda)) gradienteBase(ctx, box ? 0.72 : 0.66, 0.7);
  };

  /* texto livre por cena (Studio v2), em três estilos */
  function legendaLivre(ctx, txt, estilo, alpha, S) {
    if (!txt || alpha <= 0.001) return;
    var acento = S.M.forte ? S.acento : COR.ouro, y = 1430;
    ctx.save(); ctx.globalAlpha *= alpha;
    if (estilo === 'destaque') {
      var A = ajustar('800 {t}px "DM Sans"', txt.toUpperCase(), W - PAD * 2 - 60, 2, [74, 64, 56]);
      var lh = A.tam * 1.08, topo = y - lh * A.linhas.length;
      A.linhas.forEach(function (l, i) {
        ctx.font = A.font + ', sans-serif';
        var w = ctx.measureText(l).width, yy = topo + i * lh;
        ctx.fillStyle = acento; ctx.fillRect(PAD - 14, yy + lh * 0.12, w + 28, lh * 0.92);
        texto(ctx, l, PAD, yy + lh * 0.86, A.font + ', sans-serif', S.M.claro ? '#fff' : COR.tinta, 1, 0);
      });
    } else if (estilo === 'caixa') {
      var B = ajustar('600 {t}px "DM Sans"', txt, W - PAD * 2 - 80, 3, [54, 48, 42]);
      var lb = B.tam * 1.22, hb = lb * B.linhas.length + 52, yb = y - hb + 20;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 8;
      retArred(ctx, PAD - 10, yb, W - PAD * 2 - 130, hb, 26); ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill(); ctx.restore();
      B.linhas.forEach(function (l, i) { texto(ctx, l, PAD + 26, yb + 26 + B.tam + i * lb, B.font + ', sans-serif', COR.tinta, 1, 0); });
    } else {
      var L = ajustar('600 {t}px "DM Sans"', txt, W - PAD * 2 - 60, 3, [58, 52, 46]);
      var ll = L.tam * 1.2, y0 = y - ll * (L.linhas.length - 1);
      L.linhas.forEach(function (l, i) {
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 3;
        texto(ctx, l, W / 2 - 40, y0 + i * ll, L.font + ', sans-serif', S.M.claro ? COR.tinta : '#fff', 1, 0, 'center');
        ctx.restore();
      });
    }
    ctx.restore();
  }

  CENAS.avaliacao = function (ctx, lt, c, S) {
    var M = S.M, F = S.fotos[S.r.depois] || S.capaF;
    var corTexto = M.claro ? COR.tinta : COR.papel, corSub = M.claro ? 'rgba(26,26,36,.6)' : 'rgba(255,255,255,.6)';
    if (M.claro) { ctx.fillStyle = COR.papel; ctx.fillRect(0, 0, W, H); }
    else {
      if (F) capaEm(ctx, F.fundo, 0, 0, W, H, 1.2 + lt * 0.02, 0, 0); else { ctx.fillStyle = COR.tinta2; ctx.fillRect(0, 0, W, H); }
      ctx.fillStyle = 'rgba(14,14,20,.62)'; ctx.fillRect(0, 0, W, H);
    }
    var ey = entra(lt, 0.1);
    ctx.font = '500 28px "DM Mono", monospace';
    var esp = espacar(ctx, 5);
    texto(ctx, esp('AVALIAÇÃO DO CLIENTE'), W / 2, 600, '500 28px "DM Mono", monospace', M.claro ? COR.ouroD : COR.ouro, ey, (1 - ey) * 16, 'center');
    semEspaco(ctx);
    /* estrelas, uma de cada vez */
    var n = c.nota, r = 50, gap = 124, x0 = W / 2 - gap * 2;
    for (var i = 0; i < 5; i++) {
      var t0 = 0.35 + i * 0.12, e = eback((lt - t0) / 0.45);
      if (lt < t0) continue;
      ctx.save(); ctx.translate(x0 + i * gap, 720); ctx.scale(clamp01(e) * 0.3 + e * 0.7, clamp01(e) * 0.3 + e * 0.7);
      estrela(ctx, 0, 0, r);
      ctx.fillStyle = i < n ? (M.forte ? S.acento : COR.ouro) : (M.claro ? 'rgba(14,14,20,.12)' : 'rgba(255,255,255,.2)');
      ctx.fill(); ctx.restore();
    }
    var q0 = 1.0;
    c.linhas.forEach(function (l, k) {
      var e = entra(lt, q0 + 0.12 + k * 0.1, 0.7);
      texto(ctx, l, W / 2, 940 + k * 84 + (M.claro ? 60 : 0), 'italic 400 64px Fraunces, Georgia, serif', corTexto, e, (1 - e) * 24, 'center');
    });
    var ea = entra(lt, q0 + 0.5 + c.linhas.length * 0.1);
    texto(ctx, '— ' + c.autor, W / 2, 1000 + c.linhas.length * 84 + (M.claro ? 60 : 0), '500 34px "DM Sans", sans-serif', corSub, ea, (1 - ea) * 16, 'center');
  };

  /* ── encerramentos (Studio v2) ───────────────────────────────────
     c.estilo: 'cartao' (o original) | 'whatsapp' | 'contato' | 'logo'
     c.qr / c.link: mostrar ou não o QR e o endereço do perfil.
     Sem QR e sem link o vídeo não leva o cliente ao perfil — a escolha é
     do profissional; a tela avisa que as visitas deixam de ser contadas. */
  function fundoFechamento(ctx, S) {
    var M = S.M, claro = M.claro;
    ctx.fillStyle = claro ? COR.papel : COR.tinta; ctx.fillRect(0, 0, W, H);
    var gl = ctx.createRadialGradient(W / 2, 640, 40, W / 2, 640, 760);
    gl.addColorStop(0, M.forte ? hexRgba(S.acento, 0.32) : 'rgba(212,171,64,' + (claro ? 0.16 : 0.2) + ')');
    gl.addColorStop(1, 'rgba(212,171,64,0)');
    ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H);
  }

  function avatarCirculo(ctx, S, cx, cy, raio, lt, t0) {
    var M = S.M, claro = M.claro, ea = eback((lt - t0) / 0.6);
    if (lt <= t0) return;
    ctx.save(); ctx.translate(cx, cy); var s = 0.6 + 0.4 * ea; ctx.scale(s, s); ctx.globalAlpha = clamp01(ea);
    ctx.beginPath(); ctx.arc(0, 0, raio + 8, 0, Math.PI * 2); ctx.fillStyle = M.forte ? S.acento : COR.ouro; ctx.fill();
    if (S.avatar) {
      ctx.save(); ctx.beginPath(); ctx.arc(0, 0, raio, 0, Math.PI * 2); ctx.clip();
      capaEm(ctx, S.avatar.img, -raio, -raio, raio * 2, raio * 2, 1, 0, -0.2); ctx.restore();
    } else {
      ctx.beginPath(); ctx.arc(0, 0, raio, 0, Math.PI * 2); ctx.fillStyle = claro ? COR.papel2 : COR.tinta2; ctx.fill();
      texto(ctx, (S.nome || 'F').charAt(0).toUpperCase(), 0, raio * 0.38, 'italic 500 ' + Math.round(raio * 1.1) + 'px Fraunces, Georgia, serif', M.forte ? S.acento : COR.ouro, 1, 0, 'center');
    }
    ctx.restore();
  }

  function blocoQr(ctx, S, lt, y, t0) {
    var eq = eback((lt - t0) / 0.6), lado = 300, qx = W / 2 - lado / 2;
    if (!S.qr || lt <= t0) return;
    ctx.save(); ctx.globalAlpha = clamp01(eq);
    ctx.translate(W / 2, y + lado / 2); ctx.scale(0.8 + 0.2 * eq, 0.8 + 0.2 * eq); ctx.translate(-W / 2, -(y + lado / 2));
    retArred(ctx, qx - 26, y - 26, lado + 52, lado + 52, 30); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.imageSmoothingEnabled = false; ctx.drawImage(S.qr, qx, y, lado, lado); ctx.imageSmoothingEnabled = true;
    ctx.restore();
  }

  /* ícone do WhatsApp desenhado (balão + telefone), sem imagem externa */
  function iconeWhats(ctx, cx, cy, r) {
    ctx.save();
    ctx.fillStyle = '#25d366'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = r * 0.1; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.56, Math.PI * 0.72, Math.PI * 2.55);
    ctx.lineTo(cx - r * 0.5, cy + r * 0.56); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath();
    ctx.ellipse(cx - r * 0.13, cy - r * 0.14, r * 0.1, r * 0.17, -0.6, 0, Math.PI * 2);
    ctx.ellipse(cx + r * 0.16, cy + r * 0.15, r * 0.17, r * 0.1, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function telefoneBR(n) {
    var d = String(n || '').replace(/\D/g, '');
    if (d.length > 11 && d.indexOf('55') === 0) d = d.slice(2);
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return d;
  }

  CENAS.fechamento = function (ctx, lt, c, S) {
    var M = S.M, claro = M.claro;
    var tinta = claro ? COR.tinta : COR.papel, sub = claro ? 'rgba(26,26,36,.62)' : 'rgba(255,255,255,.6)';
    var acento = M.forte ? S.acento : (claro ? COR.ouroD : COR.ouro);
    var fonteNome = M.forte ? '800 84px "DM Sans", sans-serif' : 'italic 500 88px Fraunces, Georgia, serif';
    fundoFechamento(ctx, S);
    var en = entra(lt, 0.3, 0.7), ec = entra(lt, 0.6, 0.7), el = entra(lt, 1.15, 0.6);
    var y;

    if (c.estilo === 'whatsapp') {
      var ew = eback((lt - 0.1) / 0.6);
      if (lt > 0.1) { ctx.save(); ctx.globalAlpha = clamp01(ew); ctx.translate(W / 2, 470); ctx.scale(0.6 + 0.4 * ew, 0.6 + 0.4 * ew); iconeWhats(ctx, 0, 0, 120); ctx.restore(); }
      texto(ctx, c.chamada, W / 2, 720, '700 64px "DM Sans", sans-serif', tinta, ec, (1 - ec) * 22, 'center');
      texto(ctx, c.whats || 'Chame no WhatsApp', W / 2, 830, '600 76px "DM Mono", monospace', acento, en, (1 - en) * 20, 'center');
      c.nomeL.forEach(function (l, k) { texto(ctx, l, W / 2, 960 + k * 92, fonteNome, tinta, en, (1 - en) * 26, 'center'); });
      y = 960 + (c.nomeL.length - 1) * 92;
      texto(ctx, S.sub, W / 2, y + 64, '400 34px "DM Sans", sans-serif', sub, en, (1 - en) * 20, 'center');
      y += 130;
    } else if (c.estilo === 'contato') {
      avatarCirculo(ctx, S, W / 2, 440, 96, lt, 0.1);
      c.nomeL.forEach(function (l, k) { texto(ctx, l, W / 2, 660 + k * 92, fonteNome, tinta, en, (1 - en) * 26, 'center'); });
      y = 660 + (c.nomeL.length - 1) * 92;
      texto(ctx, S.sub, W / 2, y + 64, '400 34px "DM Sans", sans-serif', sub, en, (1 - en) * 20, 'center');
      var linhas = [];
      if (c.whats) linhas.push(['WhatsApp', c.whats]);
      if (c.insta) linhas.push(['Instagram', '@' + c.insta]);
      if (c.link && c.linkTexto) linhas.push(['Perfil', c.linkTexto]);
      linhas.forEach(function (ln, k) {
        var e = entra(lt, 0.7 + k * 0.15, 0.6), yy = y + 190 + k * 120;
        ctx.save(); ctx.globalAlpha *= e;
        retArred(ctx, PAD, yy - 70, W - PAD * 2 - 60, 100, 22); ctx.fillStyle = claro ? 'rgba(14,14,20,.05)' : 'rgba(255,255,255,.07)'; ctx.fill();
        ctx.restore();
        texto(ctx, ln[0].toUpperCase(), PAD + 30, yy - 22, '500 24px "DM Mono", monospace', acento, e, 0);
        texto(ctx, ln[1], PAD + 30, yy + 16, (ln[0] === 'Perfil' ? '500 30px "DM Mono", monospace' : '600 40px "DM Sans", sans-serif'), tinta, e, 0);
      });
      y += 190 + linhas.length * 120;
      texto(ctx, c.chamada, W / 2, y + 30, '600 50px "DM Sans", sans-serif', tinta, ec, (1 - ec) * 22, 'center');
      y += 60;
    } else if (c.estilo === 'logo') {
      avatarCirculo(ctx, S, W / 2, 700, 170, lt, 0.1);
      c.nomeL.forEach(function (l, k) { texto(ctx, l, W / 2, 1010 + k * 92, fonteNome, tinta, en, (1 - en) * 26, 'center'); });
      y = 1010 + (c.nomeL.length - 1) * 92;
      texto(ctx, S.sub, W / 2, y + 64, '400 34px "DM Sans", sans-serif', sub, en, (1 - en) * 20, 'center');
      if (c.link && c.linkTexto) texto(ctx, c.linkTexto, W / 2, y + 150, '500 30px "DM Mono", monospace', acento, el, (1 - el) * 14, 'center');
      y = null;
    } else {
      /* cartão: o encerramento original */
      avatarCirculo(ctx, S, W / 2, 560, 110, lt, 0.1);
      c.nomeL.forEach(function (l, k) { texto(ctx, l, W / 2, 800 + k * 92, fonteNome, tinta, en, (1 - en) * 26, 'center'); });
      y = 800 + (c.nomeL.length - 1) * 92;
      texto(ctx, S.sub, W / 2, y + 64, '400 34px "DM Sans", sans-serif', sub, en, (1 - en) * 20, 'center');
      texto(ctx, c.chamada, W / 2, y + 190, '600 52px "DM Sans", sans-serif', tinta, ec, (1 - ec) * 22, 'center');
      y += 250;
    }

    if (y != null) {
      if (c.qr && S.qr) { blocoQr(ctx, S, lt, y, 0.85); y += 400; }
      if (c.link && c.linkTexto && c.estilo !== 'contato') {
        texto(ctx, c.linkTexto, W / 2, y + (c.qr && S.qr ? 0 : 40), '500 30px "DM Mono", monospace', acento, el, (1 - el) * 14, 'center');
        if (c.qr && S.qr) texto(ctx, 'Aponte a câmera do celular para o código', W / 2, y + 50, '400 28px "DM Sans", sans-serif', sub, el, (1 - el) * 14, 'center');
      }
    }

    if (S.marca) {
      var em = entra(lt, 1.4, 0.6);
      ctx.save(); ctx.globalAlpha = em * 0.75;
      ctx.font = '500 28px "DM Sans", sans-serif';
      var t = 'feito com fieldo', tw = ctx.measureText(t).width, x = W / 2 - (tw + 46) / 2;
      marcaFieldo(ctx, x, 1648, 34, claro ? COR.tinta : '#fff', 1);
      texto(ctx, t, x + 46, 1674, '500 28px "DM Sans", sans-serif', sub, 1, 0, 'left');
      ctx.restore();
    }
  };

  /* marca d'água discreta (plano grátis): canto superior direito,
     fora da área dos botões das redes, em todas as cenas menos o fim */
  function marcaDagua(ctx, S, alpha) {
    if (!S.marca || alpha <= 0) return;
    ctx.save(); ctx.globalAlpha = 0.7 * alpha;
    var claro = S.M.claro, cor = claro ? COR.tinta : '#fff';
    ctx.font = '600 30px "DM Sans", sans-serif';
    var tw = ctx.measureText('fieldo').width, x = W - 150 - tw;
    marcaFieldo(ctx, x - 44, 236, 34, cor, 1);
    texto(ctx, 'fieldo', x, 262, '600 30px "DM Sans", sans-serif', cor, 1, 0, 'left');
    ctx.restore();
  }

  /* ── montagem ─────────────────────────────────────────────────── */

  /**
   * Sugere o roteiro inicial de um serviço: capa = foto mais nítida (de
   * preferência em pé), antes = 1ª foto, depois = última, e as demais
   * como detalhes pela ordem de qualidade. O profissional ajusta tudo.
   */
  function sugerirRoteiro(servico, fotos, videos) {
    var urls = (servico.fotos || []).filter(function (u) { return typeof u === 'string' && fotos[u]; });
    /* v12.43 · clipes: até 2, os primeiros 8 s de cada (o profissional ajusta) */
    var clipes = (servico.videos || []).filter(function (v) { return v && videos && videos[v.url]; }).slice(0, 2).map(function (v) {
      var tot = videos[v.url].duracao || Number(v.duracao) || 8;
      return { url: v.url, de: 0, ate: Math.round(Math.min(tot, 8) * 10) / 10, vel: 1, vol: 1 };
    });
    var porNota = urls.slice().sort(function (a, b) {
      return (fotos[b].nota + (fotos[b].retrato ? 1.2 : 0)) - (fotos[a].nota + (fotos[a].retrato ? 1.2 : 0));
    });
    var antes = urls.length >= 2 ? urls[0] : null, depois = urls.length >= 2 ? urls[urls.length - 1] : null;
    var capa = depois || porNota[0] || null;
    var escolhidas = porNota.slice(0, 8);
    if (antes && escolhidas.indexOf(antes) < 0) escolhidas[escolhidas.length - 1] = antes;
    return {
      v: 2,
      videos: clipes,
      titulo: limpa(servico.titulo || servico.categoria || 'Serviço concluído', 60),
      chamada: 'Peça seu orçamento',
      fotos: urls.filter(function (u) { return escolhidas.indexOf(u) >= 0; }),
      capa: capa,
      antes: antes,
      depois: depois,
      avaliacao: !!(servico.avaliacao && servico.avaliacao.nota >= 4 && servico.avaliacao.comentario)
    };
  }

  function linkLimpo(url) {
    return String(url || '').replace(/^https?:\/\//, '').replace(/[?#].*$/, '');
  }

  function rotuloData(iso) {
    var m = /^(\d{4})-(\d{2})/.exec(iso || '');
    return m ? MESES[Number(m[2]) - 1] + ' ' + m[1] : '';
  }

  var VELOCIDADES = [0.5, 0.75, 1, 1.25, 1.5, 2];
  var TRANSICOES = ['modelo', 'fade', 'deslizar', 'zoom', 'cortina', 'flash', 'corte', 'desfoque'];

  /**
   * Monta a linha do tempo. d = {
   *   perfil {nome, profissao, cidade, uf, whatsapp, instagram}, servico {titulo, categoria, data, avaliacao},
   *   roteiro, modelo, marca, link (com ?src=), fotos (de prepararFotos), videos (de prepararVideos),
   *   avatar (foto preparada ou null)
   * }
   * Devolve { duracao, cenas, desenhar(ctx, t), quadrosChave(), sincronizar(t, tocando),
   *           quadroExato(t) → Promise, pararVideos(), clipes }.
   */
  function montar(d) {
    var M = MODELOS[d.modelo] || MODELOS.classico;
    var r = d.roteiro || {}, fotos = d.fotos || {}, vids = d.videos || {}, perfil = d.perfil || {}, sv = d.servico || {};
    var acento = (M.forte && /^#[0-9a-f]{6}$/i.test(r.acento || '')) ? r.acento : COR.ouro;
    var nome = limpa(perfil.nome || 'Profissional', 40);
    var sub = [limpa(perfil.profissao, 28), limpa([perfil.cidade, perfil.uf].filter(Boolean).join('/'), 30)].filter(Boolean).join('  ·  ');

    var usaveis = (r.fotos || []).filter(function (u) { return fotos[u]; });
    var clipes = (r.videos || []).filter(function (v) { return v && vids[v.url]; }).slice(0, 3).map(function (v) {
      var V = vids[v.url], total = V.duracao || 30;
      var de = Math.max(0, Math.min(Number(v.de) || 0, Math.max(0, total - 0.3)));
      var ate = Math.min(total, de + 30, v.ate != null ? Number(v.ate) : total);
      if (!(ate > de + 0.25)) ate = Math.min(total, de + 1);
      var vel = VELOCIDADES.indexOf(Number(v.vel)) >= 0 ? Number(v.vel) : 1;
      var vol = v.vol == null ? 1 : Math.max(0, Math.min(1, Number(v.vol)));
      return { url: v.url, V: V, de: de, ate: ate, vel: vel, vol: vol };
    });
    var capa = fotos[r.capa] ? r.capa : (usaveis[0] || null);
    var capaF = capa ? fotos[capa] : (clipes[0] ? { img: clipes[0].V.img, fundo: clipes[0].V.fundo, retrato: clipes[0].V.retrato, w: clipes[0].V.w, h: clipes[0].V.h } : null);
    var antes = fotos[r.antes] ? r.antes : null, depois = fotos[r.depois] ? r.depois : null;
    var temAD = !!(antes && depois && antes !== depois);
    var enc = r.encerramento || {}, estiloFim = ['cartao', 'whatsapp', 'contato', 'logo', 'nenhum'].indexOf(enc.estilo) >= 0 ? enc.estilo : 'cartao';
    var S = {
      M: M, r: { capa: capa, antes: antes, depois: depois }, fotos: fotos, capaF: capaF, acento: acento,
      nome: nome, sub: sub, marca: d.marca !== false, avatar: d.avatar || null, qr: null
    };

    var k = M.ritmo, base = [];
    var titulo = limpa(r.titulo || sv.titulo || 'Serviço concluído', 60);
    var eyebrow = ['SERVIÇO CONCLUÍDO', rotuloData(sv.data)].filter(Boolean).join(' · ');
    base.push({
      id: 'abertura', tipo: 'abertura', dur: 3.1 * k, eyebrow: M.forte ? 'SERVIÇO CONCLUÍDO' : eyebrow,
      tit: ajustar('600 {t}px Fraunces', titulo, MAXW, 3, [96, 86, 76, 68]),
      titE: ajustar('italic 500 {t}px Fraunces', titulo, W - PAD * 2, 3, [84, 74, 66, 58]),
      titF: ajustar('800 {t}px "DM Sans"', titulo.toUpperCase(), MAXW, 3, [116, 100, 88, 78, 68])
    });
    if (temAD) base.push({ id: 'antesDepois', tipo: 'antesDepois', dur: (M.forte ? 3.2 : 4.2) * k, legenda: limpa(sv.categoria || titulo, 40) });

    clipes.forEach(function (cl, i) {
      base.push({ id: 'video:' + i, tipo: 'video', dur: Math.max(0.3, (cl.ate - cl.de) / cl.vel), V: cl.V, clip: cl, legenda: '' });
    });

    var usadas = [capa, antes, depois];
    var detalhes = usaveis.filter(function (u) { return usadas.indexOf(u) < 0; });
    if (!detalhes.length && !temAD) detalhes = usaveis.filter(function (u) { return u !== capa; });
    detalhes = detalhes.slice(0, M.forte ? 5 : 4);
    var legenda = limpa(sv.categoria || titulo, 34);
    detalhes.forEach(function (u, i) {
      base.push({
        id: 'foto:' + u, tipo: 'foto', dur: (M.forte ? 1.6 : 2.3) * k, url: u, indice: i,
        contador: String(i + 1).padStart(2, '0') + ' / ' + String(detalhes.length).padStart(2, '0'),
        legenda: legenda, legendaF: legenda.toUpperCase()
      });
    });

    var av = sv.avaliacao;
    if (r.avaliacao && av && av.nota >= 1 && av.comentario) {
      base.push({
        id: 'avaliacao', tipo: 'avaliacao', dur: 3.6 * k, nota: Math.round(av.nota),
        linhas: quebrar('italic 400 64px Fraunces', '“' + limpa(av.comentario, 170) + '”', 860, 5),
        autor: limpa(av.autor || 'Cliente', 30) + ', cliente'
      });
    }
    var fechamento = null;
    if (estiloFim !== 'nenhum') {
      fechamento = {
        id: 'fechamento', tipo: 'fechamento', dur: 3.8, estilo: estiloFim,
        qr: enc.qr !== false, link: enc.link !== false,
        whats: perfil.whatsapp ? telefoneBR(perfil.whatsapp) : null,
        insta: limpa(String(perfil.instagram || '').replace(/^@/, ''), 30) || null,
        nomeL: quebrar(M.forte ? '800 84px "DM Sans"' : 'italic 500 88px Fraunces', M.forte ? nome.toUpperCase() : nome, W - 160, 2),
        chamada: limpa(r.chamada || 'Peça seu orçamento', 60),
        linkTexto: linkLimpo(d.link)
      };
    }

    /* linha do tempo editada: ordem do meio, cenas ocultas, duração, texto, transição */
    var cfg = {}, ordem = [];
    (r.cenas || []).forEach(function (x) { if (x && typeof x.id === 'string') { cfg[x.id] = x; ordem.push(x.id); } });
    var abertura = base[0], meio = base.slice(1);
    meio = meio.map(function (c, i) { return { c: c, p: ordem.indexOf(c.id) >= 0 ? ordem.indexOf(c.id) : 1000 + i }; })
      .sort(function (a, b) { return a.p - b.p; }).map(function (x) { return x.c; });
    var cenas = [abertura].concat(meio).filter(function (c) { return !(cfg[c.id] && cfg[c.id].oculta); });
    if (!cenas.length) cenas = [abertura];
    if (fechamento) cenas.push(fechamento);
    cenas.forEach(function (c) {
      var x = cfg[c.id] || {};
      if (x.dur != null && c.tipo !== 'video') c.dur = Math.max(c.tipo === 'abertura' ? 1.2 : 0.8, Math.min(10, Number(x.dur) || c.dur));
      c.texto = limpa(x.texto || '', 60);
      c.trans = TRANSICOES.indexOf(x.trans) >= 0 ? x.trans : (TRANSICOES.indexOf(r.transicao) >= 0 ? r.transicao : 'modelo');
    });
    var estiloTexto = ['legenda', 'destaque', 'caixa'].indexOf(r.textoEstilo) >= 0 ? r.textoEstilo : 'legenda';
    var filtro = FILTROS[r.filtro] || '';

    /* QR do perfil com o código de rastreio */
    if (d.link && global.qrcode && fechamento && fechamento.qr) {
      try {
        var q = global.qrcode(0, 'M'); q.addData(d.link); q.make();
        var nmod = q.getModuleCount(), cel = 8, qc = canvas((nmod + 2) * cel, (nmod + 2) * cel), qg = qc.getContext('2d');
        qg.fillStyle = '#fff'; qg.fillRect(0, 0, qc.width, qc.height); qg.fillStyle = COR.tinta;
        for (var y = 0; y < nmod; y++) for (var x = 0; x < nmod; x++) if (q.isDark(y, x)) qg.fillRect((x + 1) * cel, (y + 1) * cel, cel, cel);
        S.qr = qc;
      } catch (e) { S.qr = null; }
    }

    /* tempos com sobreposição para a transição */
    var TR = M.tr, t = 0;
    cenas.forEach(function (c, i) { c.ini = i === 0 ? 0 : t - TR; t = c.ini + c.dur; });
    var duracao = Math.round(t * FPS) / FPS;
    var cenasVideo = cenas.filter(function (c) { return c.tipo === 'video'; });
    var ultima = cenas[cenas.length - 1];

    function desenhar(ctx, tempo) {
      tempo = Math.max(0, Math.min(duracao - 1e-6, tempo));
      FILTRO_ATIVO = filtro;
      ctx.save();
      ctx.fillStyle = M.claro ? COR.papel : COR.tinta; ctx.fillRect(0, 0, W, H);
      for (var i = 0; i < cenas.length; i++) {
        var c = cenas[i], lt = tempo - c.ini;
        if (lt < 0 || lt >= c.dur) continue;
        var prox = cenas[i + 1];
        if (prox && tempo >= prox.ini && i + 1 < cenas.length) { desenharCena(ctx, c, lt, 1); continue; }
        desenharCena(ctx, c, lt, i > 0 ? clamp01(lt / TR) : 1);
      }
      marcaDagua(ctx, S, fechamento ? 1 - clamp01((tempo - ultima.ini) / TR) : 1);
      ctx.restore();
      FILTRO_ATIVO = '';
    }

    function desenharCena(ctx, c, lt, trans) {
      ctx.save();
      var flash = 0;
      if (trans < 1) {
        var e = eio(trans), tipo = c.trans;
        if (tipo === 'modelo') tipo = M.forte ? 'zoom' : M.claro ? 'subir' : 'fade';
        if (tipo === 'fade') ctx.globalAlpha = e;
        else if (tipo === 'subir') { ctx.globalAlpha = e; ctx.translate(0, (1 - e) * 60); }
        else if (tipo === 'deslizar') ctx.translate((1 - e) * W, 0);
        else if (tipo === 'zoom') {
          var s = lerp(1.12, 1, eo(trans));
          ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2);
          ctx.globalAlpha = clamp01(trans * 1.6);
        } else if (tipo === 'cortina') { ctx.beginPath(); ctx.rect(0, 0, e * W, H); ctx.clip(); }
        else if (tipo === 'flash') flash = 1 - trans;
        else if (tipo === 'desfoque') { ctx.globalAlpha = e; ctx.filter = 'blur(' + ((1 - e) * 22).toFixed(1) + 'px)'; }
        /* 'corte': nada — a cena nova cobre a anterior de uma vez */
      }
      CENAS[c.tipo](ctx, lt, c, S);
      if (c.texto && c.tipo !== 'fechamento') {
        ctx.filter = 'none';
        legendaLivre(ctx, c.texto, estiloTexto, entra(lt, 0.25, 0.5) * (lt > c.dur - 0.3 ? clamp01((c.dur - lt) / 0.3) : 1), S);
      }
      if (flash > 0) { ctx.filter = 'none'; ctx.globalAlpha = flash; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); }
      ctx.restore();
    }

    function alvoDe(c, tempo) { return c.clip.de + clamp01((tempo - c.ini) / c.dur) * (c.clip.ate - c.clip.de); }
    function ativo(c, tempo) { return tempo >= c.ini - 0.25 && tempo < c.ini + c.dur; }

    /* prévia: o <video> toca junto, corrigido quando escorrega mais de 0,25 s */
    function sincronizar(tempo, tocando) {
      cenasVideo.forEach(function (c) {
        var el = c.V.el;
        if (!ativo(c, tempo)) { if (!el.paused) el.pause(); return; }
        var alvo = alvoDe(c, tempo);
        if (tocando) {
          if (el.playbackRate !== c.clip.vel) el.playbackRate = c.clip.vel;
          if (el.paused) { try { el.currentTime = alvo; } catch (e) {} var p = el.play(); if (p && p.catch) p.catch(function () {}); }
          else if (Math.abs(el.currentTime - alvo) > 0.25) { try { el.currentTime = alvo; } catch (e) {} }
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - alvo) > 0.03) { try { el.currentTime = alvo; } catch (e) {} }
        }
      });
    }

    /* exportação: cada quadro espera o vídeo chegar no instante exato */
    function quadroExato(tempo) {
      var pend = [];
      cenasVideo.forEach(function (c) {
        var el = c.V.el;
        if (!ativo(c, tempo)) return;
        if (!el.paused) el.pause();
        var alvo = alvoDe(c, tempo);
        if (Math.abs(el.currentTime - alvo) < 0.004 && el.readyState >= 2) return;
        pend.push(new Promise(function (ok) {
          var tm = setTimeout(ok, 4000);
          el.addEventListener('seeked', function h() { el.removeEventListener('seeked', h); clearTimeout(tm); ok(); });
          try { el.currentTime = alvo; } catch (e) { clearTimeout(tm); ok(); }
        }));
      });
      return pend.length ? Promise.all(pend) : null;
    }

    function pararVideos() { cenasVideo.forEach(function (c) { try { c.V.el.pause(); } catch (e) {} }); }

    function quadrosChave() {
      return cenas.map(function (c) {
        var lt = c.tipo === 'antesDepois' ? c.dur - 0.25 : Math.min(c.dur - 0.25, c.tipo === 'video' ? c.dur / 2 : 2.4);
        return Math.min(duracao - 0.05, c.ini + Math.max(0, lt));
      });
    }

    return {
      duracao: duracao, cenas: cenas, desenhar: desenhar, quadrosChave: quadrosChave, modelo: M,
      sincronizar: sincronizar, quadroExato: quadroExato, pararVideos: pararVideos,
      temVideo: cenasVideo.length > 0,
      clipes: cenasVideo.map(function (c) { return { url: c.clip.url, ini: c.ini, dur: c.dur, de: c.clip.de, ate: c.clip.ate, vel: c.clip.vel, vol: c.clip.vol }; }),
      temRastreio: !!(fechamento && (fechamento.qr || fechamento.link))
    };
  }

  /* fontes do vídeo prontas antes do primeiro quadro (senão o canvas
     usa a fonte do sistema e a prévia "pula" quando a fonte chega) */
  function fontesProntas() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var pedidos = ['600 96px Fraunces', 'italic 500 88px Fraunces', 'italic 400 64px Fraunces',
      '400 32px "DM Sans"', '500 32px "DM Sans"', '600 40px "DM Sans"', '700 38px "DM Sans"', '800 116px "DM Sans"',
      '500 28px "DM Mono"'];
    return Promise.race([
      Promise.all(pedidos.map(function (f) { return document.fonts.load(f).catch(function () {}); })),
      new Promise(function (ok) { setTimeout(ok, 6000); })
    ]);
  }

  global.FIELDO = global.FIELDO || {};
  global.FIELDO.StudioMotor = {
    W: W, H: H, FPS: FPS, MODELOS: MODELOS,
    prepararFotos: prepararFotos, preparar: preparar, prepararVideos: prepararVideos, sugerirRoteiro: sugerirRoteiro,
    FILTROS: Object.keys(FILTROS), TRANSICOES: TRANSICOES, VELOCIDADES: VELOCIDADES,
    montar: montar, fontesProntas: fontesProntas, linkLimpo: linkLimpo,
    _quebrar: quebrar
  };
})(window);
