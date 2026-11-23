/* Fieldo · rabisco animado (v12.34): seis profissionais trabalhando.
   v12.35 · avisa quando o serviço fica pronto (fieldo:rabisco-pronto, com a
   "foto" recortada) e aceita data-fixa="pintor" para páginas de uma profissão.
   Encanador, eletricista, pintor, pedreiro, diarista e técnico de
   ar-condicionado, no mesmo traço e com a mesma figura. Cada visita
   começa por um sorteado (sem repetir o da visita anterior); depois de
   terminar o serviço, o desenho se apaga e entra o próximo. Na home,
   escolher ou escrever a profissão no formulário troca o desenho para
   ela e ele para de alternar ("o desenho vira você").
   Tudo é calculado a partir do tempo t (segundos), sem CSS animation:
   o mesmo código anima a página e gera quadros fixos (imagem do link,
   prévia em vídeo). Respeita "reduzir movimento": quadro final parado. */
(function () {
  var svg = document.getElementById('rabisco');
  if (!svg) return;

  var OURO = 'var(--rab-ouro, #9a7218)', FUNDO = 'var(--rab-fundo, #f0ece3)';
  var DESENHO = 2.6, INICIO = DESENHO + .2, APAGA = .75, SEGURA = 1.3;
  var lim = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var suave = function (x) { x = lim(x, 0, 1); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  var sai = function (x) { x = lim(x, 0, 1); return 1 - Math.pow(1 - x, 3); };
  var rad = function (g) { return g * Math.PI / 180; };
  var f1 = function (n) { return Math.round(n * 10) / 10; };
  var mix = function (a, b, k) { return a + (b - a) * k; };
  var P = function (x, y) { return { x: x, y: y }; };
  var gira = function (v, g) { var c = Math.cos(rad(g)), s = Math.sin(rad(g)); return P(v.x * c - v.y * s, v.x * s + v.y * c); };
  var soma = function (a, b, k) { k = k == null ? 1 : k; return P(a.x + b.x * k, a.y + b.y * k); };
  var dist = function (a, b) { return Math.hypot(b.x - a.x, b.y - a.y); };
  var ang = function (a, b) { return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; };
  var tr = function (p, g) { return 'translate(' + f1(p.x) + ' ' + f1(p.y) + ')' + (g ? ' rotate(' + f1(g) + ')' : ''); };
  /* traço que se desenha: pathLength=1, o motor anima o dashoffset */
  var p = function (d, extra) { return '<path pathLength="1" d="' + d + '"' + (extra || '') + '/>'; };
  var g = function (ini, dur, miolo, extra) { return '<g data-d="' + ini + ',' + dur + '"' + (extra || '') + '>' + miolo + '</g>'; };
  /* um passo de um serviço repetido 3 vezes: força, volta, pausa */
  function passos(u, um, n) { var i = Math.floor(u / um); return { i: Math.min(i, n), k: u - i * um, fim: i >= n }; }

  /* ── a figura: a mesma em todas as cenas, muda o que vai na cabeça ── */
  var QUEIXO = 'M94 88C93 104 103 117 117 117C131 118 142 108 143 93L143 89';
  var CABECAS = {
    bone: [ 'M93 87C93 68 108 58 122 59C137 60 146 72 146 85', 'M93 87C110 83 129 82 146 84C155 83 163 84 170 88C162 91 151 90 143 88', QUEIXO ],
    virado: [ 'M93 87C93 68 108 58 122 59C137 60 146 72 146 85', 'M93 87C110 83 129 82 146 84', 'M96 86C89 85 82 86 77 90C83 93 90 92 96 89', 'M132 84C134 79 141 79 143 84', QUEIXO ],
    capacete: [ 'M90 89C89 66 105 53 121 54C139 55 150 68 150 88', 'M84 90C106 85 134 85 160 89C152 93 96 93 84 90', 'M101 71C111 61 131 60 142 69', QUEIXO ],
    chapeu: [ 'M98 81C97 66 108 58 121 58C134 58 144 66 144 81', 'M98 80C112 83 130 83 144 80', 'M79 86C94 80 148 79 164 86C153 91 91 91 79 86', QUEIXO ],
    coque: [ 'M94 90C91 72 103 60 119 60C135 60 146 71 146 86', 'M88 61C96 58 103 63 103 71C103 79 96 83 88 80C81 77 80 65 88 61', 'M95 93C101 83 111 77 123 76C132 76 140 79 145 85', 'M95 92C94 100 96 106 100 110', QUEIXO ],
    curto: [ 'M93 92C89 72 102 59 119 59C135 59 146 69 146 85', 'M95 91C99 80 108 74 120 73C130 72 139 75 145 81', 'M97 92L99 99', QUEIXO ],
  };
  var ROSTO = [ 'M107 92C102 90 101 100 107 101', 'M128 91L137 90', 'M133 96.5L133.6 97.2', 'M143 97C147 100 146 103 141 104', 'M129 108C132 110.5 136 110.5 139 108' ];
  var CORPO = [ 'M110 116L111 125', 'M126 116L126 124', 'M111 124C96 127 87 140 86 160C85 190 88 225 90 252',
    'M126 124C141 126 152 136 155 155C158 185 159 225 158 252', 'M111 124L118 136L126 124', 'M89 246C112 250 138 250 158 246' ];
  var PERNAS = [ 'M91 252L93 300', 'M157 252L155 300', 'M123 262L124 300' ];
  var S0 = P(136, 138);                 /* ombro */

  function figura(c) {
    var cab = CABECAS[c.cabeca].map(function (d) { return p(d); }).join('');
    var brinco = c.cabeca === 'coque' ? p('M107.5 104.5a1.6 1.6 0 1 0 0.1 0', ' stroke="' + OURO + '" stroke-width="2.4"') : '';
    return '<g transform="translate(' + (c.fx || 0) + ' 0)"><g id="rabCabeca">' + g(.45, .7, cab) + g(.95, .45, ROSTO.map(function (d) { return p(d); }).join('') + brinco, ' stroke-width="2.2"') + '</g>' +
      g(.95, 1.3, CORPO.map(function (d) { return p(d); }).join('') + p('M117 244L128 244L128 252L117 252Z', ' stroke-width="2.2"') + PERNAS.map(function (d) { return p(d); }).join('')) +
      (c.roupa ? g(1.55, .55, c.roupa, ' stroke-width="2"') : '') + '</g>';
  }
  var BRACO = '<g id="rabBraco" opacity="0"><path id="rabBracoFundo" fill="' + FUNDO + '" stroke="none" d=""/>' +
    '<path id="rabBracoA" d=""/><path id="rabBracoB" d=""/><path id="rabManga" d="" stroke-width="2.2"/></g>';
  /* mão fechada, centrada na origem; o eixo x é o do cabo que ela segura */
  var MAO = '<g id="rabMao" opacity="0"><path fill="' + FUNDO + '" d="M-9.5 -9C-9.5 -14 7.5 -14 8.5 -8L9.5 8C8.5 13 -8.5 13 -9.5 8Z"/>' +
    '<path d="M-3.5 -11L-3.5 11" stroke-width="2"/><path d="M2.5 -11.5L2.5 11.5" stroke-width="2"/></g>';

  /* braço por cinemática inversa de dois ossos: ombro fixo, mão no cabo */
  function desenharBraco(H) {
    var S = P(S0.x + (cena.fx || 0), S0.y), L1 = 55, L2 = 54;
    var dx = H.x - S.x, dy = H.y - S.y, d0 = Math.hypot(dx, dy) || 1, d = lim(d0, Math.abs(L1 - L2) + .5, L1 + L2 - .5);
    var a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    var ux = dx / d0, uy = dy / d0;
    var px = -uy, py = ux; if (py < 0) { px = -px; py = -py; }      /* cotovelo para baixo */
    var E = P(S.x + a * ux + h * px, S.y + a * uy + h * py);
    var n = function (A, B) { var x = B.x - A.x, y = B.y - A.y, m = Math.hypot(x, y) || 1; return P(-y / m, x / m); };
    var n1 = n(S, E), n2 = n(E, H), nE = P((n1.x + n2.x) / 2, (n1.y + n2.y) / 2);
    var W = P(E.x + (H.x - E.x) * .9, E.y + (H.y - E.y) * .9);
    var Q = function (A, v, k) { return f1(A.x + v.x * k) + ' ' + f1(A.y + v.y * k); };
    var a1 = Q(S, n1, 10.5), a2 = Q(E, nE, 7.8), a3 = Q(W, n2, 6.2), b1 = Q(S, n1, -10.5), b2 = Q(E, nE, -7.8), b3 = Q(W, n2, -6.2);
    el.BracoA.setAttribute('d', 'M' + a1 + 'L' + a2 + 'L' + a3);
    el.BracoB.setAttribute('d', 'M' + b1 + 'L' + b2 + 'L' + b3);
    el.BracoFundo.setAttribute('d', 'M' + a1 + 'L' + a2 + 'L' + a3 + 'L' + b3 + 'L' + b2 + 'L' + b1 + 'Z');
    var C = P(S.x + (E.x - S.x) * .62, S.y + (E.y - S.y) * .62);
    el.Manga.setAttribute('d', 'M' + Q(C, n1, 11.5) + 'L' + Q(C, n1, -11.5));
  }
  function arcoEm(C, r, g0, g1) {
    var a = soma(C, P(Math.cos(rad(g0)), Math.sin(rad(g0))), r), b = soma(C, P(Math.cos(rad(g1)), Math.sin(rad(g1))), r);
    return 'M' + f1(a.x) + ' ' + f1(a.y) + 'A' + r + ' ' + r + ' 0 0 ' + (g1 > g0 ? 1 : 0) + ' ' + f1(b.x) + ' ' + f1(b.y);
  }
  /* "pronto": o check dourado com três risquinhos, em (x, y) */
  function pronto(x, y) {
    var t = function (a, b, c, d) { return '<path d="M' + (x + a) + ' ' + (y + b) + 'L' + (x + c) + ' ' + (y + d) + '" stroke-width="2"/>'; };
    return '<g id="rabPronto" stroke="' + OURO + '" opacity="0"><path id="rabCheck" pathLength="1" d="M' + x + ' ' + (y + 16) + 'L' + (x + 10) + ' ' + (y + 27) +
      'L' + (x + 32) + ' ' + y + '" stroke-width="3.2"/>' + t(40, -2, 47, -8) + t(42, 10, 51, 9) + t(32, -14, 34, -22) + '</g>';
  }
  function verPronto(u, ini, fim) {
    var check = lim((u - ini) / .35, 0, 1), op = u < ini ? 0 : u < fim - .4 ? 1 : lim((fim - u) / .4, 0, 1);
    el.Pronto.setAttribute('opacity', op);
    el.Check.style.strokeDasharray = '1 1'; el.Check.style.strokeDashoffset = String(1 - check);
  }
  var $s = function (id) { return svg.querySelector('#' + id); };

  /* ════════════════════════ AS CENAS ════════════════════════ */
  var CENAS = [];

  /* 1 · ENCANADOR: aperta os parafusos de uma flange (o desenho original) */
  (function () {
    var B = P(279.9, 172), MAO_R = 70, A0 = 160, A1 = 190, UM = 1.02;
    var sext = 'M324.5 106 L331 109.8 L331 117.2 L324.5 121 L318 117.2 L318 109.8 Z';
    CENAS.push({
      foto: [238, 70, 166],
      id: 'encanador', nome: 'Encanador', busca: 'encanador', cabeca: 'bone', ciclo: 4.8, pico: 3 * UM + .35,
      chaves: /encanad|hidraul|bombeiro|vazamento|desentup|mecanic|montador|solda|caldeir/,
      arte: function () {
        return g(0, .7, p('M318 88C352 88 380 116 380 150C380 184 352 212 318 212C284 212 256 184 256 150C256 116 282 89 321 90') +
            p('M369 114C380 114 392 113 404 113') + p('M369 186C380 186 392 187 404 187') +
            p('M318 132C328 132 336 140 336 150C336 160 328 168 318 168C308 168 300 160 300 150C300 141 307 133 319 133')) +
          g(.35, .6, ['-6.5 -7.5', '32 14.5', '32 58.5', '-6.5 80.5', '-44.6 14.5'].map(function (t) { return p(sext, ' transform="translate(' + t + ')"'); }).join(''), ' stroke-width="2.2"');
      },
      ferramenta: function () {
        return '<g id="rabParafuso" stroke="' + OURO + '">' + g(1.35, .35, p('M0 -9.5L8.2 -4.75L8.2 4.75L0 9.5L-8.2 4.75L-8.2 -4.75Z')) + '</g>' +
          '<g id="rabChave" stroke="' + OURO + '">' + g(1.5, .7, p('M-12.3 -10.3A16 16 0 1 1 -12.3 10.3') + p('M-12.3 10.3L2 8.6Q6 0 2 -8.6L-12.3 -10.3') +
            p('M14 -5.2L90 -4.2') + p('M14 5.2L90 4.2') + p('M90 -4.2C94 -10 106 -11 109 -3C112 5 104 11 97 9C93 8 91 6 90 4.2') +
            p('M99 -3.5L104 -1L104 3.5L99 5L95 2L95 -1Z', ' stroke-width="2"')) + '</g>';
      },
      frente: function () {
        return '<path id="rabRastro" d="" stroke="' + OURO + '" stroke-width="2.2" opacity="0"/><path id="rabRastro2" d="" stroke="' + OURO + '" stroke-width="2" opacity="0"/>' + pronto(204, 72);
      },
      mov: function (u, volta) {
        var r = { ang: A0, gira: volta * 90, rastro: 0 }, APERTO = .42, VOLTA = .5, esf = 0, fimR = false;
        var s = passos(u, UM, 3);
        if (!s.fim) {
          if (s.k < APERTO) { var e = suave(s.k / APERTO); r.ang = A0 + (A1 - A0) * e; r.gira += s.i * 30 + 30 * e; r.rastro = lim(s.k / APERTO * 1.4, 0, 1); esf = Math.sin(Math.PI * s.k / APERTO); }
          else if (s.k < APERTO + VOLTA) { r.ang = A1 - (A1 - A0) * suave((s.k - APERTO) / VOLTA); r.gira += (s.i + 1) * 30; r.rastro = 1 - lim((s.k - APERTO) / .25, 0, 1); fimR = true; }
          else r.gira += (s.i + 1) * 30;
        } else r.gira += 90;
        el.rabChave.setAttribute('transform', tr(B, r.ang));
        el.rabParafuso.setAttribute('transform', tr(B, r.gira));
        if (r.rastro > 0) {
          var fim = fimR ? A1 : r.ang, o = fimR ? r.rastro : lim(r.rastro * 2, 0, 1);
          el.rabRastro.setAttribute('d', arcoEm(B, 58, Math.max(A0 - 4, fim - 26), fim - 8));
          el.rabRastro2.setAttribute('d', arcoEm(B, 46, Math.max(A0 - 4, fim - 22), fim - 10));
          el.rabRastro.setAttribute('opacity', o); el.rabRastro2.setAttribute('opacity', o * .7);
        } else { el.rabRastro.setAttribute('opacity', 0); el.rabRastro2.setAttribute('opacity', 0); }
        verPronto(u, 3 * UM, this.ciclo);
        return { H: soma(B, P(Math.cos(rad(r.ang)), Math.sin(rad(r.ang))), MAO_R), mao: r.ang, esforco: esf };
      },
    });
  })();

  /* 2 · ELETRICISTA: aperta o parafuso do interruptor e a lâmpada acende */
  (function () {
    var T = P(270, 158), UM = 1.02, A = -10, LUZ = P(350, 99);
    var FIO = 'M270 148L270 66C270 61 273 58 278 58L350 58';
    CENAS.push({
      foto: [234, 42, 172],
      id: 'eletricista', nome: 'Eletricista', busca: 'eletricista', cabeca: 'capacete', ciclo: 5.4, pico: 3 * UM + .95,
      chaves: /eletric/,
      roupa: p('M131 150L146 150L146 165L131 165Z') + p('M135 150L135 141', ' stroke="' + OURO + '"'),
      tras: function () { return '<circle id="rabBrilho" cx="' + LUZ.x + '" cy="' + LUZ.y + '" r="30" fill="rgba(212,171,64,.26)" stroke="none" opacity="0"/>'; },
      arte: function () {
        return g(0, .6, p('M255 147L285 147C287 147 288 148 288 150L288 210C288 212 287 213 285 213L255 213C253 213 252 212 252 210L252 150C252 148 253 147 255 147') +
            p('M262 169L278 169L278 191L262 191Z', ' stroke-width="2.2"') + p('M270 204m-3.6 0a3.6 3.6 0 1 0 7.2 0a3.6 3.6 0 1 0 -7.2 0', ' stroke-width="1.8"') + p('M267.6 204L272.4 204', ' stroke-width="1.6"')) +
          g(.3, .7, p(FIO, ' stroke-width="1.8"') + p('M350 40L350 70') + p('M343 70L357 70L357 82L343 82Z', ' stroke-width="2.2"') +
            p('M344 82C335 88 332 98 336 106C339 112 345 115 350 115C355 115 361 112 364 106C368 98 365 88 356 82') +
            p('M345 97L347.5 101L350 97L352.5 101L355 97', ' stroke="' + OURO + '" stroke-width="1.8"')) +
          '<g data-ap=".45"><path id="rabTecla" d="M265 174L275 174" stroke-width="2"/></g>' +
          '<path id="rabPulso" d="' + FIO + '" pathLength="1" stroke="' + OURO + '" stroke-width="3.6" stroke-dasharray="0.08 1.2" stroke-dashoffset="0.08" opacity="0"/>';
      },
      ferramenta: function () {
        return '<g id="rabParaf" transform="translate(270 158)">' + g(.9, .3, p('M0 0m-3.6 0a3.6 3.6 0 1 0 7.2 0a3.6 3.6 0 1 0 -7.2 0', ' stroke-width="1.8"')) + '<g data-ap="1.15"><path id="rabFenda" d="M-2.4 0L2.4 0" stroke-width="1.6"/></g></g>' +
          '<g id="rabChave">' + g(1.5, .7, p('M-1 -1.2L-30 -1.6M-1 1.2L-30 1.6', ' stroke-width="2"') + p('M-30 -3L-35 -3L-35 3L-30 3Z', ' stroke-width="2"') +
            p('M-35 -5.5C-38 -7.5 -60 -7.5 -63 -5.5C-65.5 -3 -65.5 3 -63 5.5C-60 7.5 -38 7.5 -35 5.5Z', ' stroke="' + OURO + '"')) +
          '<g data-ap="2"><path id="rabSulco1" d="" stroke="' + OURO + '" stroke-width="1.6"/><path id="rabSulco2" d="" stroke="' + OURO + '" stroke-width="1.6"/></g></g>';
      },
      frente: function () {
        var raios = [-160, -125, -55, -20, 15, 165, 50, 130].map(function (a) {
          var c = Math.cos(rad(a)), s = Math.sin(rad(a));
          return 'M' + f1(LUZ.x + 25 * c) + ' ' + f1(LUZ.y + 25 * s) + 'L' + f1(LUZ.x + 34 * c) + ' ' + f1(LUZ.y + 34 * s);
        }).join('');
        return '<path id="rabRaios" pathLength="1" d="' + raios + '" stroke="' + OURO + '" stroke-width="2.2" opacity="0"/>' + pronto(292, 134);
      },
      mov: function (u) {
        var GIRO = .42, s = passos(u, UM, 3), a = A, fenda = 0, sulco = 0, esf = 0;
        if (!s.fim) {
          var e = s.k < GIRO ? suave(s.k / GIRO) : 1;
          fenda = (s.i + e) * 90; sulco = s.i + e;
          if (s.k < GIRO) { a = A + 4 * Math.sin(Math.PI * e); esf = .6 * Math.sin(Math.PI * s.k / GIRO); }
          else if (s.k < GIRO + .5) a = A - 1.5 * Math.sin(Math.PI * (s.k - GIRO) / .5);
        } else { fenda = 270; sulco = 3; }
        el.rabChave.setAttribute('transform', tr(T, a));
        el.rabFenda.setAttribute('transform', 'rotate(' + f1(fenda + 20) + ')');
        [el.rabSulco1, el.rabSulco2].forEach(function (s2, j) {
          var y = ((sulco * 1.5 + j * .5) % 1) * 11 - 5.5, o = 1 - Math.abs(y) / 5.5;
          s2.setAttribute('d', 'M-61 ' + f1(y) + 'L-37 ' + f1(y)); s2.setAttribute('opacity', f1(lim(o * 1.6, 0, 1)));
        });
        var q = u - 3 * UM, liga = lim(q / .15, 0, 1), fimC = this.ciclo;
        var apaga = u > fimC - .4 ? lim((fimC - u) / .4, 0, 1) : 1;
        el.rabTecla.setAttribute('d', 'M265 ' + f1(mix(174, 186, liga)) + 'L275 ' + f1(mix(174, 186, liga)));
        var pulso = lim((q - .1) / .45, 0, 1);
        el.rabPulso.setAttribute('opacity', q > .1 && pulso < 1 ? 1 : 0);
        el.rabPulso.style.strokeDashoffset = String(f1((.08 - pulso * 1.08) * 100) / 100);
        var acesa = lim((q - .55) / .25, 0, 1) * apaga;
        el.rabBrilho.setAttribute('opacity', f1(acesa * 10) / 10);
        el.rabRaios.setAttribute('opacity', f1(acesa * 10) / 10);
        el.rabRaios.style.strokeDasharray = '1 1'; el.rabRaios.style.strokeDashoffset = String(1 - lim((q - .55) / .3, 0, 1));
        verPronto(u, 3 * UM + .6, fimC);
        return { H: soma(T, gira(P(-49, 0), a)), mao: a, esforco: esf };
      },
    });
  })();

  /* 3 · PINTOR: rolo no cabo de extensão, três faixas na parede */
  (function () {
    var X = [262, 300, 338], ALTO = 88, BAIXO = 200, H0 = P(204, 172), COL = 1.28;
    CENAS.push({
      foto: [230, 58, 172],
      id: 'pintor', nome: 'Pintor', busca: 'pintor', cabeca: 'virado', ciclo: 5.6, pico: 3 * COL + .35,
      chaves: /pintor|pintura|textura|grafiato|gesseir|drywall/,
      roupa: [P(103, 178), P(141, 206), P(113, 222), P(146, 172)].map(function (c) { return p('M' + c.x + ' ' + c.y + 'm-1.4 0a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0', ' stroke="' + OURO + '" stroke-width="2.6"'); }).join(''),
      tras: function () {
        return X.map(function (x, i) { return '<rect id="rabTinta' + i + '" x="' + (x - 18) + '" y="' + BAIXO + '" width="36" height="0" rx="5" fill="rgba(184,136,13,.22)" stroke="none"/>'; }).join('');
      },
      arte: function () {
        return g(0, .6, p('M398 46L398 262') + p('M178 262L398 262') + p('M178 271L398 271', ' stroke-width="2"')) +
          g(.4, .6, p('M300 279C300 275 334 275 334 279C334 283 300 283 300 279') + p('M300 279L302 300') + p('M334 279L332 300') +
            p('M300 279C300 266 334 266 334 279', ' stroke-width="1.8"') + p('M306 281C306 287 309 289 309 293', ' stroke="' + OURO + '" stroke-width="2.2"'), ' stroke-width="2.2"');
      },
      ferramenta: function () {
        return g(1.5, .5, '<path id="rabCabo" pathLength="1" d="" stroke-width="2.6"/><path id="rabArmacao" pathLength="1" d="" stroke-width="2.2"/>') +
          '<g id="rabRolo">' + g(1.6, .5, p('M-19 -7C-19 -9 -18 -10 -16 -10L16 -10C18 -10 19 -9 19 -7L19 7C19 9 18 10 16 10L-16 10C-18 10 -19 9 -19 7Z', ' fill="rgba(184,136,13,.42)"'), ' stroke="' + OURO + '"') +
          '<g data-ap="2"><path id="rabFelpa1" d="" stroke="' + OURO + '" stroke-width="1.5"/><path id="rabFelpa2" d="" stroke="' + OURO + '" stroke-width="1.5"/></g></g>';
      },
      frente: function () { return pronto(350, 66); },
      mov: function (u) {
        var c = Math.floor(u / COL), k = u - c * COL, R, esf = 0, fimC = this.ciclo;
        if (c >= 3) { R = P(X[2], 160); }
        else {
          var x = X[c];
          if (k < .55) { var e = suave(k / .55); R = P(x, mix(BAIXO, ALTO, e)); esf = .5 * Math.sin(Math.PI * k / .55); }
          else if (k < 1.0) R = P(x, mix(ALTO, 160, suave((k - .55) / .45)));
          else { var m = suave((k - 1) / .28); R = c < 2 ? P(mix(x, X[c + 1], m), mix(160, BAIXO, m) - 14 * Math.sin(Math.PI * m)) : P(x, 160); }
        }
        if (u <= 0) R = P(X[0], BAIXO);
        var apaga = u > fimC - .4 ? lim((fimC - u) / .4, 0, 1) : 1;
        X.forEach(function (x, i) {
          var r = el['rabTinta' + i], topo = i < c || c >= 3 ? ALTO : i === c ? (k < .55 ? R.y : ALTO) : null;
          if (u <= 0) topo = null;
          var y0 = topo == null ? BAIXO : topo - 10, alt = topo == null ? 0 : BAIXO + 10 - y0;
          r.setAttribute('y', f1(y0)); r.setAttribute('height', f1(Math.max(0, alt))); r.setAttribute('opacity', f1(apaga * 10) / 10);
        });
        var H = P(H0.x + (R.x - X[0]) * .32, H0.y + (R.y - 144) * .3);
        var uU = P(R.x - H.x, R.y - H.y), m2 = Math.hypot(uU.x, uU.y); uU = P(uU.x / m2, uU.y / m2);
        var J = soma(R, uU, -18), K = soma(H, uU, -16);
        el.rabCabo.setAttribute('d', 'M' + f1(K.x) + ' ' + f1(K.y) + 'L' + f1(J.x) + ' ' + f1(J.y));
        el.rabArmacao.setAttribute('d', 'M' + f1(J.x) + ' ' + f1(J.y) + 'L' + f1(R.x - 25) + ' ' + f1(R.y) + 'L' + f1(R.x - 19) + ' ' + f1(R.y));
        el.rabRolo.setAttribute('transform', tr(R));
        var rola = (BAIXO - R.y) / 9;
        [el.rabFelpa1, el.rabFelpa2].forEach(function (f, j) { var y = ((rola + j * .5) % 1 + 1) % 1 * 18 - 9; f.setAttribute('d', 'M-16 ' + f1(y) + 'L16 ' + f1(y)); });
        verPronto(u, 3 * COL, fimC);
        return { H: H, mao: ang(H, R), esforco: esf };
      },
    });
  })();

  /* 4 · PEDREIRO: passa a massa com a colher e assenta três tijolos */
  (function () {
    /* o braço alcança uns 110 px do ombro: a fiada de cima já tem dois
       tijolos e ele assenta os dois que faltam, ao alcance da colher */
    var LARG = 32, ALT = 14, PASSO = 17, BASE = 267, XN = [248, 283], YN = BASE - 6 * PASSO, UM = 1.2, A = 5;
    var PONTA = P(58, 14);
    var fim = [398, 386, 370, 352, 338, 322, 246];
    function fiada(y, ini, x1) {
      var d = '', x = ini;
      for (; x < x1 - 4; x += LARG + 3) { var xa = Math.max(x, 178), xb = Math.min(x + LARG, x1); if (xb - xa < 8) continue; d += 'M' + xa + ' ' + y + 'H' + xb + 'V' + (y + ALT) + 'H' + xa + 'Z'; }
      return d;
    }
    function tijolo(x, y) { return 'M' + x + ' ' + y + 'H' + (x + LARG) + 'V' + (y + ALT) + 'H' + x + 'Z'; }
    CENAS.push({
      foto: [196, 110, 174],
      id: 'pedreiro', nome: 'Pedreiro', busca: 'pedreiro', cabeca: 'chapeu', ciclo: 4.4, pico: 2 * UM + .35, fx: 12,
      chaves: /pedreir|alvenar|mestre de obra|constru|empreit|azulej|assentador|reboc|obra/,
      arte: function () {
        var linhas = '';
        for (var r = 0; r < 7; r++) linhas += g((r * .1).toFixed(2), .45, p(fiada(BASE - r * PASSO, r % 2 ? 178 - 17 : 178, fim[r]), ' stroke-width="1.8"'));
        return g(0, .5, p('M174 284L402 284')) + linhas;
      },
      tras: function () {
        return XN.map(function (x, i) {
          return '<path id="rabMassa' + i + '" pathLength="1" d="M' + x + ' ' + (YN + ALT + 1.5) + 'c6 -2.4 10 2 16 0s10 2.2 16 0" stroke="' + OURO + '" stroke-width="2.6" stroke-dasharray="1 1" stroke-dashoffset="1"/>' +
            '<path id="rabNovo' + i + '" d="' + tijolo(x, YN) + '" stroke-width="2" opacity="0"/>';
        }).join('');
      },
      ferramenta: function () {
        return '<g id="rabChave">' + g(1.5, .6, p('M-15 -4C-15 -6 -14 -7 -12 -7L10 -6C12 -6 13 -5 13 -3L13 3C13 5 12 6 10 6L-12 7C-14 7 -15 6 -15 4Z') +
          p('M13 0C18 0 21 2 23 6', ' stroke-width="2.2"') + p('M22 5L' + PONTA.x + ' ' + PONTA.y + 'L23 19Z', ' stroke="' + OURO + '" stroke-width="2.2" fill="rgba(184,136,13,.14)"')) + '</g>';
      },
      frente: function () { return pronto(306, 112); },
      mov: function (u) {
        var s = passos(u, UM, 2), ponta, esf = 0, fimC = this.ciclo, base = YN + ALT + 1.5;
        var apaga = u > fimC - .4 ? lim((fimC - u) / .4, 0, 1) : 1;
        if (u <= 0) ponta = P(XN[0] - 6, base);
        else if (!s.fim) {
          var x = XN[s.i];
          if (s.k < .45) { ponta = P(mix(x - 4, x + LARG + 2, suave(s.k / .45)), base); esf = .4 * Math.sin(Math.PI * s.k / .45); }
          else if (s.k < .72) ponta = P(mix(x + LARG + 2, x + LARG / 2 + 4, suave((s.k - .45) / .27)), mix(base, YN - 6, suave((s.k - .45) / .27)));
          else { var b = (s.k - .72) / .28; ponta = P(x + LARG / 2 + 4, YN - 6 + 5 * Math.sin(Math.PI * lim(b * 1.6, 0, 1))); }
        } else ponta = P(XN[1] + LARG / 2 + 4, YN - 8);
        XN.forEach(function (x, i) {
          var feito = u <= 0 ? -1 : s.fim ? 1 : i < s.i ? 1 : i > s.i ? -1 : 0;
          var massa = feito > 0 ? 1 : feito < 0 ? 0 : lim(s.k / .45, 0, 1);
          var queda = feito > 0 ? 1 : feito < 0 ? 0 : sai((s.k - .45) / .22);
          var assenta = feito === 0 && s.k > .72 ? 1.2 * Math.sin(Math.PI * lim((s.k - .72) / .2, 0, 1)) : 0;
          var m = el['rabMassa' + i], n = el['rabNovo' + i];
          m.style.strokeDashoffset = String(f1((1 - massa) * 100) / 100); m.setAttribute('opacity', f1(apaga * 10) / 10);
          n.setAttribute('opacity', f1(lim(queda * 3, 0, 1) * apaga * 10) / 10);
          n.setAttribute('transform', 'translate(0 ' + f1(-16 * (1 - queda) + assenta) + ')');
        });
        var H = soma(ponta, gira(PONTA, A), -1);
        el.rabChave.setAttribute('transform', tr(H, A));
        verPronto(u, 2 * UM, fimC);
        return { H: H, mao: A, esforco: esf };
      },
    });
  })();

  /* 5 · DIARISTA: puxa a água do chão com o rodo, o chão brilha */
  (function () {
    var H0 = P(205, 190), CABO = 120, Y = 279, X0 = 238, X1 = 306, UM = 1.05;
    function estrela(x, y, r) { return 'M' + x + ' ' + (y - r) + 'Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y + 'Q' + x + ' ' + y + ' ' + x + ' ' + (y + r) + 'Q' + x + ' ' + y + ' ' + (x - r) + ' ' + y + 'Q' + x + ' ' + y + ' ' + x + ' ' + (y - r) + 'Z'; }
    var BRILHOS = [P(232, 258), P(278, 248), P(322, 262)];
    CENAS.push({
      foto: [214, 118, 182],
      id: 'diarista', nome: 'Diarista', busca: 'diarista', cabeca: 'coque', ciclo: 5.1, pico: 3 * UM + .5,
      chaves: /diarist|faxin|limpeza|passadeir|domestic|lavadeir|camareir|organizador/,
      roupa: p('M97 170C111 174 133 174 149 170L151 238C134 242 112 242 95 238Z') + p('M106 136C108 148 109 160 109 171') + p('M132 136C132 148 133 160 135 171') + p('M111 196C119 198 127 198 135 196L134 210C126 212 118 212 112 210Z', ' stroke-width="1.8"'),
      tras: function () { return '<path id="rabMolhado" d="" fill="rgba(184,136,13,.16)" stroke="none"/>'; },
      arte: function () {
        return g(0, .5, p('M168 284L402 284')) +
          g(.3, .6, p('M350 246L392 246L388 284L354 284Z') + p('M348 246C348 242 394 242 394 246') + p('M352 246C354 228 388 228 390 246', ' stroke-width="1.8"') +
            p('M354 254C363 257 378 251 388 254', ' stroke="' + OURO + '" stroke-width="2"'), ' stroke-width="2.2"');
      },
      ferramenta: function () {
        return g(1.5, .45, '<path id="rabCabo" pathLength="1" d="" stroke-width="2.6"/>') +
          '<g id="rabRodo">' + g(1.55, .5, p('M-25 -4L25 -4L25 2L-25 2Z', ' stroke-width="2.2"') + p('M-23 2L-23 5L23 5L23 2', ' stroke="' + OURO + '" stroke-width="2"') + p('M-4 -4L-3 -10L3 -10L4 -4', ' stroke-width="2"')) + '</g>';
      },
      frente: function () {
        return '<g id="rabBrilhos" stroke="' + OURO + '" stroke-width="2" fill="rgba(212,171,64,.35)">' +
          BRILHOS.map(function (b, i) { return '<path id="rabBrilho' + i + '" d="' + estrela(0, 0, i === 1 ? 9 : 6.5) + '" opacity="0"/>'; }).join('') + '</g>' + pronto(306, 118);
      },
      mov: function (u) {
        var s = passos(u, UM, 3), bx, alto = 0, esf = 0, fimC = this.ciclo, molhado = X0 - 26;
        var apaga = u > fimC - .4 ? lim((fimC - u) / .4, 0, 1) : 1;
        if (u <= 0) bx = X0;
        else if (!s.fim) {
          if (s.k < .6) { bx = mix(X0, X1, suave(s.k / .6)); esf = .4 * Math.sin(Math.PI * s.k / .6); }
          else if (s.k < .95) { var v = suave((s.k - .6) / .35); bx = mix(X1, X0, v); alto = 7 * Math.sin(Math.PI * v); }
          else bx = X0;
        } else bx = X0 + 10;
        var limpo = u <= 0 ? 0 : s.fim ? 1 : (s.i + (s.k < .6 ? suave(s.k / .6) : 1)) / 3;
        var x1 = mix(X0 + 25, X1 + 25, lim(limpo * 3, 0, 1));
        el.rabMolhado.setAttribute('d', limpo > 0 ? 'M' + molhado + ' 280C' + (molhado + 30) + ' 277 ' + (x1 - 30) + ' 277 ' + f1(x1) + ' 279L' + f1(x1) + ' 284L' + molhado + ' 284Z' : '');
        el.rabMolhado.setAttribute('opacity', f1((s.fim ? lim(1 - (u - 3 * UM) / 1.2, .25, 1) : 1) * apaga * 10) / 10);
        var B = P(bx, Y - alto), T = P(bx, Y - 10 - alto);
        el.rabRodo.setAttribute('transform', tr(B));
        var uU = P(T.x - H0.x, T.y - H0.y), m2 = Math.hypot(uU.x, uU.y); uU = P(uU.x / m2, uU.y / m2);
        var H = soma(T, uU, -CABO);
        el.rabCabo.setAttribute('d', 'M' + f1(H.x - uU.x * 12) + ' ' + f1(H.y - uU.y * 12) + 'L' + f1(T.x) + ' ' + f1(T.y));
        var q = u - 3 * UM;
        BRILHOS.forEach(function (b, i) {
          var e = lim((q - i * .12) / .3, 0, 1), sc = e < 1 ? sai(e) * 1.15 : 1 + .08 * Math.sin((q - i * .12) * 6);
          var n = el['rabBrilho' + i];
          n.setAttribute('opacity', q > 0 ? f1(lim(e * 2, 0, 1) * apaga * 10) / 10 : 0);
          n.setAttribute('transform', 'translate(' + b.x + ' ' + b.y + ') scale(' + f1(Math.max(.01, sc) * 100) / 100 + ')');
        });
        verPronto(u, 3 * UM + .2, fimC);
        return { H: H, mao: ang(H, T), esforco: esf };
      },
    });
  })();

  /* 6 · TÉCNICO DE AR-CONDICIONADO: liga pelo controle, abre a aleta, sai o ar frio */
  (function () {
    var H0 = P(222, 152), A = -38, UM = .9, ALETA = P(311, 112);
    var ONDAS = [266, 300, 334].map(function (x) { return 'M' + x + ' 126C' + (x - 6) + ' 140 ' + (x + 6) + ' 152 ' + x + ' 166C' + (x - 6) + ' 180 ' + (x + 6) + ' 192 ' + x + ' 206'; });
    function floco(x, y, r) { var d = ''; for (var i = 0; i < 3; i++) { var a = rad(90 + i * 60), c = Math.cos(a) * r, s = Math.sin(a) * r; d += 'M' + f1(x - c) + ' ' + f1(y - s) + 'L' + f1(x + c) + ' ' + f1(y + s); } return d; }
    CENAS.push({
      foto: [226, 54, 180],
      id: 'ar', nome: 'Ar-condicionado', busca: 'técnico de ar-condicionado', cabeca: 'curto', ciclo: 4.8, pico: 2 * UM + .95,
      chaves: /ar.?condicionado|refrigera|climatiza|split|\bar\b/,
      roupa: p('M131 150L147 150L147 161L131 161Z', ' stroke-width="1.8"') + p(floco(139, 155.5, 3.6), ' stroke="' + OURO + '" stroke-width="1.4"'),
      arte: function () {
        return g(0, .7, p('M236 66L386 66C390 66 392 68 392 72L392 112C392 116 390 118 386 118L236 118C232 118 230 116 230 112L230 72C230 68 232 66 236 66') +
          p('M244 82L316 82', ' stroke-width="1.8"') + p('M244 90L296 90', ' stroke-width="1.8"') + p('M372 80m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', ' stroke-width="1.8"')) +
          g(.5, .4, p('M392 98C398 98 400 102 400 108L400 140', ' stroke-width="1.8"'));
      },
      tras: function () {
        return '<circle id="rabLed" cx="372" cy="80" r="2.6" fill="' + OURO + '" stroke="none" opacity="0"/>' +
          '<g id="rabAr" opacity="0" stroke-width="2">' + ONDAS.map(function (d, i) { return '<path id="rabOnda' + i + '" d="' + d + '" pathLength="1" stroke-dasharray=".16 .1"/>'; }).join('') + '</g>';
      },
      ferramenta: function () {
        return '<g data-ap=".6"><path id="rabAleta" d="M240 112L382 112" stroke-width="2.2" fill="' + FUNDO + '"/></g>' +
          '<g id="rabChave">' + g(1.5, .5, p('M-7 -4C-7 -5.5 -6 -6 -4.5 -6L31 -5C33 -5 34 -4 34 -2.5L34 2.5C34 4 33 5 31 5L-4.5 6C-6 6 -7 5.5 -7 4Z', ' stroke-width="2.2"') +
            p('M25 0m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', ' stroke="' + OURO + '" stroke-width="2"') + p('M14 -1.6L14.4 -1.6M14 1.6L14.4 1.6M18 -1.6L18.4 -1.6M18 1.6L18.4 1.6', ' stroke-width="1.8"')) +
          '<g id="rabSinal" stroke="' + OURO + '" stroke-width="2" opacity="0"><path d="' + arcoEm(P(35, 0), 6, -40, 40) + '"/><path d="' + arcoEm(P(35, 0), 12, -40, 40) + '"/><path d="' + arcoEm(P(35, 0), 18, -40, 40) + '"/></g></g>';
      },
      frente: function () { return '<path id="rabFloco" pathLength="1" d="' + floco(300, 228, 10) + '" stroke="' + OURO + '" stroke-width="2.4" opacity="0"/>' + pronto(352, 146); },
      mov: function (u, volta, t) {
        var s = passos(u, UM, 3), H = H0, esf = 0, sinal = 0, fimC = this.ciclo;
        var apaga = u > fimC - .4 ? lim((fimC - u) / .4, 0, 1) : 1;
        if (u > 0 && !s.fim) {
          if (s.k < .14) H = soma(H0, gira(P(6, 0), A), suave(s.k / .14));
          else if (s.k < .4) H = soma(H0, gira(P(6, 0), A), 1 - suave((s.k - .14) / .26));
          sinal = s.k > .08 && s.k < .55 ? Math.sin(Math.PI * (s.k - .08) / .47) : 0;
          esf = .3 * Math.sin(Math.PI * lim(s.k / .4, 0, 1));
        }
        el.rabChave.setAttribute('transform', tr(H, A));
        el.rabSinal.setAttribute('opacity', f1(sinal * 10) / 10);
        var led = u > .15 ? 1 : 0, abre = sai((u - UM - .12) / .4), ar = lim((u - 2 * UM - .1) / .35, 0, 1);
        el.rabLed.setAttribute('opacity', led * apaga);
        var yA = f1(112 + 9 * abre * apaga);
        el.rabAleta.setAttribute('d', 'M240 112L382 112L' + (382 - 3 * abre * apaga) + ' ' + yA + 'L' + (240 + 3 * abre * apaga) + ' ' + yA + 'Z');
        el.rabAr.setAttribute('opacity', f1(ar * apaga * 10) / 10);
        for (var i = 0; i < 3; i++) el['rabOnda' + i].style.strokeDashoffset = String(f1((-(t || u) * .35 - i * .07) * 100) / 100);
        var fl = lim((u - 2 * UM - .4) / .4, 0, 1);
        el.rabFloco.setAttribute('opacity', fl > 0 ? apaga : 0);
        el.rabFloco.style.strokeDasharray = '1 1'; el.rabFloco.style.strokeDashoffset = String(1 - fl);
        verPronto(u, 2 * UM + .6, fimC);
        return { H: H, mao: A, esforco: esf };
      },
    });
  })();

  /* ════════════════════════ O MOTOR ════════════════════════ */
  var DEFS = '<defs><filter id="rabTremor" x="-4%" y="-4%" width="108%" height="108%">' +
    '<feTurbulence id="rabRuido" type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="1" result="n"/>' +
    '<feDisplacementMap in="SourceGraphic" in2="n" scale="1.7" xChannelSelector="R" yChannelSelector="G"/></filter></defs>';
  var cena = null, el = {}, grupos = [], aparece = [], volta = 0;

  function montar(c) {
    svg.innerHTML = DEFS + '<g filter="url(#rabTremor)" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<g id="rabEfeitos">' + (c.tras ? c.tras() : '') + '</g>' + c.arte() + figura(c) + BRACO + c.ferramenta() + MAO + c.frente() + '</g>';
    el = {};
    Array.prototype.forEach.call(svg.querySelectorAll('[id]'), function (n) { el[n.id] = n; el[n.id.replace(/^rab/, '')] = n; });
    grupos = Array.prototype.map.call(svg.querySelectorAll('[data-d]'), function (gr) {
      var d = gr.getAttribute('data-d').split(',').map(Number);
      var ps = Array.prototype.slice.call(gr.querySelectorAll('path[pathLength]')).filter(function (x) { return x.closest('[data-d]') === gr; });
      ps.forEach(function (x) { x.style.strokeDasharray = '1 1'; });
      var n = ps.length, cada = n > 1 ? d[1] * .35 : d[1], passo = n > 1 ? (d[1] - cada) / (n - 1) : 0;
      return { ps: ps, ini: d[0], cada: cada, passo: passo };
    });
    aparece = Array.prototype.map.call(svg.querySelectorAll('[data-ap]'), function (x) { return { el: x, ini: +x.getAttribute('data-ap') }; });
    cena = c; volta = 0;
    svg.setAttribute('data-cena', c.id);
  }

  /* um quadro: t é o tempo da cena; apagar (0..1) recolhe o traço */
  function quadro(t, semTremor, apagar) {
    apagar = apagar || 0;
    grupos.forEach(function (gr, j) {
      var a = lim((apagar * APAGA - (grupos.length - 1 - j) * .02) / (APAGA * .55), 0, 1);
      gr.ps.forEach(function (x, i) {
        var pr = lim((t - gr.ini - i * gr.passo) / gr.cada, 0, 1) * (1 - a);
        x.style.strokeDashoffset = String(f1((1 - pr) * 1000) / 1000);
        x.style.opacity = pr > 0 ? '1' : '0';
      });
    });
    var vis = lim(1 - apagar * 2.2, 0, 1);
    var bra = lim((t - 1.75) / .5, 0, 1) * vis;
    el.Braco.setAttribute('opacity', bra); el.Mao.setAttribute('opacity', bra);
    el.Efeitos.setAttribute('opacity', vis);
    aparece.forEach(function (a) { a.el.setAttribute('opacity', f1(lim((t - a.ini) / .25, 0, 1) * vis * 10) / 10); });
    var u = t - INICIO, n = u > 0 ? Math.floor(u / cena.ciclo) : 0;
    var m = cena.mov(u > 0 ? u - n * cena.ciclo : 0, n, t);
    desenharBraco(m.H);
    el.Mao.setAttribute('transform', tr(m.H, m.mao));
    el.Cabeca.setAttribute('transform', 'rotate(' + f1(-3 * (m.esforco || 0)) + ' 118 118)');
    if (vis < 1) el.Pronto.setAttribute('opacity', Math.min(+el.Pronto.getAttribute('opacity') || 0, vis));
    if (el.Ruido) el.Ruido.setAttribute('seed', semTremor ? 3 : (Math.floor(t * 6) % 6) + 1);
  }
  function finalDe(c) { return INICIO + c.pico + .25; }

  /* v12.35 · a "foto" do serviço feito: uma cópia do desenho como está
     agora, recortada no trabalho (sem os ids, sem o tremido) */
  function miniatura() {
    var c = svg.cloneNode(true), f = cena.foto || [72, 40, 260];
    Array.prototype.forEach.call(c.querySelectorAll('[id]'), function (n) { n.removeAttribute('id'); });
    Array.prototype.forEach.call(c.querySelectorAll('[filter]'), function (n) { n.removeAttribute('filter'); });
    Array.prototype.forEach.call(c.querySelectorAll('defs'), function (n) { n.parentNode.removeChild(n); });
    ['id', 'class', 'data-cena', 'data-fixa', 'style'].forEach(function (a) { c.removeAttribute(a); });
    c.setAttribute('viewBox', f[0] + ' ' + f[1] + ' ' + f[2] + ' ' + f[2]);
    c.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    return c.outerHTML;
  }

  /* ── ordem: sorteio, sem repetir a última vista ── */
  var LS = 'fieldo_rabisco_ultimo', ultimo = null;
  try { ultimo = localStorage.getItem(LS); } catch (e) {}
  var ids = CENAS.map(function (c) { return c.id; });
  function embaralha(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  var fila = embaralha(ids.slice());
  if (fila[0] === ultimo && fila.length > 1) fila.push(fila.shift());
  var pos = 0;
  function porId(id) { for (var i = 0; i < CENAS.length; i++) if (CENAS[i].id === id) return CENAS[i]; return null; }

  /* ── legenda (na home): nome da profissão e um ponto por desenho ── */
  var leg = document.getElementById('rabNome'), pontos = document.getElementById('rabPontos');
  if (pontos) pontos.innerHTML = fila.map(function () { return '<i></i>'; }).join('');
  var fixa = false;
  function avisar() {
    try { localStorage.setItem(LS, cena.id); } catch (e) {}
    if (leg) leg.textContent = cena.nome;
    if (pontos) { pontos.hidden = fixa; Array.prototype.forEach.call(pontos.children, function (x, i) { x.className = fila[i] === cena.id ? 'vez' : ''; }); }
    try { document.dispatchEvent(new CustomEvent('fieldo:rabisco', { detail: { id: cena.id, nome: cena.nome, busca: cena.busca, fixa: fixa } })); } catch (e) {}
  }

  var parado = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var t = 0, apagando = -1, proxima = null, ultimoT = null, rodando = false, ultimoQuadro = 0, naTela = true;
  var entrada = 0, feito = '';
  function entrar(c) { montar(c); t = 0; apagando = -1; proxima = null; entrada++; if (parado) quadro(finalDe(c), true); else quadro(0); avisar(); }
  /* serviço pronto (uma vez por volta): a home põe a "foto" no cartão da prévia */
  function conferirPronto() {
    var u = t - INICIO; if (apagando >= 0 || u <= 0) return;
    var n = Math.floor(u / cena.ciclo), k = u - n * cena.ciclo, chave = entrada + ':' + n;
    if (k < cena.pico || k > cena.pico + .6 || feito === chave) return;
    feito = chave;
    try { document.dispatchEvent(new CustomEvent('fieldo:rabisco-pronto', { detail: { id: cena.id, nome: cena.nome, svg: miniatura() } })); } catch (e) {}
  }
  function trocarPara(c) {
    if (!c || (cena && c.id === cena.id && apagando < 0)) return;
    if (parado || !rodando || t < .3) { entrar(c); return; }
    proxima = c; if (apagando < 0) apagando = 0;
  }
  function seguinte() { pos = (pos + 1) % fila.length; return porId(fila[pos]); }

  function passo(agora) {
    if (!rodando) return;
    if (ultimoT === null) ultimoT = agora;
    var dt = Math.min(.1, (agora - ultimoT) / 1000); ultimoT = agora;
    t += dt;
    if (apagando >= 0) {
      apagando += dt / APAGA;
      if (apagando >= 1) { entrar(proxima || seguinte()); }
    } else if (!fixa && t >= INICIO + cena.pico + SEGURA) { proxima = seguinte(); apagando = 0; }
    if (agora - ultimoQuadro >= 32) { ultimoQuadro = agora; quadro(t, false, Math.max(0, apagando)); conferirPronto(); }
    requestAnimationFrame(passo);
  }
  function iniciar() { if (rodando || parado) return; rodando = true; ultimoT = null; requestAnimationFrame(passo); }
  function pausar() { rodando = false; }

  /* profissão escrita no formulário → desenho dela, parado nela */
  function normaliza(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function cenaDoTexto(s) {
    s = normaliza(s).trim(); if (s.length < 3) return null;
    for (var i = 0; i < CENAS.length; i++) if (CENAS[i].chaves.test(s)) return CENAS[i];
    return null;
  }
  function profissao(texto) {
    var c = cenaDoTexto(texto);
    if (c) {
      var mudou = !fixa; fixa = true;
      var k = fila.indexOf(c.id); if (k >= 0) pos = k;
      /* se o desenho da vez já é o dela mas está se apagando para o
         próximo, ele volta: apaga e se desenha de novo nela */
      if (cena && c.id === cena.id) { if (apagando >= 0) proxima = c; if (mudou) avisar(); } else trocarPara(c);
      return c.id;
    }
    if (fixa) { fixa = false; if (cena) avisar(); if (parado) return null; if (t >= INICIO + cena.pico + SEGURA) { proxima = seguinte(); apagando = 0; } }
    return null;
  }

  /* começa: desenho sorteado (ou o da profissão que já veio no formulário) */
  var campo = document.getElementById('lp2Prof'), daPagina = porId(svg.getAttribute('data-fixa'));
  var inicial = daPagina || (campo && cenaDoTexto(campo.value)) || porId(fila[0]);
  if (daPagina || (campo && cenaDoTexto(campo.value))) { fixa = true; pos = Math.max(0, fila.indexOf(inicial.id)); }
  montar(inicial);
  quadro(finalDe(inicial), true);
  svg.classList.add('rab-pronto');

  window.FieldoRabisco = {
    quadro: function (tt, semTremor, ap) { quadro(tt, semTremor, ap); }, iniciar: iniciar, pausar: pausar,
    mostrar: function (id) { var c = porId(id); if (c) { montar(c); quadro(finalDe(c), true); } return c ? { final: finalDe(c), ciclo: c.ciclo, pico: c.pico } : null; },
    profissao: function (x) { return daPagina ? daPagina.id : profissao(x); }, proxima: function () { if (!fixa) trocarPara(seguinte()); },
    miniatura: miniatura,
    cenas: ids, DESENHO: DESENHO, INICIO: INICIO, APAGA: APAGA,
    get atual() { return cena && cena.id; }, get fixa() { return fixa; }, get rodando() { return rodando; }, get CICLO() { return cena.ciclo; }, get FINAL() { return finalDe(cena); },
  };
  if (window.__rabiscoManual) return;
  avisar();
  if (parado) return;
  /* toque no desenho: o próximo (no computador, clique) */
  var fig = svg.closest('figure') || svg;
  if (!daPagina) fig.addEventListener('click', function () { if (!fixa) trocarPara(seguinte()); });
  quadro(0);
  if ('IntersectionObserver' in window) {
    naTela = false;
    new IntersectionObserver(function (es) {
      es.forEach(function (e) { naTela = e.isIntersecting; if (naTela) iniciar(); else pausar(); });
    }, { threshold: .2 }).observe(svg);
  } else iniciar();
  document.addEventListener('visibilitychange', function () { if (document.hidden) pausar(); else if (naTela) iniciar(); });
})();
