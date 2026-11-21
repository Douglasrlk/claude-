/* ════════════════════════════════════════════════════════════════
   Fieldo Studio · catálogo de trilhas  (v12.43)
   ════════════════════════════════════════════════════════════════
   30 trilhas ORIGINAIS, compostas para vídeo curto de divulgação.
   Cada uma é uma partitura em texto tocada pelo sintetizador de
   studio-trilhas.js: nenhuma amostra, nenhum arquivo de áudio, nada a
   licenciar. Nenhuma melodia aqui é cópia ou variação de música
   existente — os gêneros seguem o que está em alta no Brasil (funk,
   phonk brasileiro, sertanejo, forró e piseiro lideram as paradas e o
   TikTok em 2026) e os estilos mais usados em anúncio curto.

   Regras de composição seguidas em todas:
     · gancho nos 2 primeiros compassos (o vídeo é decidido em 3 s);
     · bateria entra no 2º compasso, com subida quando o gênero pede;
     · nada de grave abaixo de ~45 Hz sem harmônico (celular não toca);
     · fim em acorde que soa até o vídeo acabar (o motor cuida disso).

   Notação: ver o comentário "notação das partituras" em studio-trilhas.js.
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var T = global.FIELDO && global.FIELDO.StudioTrilhas;
  if (!T || !T.registrar) { if (global.console) console.error('[catalogo] carregue studio-trilhas.js antes.'); return; }

  var Q16 = 'x.x.x.x.x.x.x.x.', QUATRO = 'x...x...x...x...', DOIS_QUATRO = '....x.......x...';

  T.registrar([
    /* ── FUNK ───────────────────────────────────────────────────── */
    {
      id: 'funk_baile', nome: 'Baile da Laje', genero: 'Funk', descricao: 'Tamborzão, grave forte e gancho de voz sintética', bpm: 130, ganho: 1.05,
      acordes: ['Dm', 'Dm', 'Bb', 'C'],
      bateria: { bumbo: 'x.....x.x.....x.', tom: ['G3', '..x..x....x..x..'], tom2: ['D4', '...x......x...x.'], palma: DOIS_QUATRO, chimbal: Q16 },
      baixo: { inst: 'oito', padrao: 'R . . . . . R . R . . . . . 5 .', vol: 0.5 },
      harmonia: { inst: 'stab', padrao: 'x.......x.......', vol: 0.05 },
      melodia: { inst: 'chip', vol: 0.07, notas: 'D5 . F5 . A5 . . . G5 . F5 . E5 . D5 . | D5 . . . A4 . . . C5 . D5 . . . . .' },
      subida: true
    },
    {
      id: 'funk_mandelao', nome: 'Pancadão', genero: 'Funk', descricao: 'Funk paulista minimalista, 808 pesado', bpm: 130, ganho: 0.53,
      acordes: ['Em', 'Em', 'C', 'B7'],
      bateria: { bumbo: 'x.........x.....', aro: '....x..x....x...', chimbal: '..x...x...x...x.', palma: '............x...' },
      baixo: { inst: 'oito', padrao: 'R - - - - - - - - - R - - - - -', vol: 0.55 },
      harmonia: { inst: 'pad', vol: 0.025, brilho: 900 },
      melodia: { inst: 'chip', vol: 0.07, notas: 'E5 . . E5 . . G5 . . . F#5 . . . . . | E5 . . B4 . . . . D5 . . C5 . B4 . .' }
    },
    {
      id: 'funk_melody', nome: 'Melody Noturno', genero: 'Funk', descricao: 'Funk melody romântico, teclado e voz de sintetizador', bpm: 125, ganho: 1.08,
      acordes: ['F', 'C', 'Dm', 'Bb'],
      bateria: { bumbo: 'x..x..x...x..x..', palma: DOIS_QUATRO, chimbal: Q16 },
      baixo: { inst: 'baixo', padrao: 'R . . R . . R . R . . R . . 5 .', vol: 0.32 },
      harmonia: { inst: 'epiano', padrao: 'x.......x.......', segura: 2, vol: 0.045 },
      melodia: { inst: 'lead', brilho: 3000, vol: 0.05, notas:
        'A5 - - . G5 . F5 - - . C5 . D5 - F5 . | G5 - - . F5 . E5 - - . C5 - - - . . | F5 - - . A5 . C6 - - . A5 . G5 - F5 . | D5 - - - C5 - - - . . . . . . . .' }
    },
    {
      id: 'phonk_br', nome: 'Fumaça na Pista', genero: 'Phonk', descricao: 'Phonk brasileiro, cowbell e 808 rasgado', bpm: 130, ganho: 0.53,
      acordes: ['Fm', 'Fm', 'Db', 'C'],
      bateria: { bumbo: 'x.....x...x.....', palma: DOIS_QUATRO, chimbal: 'x.xxx.x.x.xxx.x.' },
      baixo: { inst: 'oito', padrao: 'R - - - - - R - - - R - - - - -', vol: 0.55 },
      harmonia: { inst: 'pad', vol: 0.03, brilho: 900 },
      melodia: { inst: 'cowbell', vol: 0.11, entra: 0, notas: 'F5 . F5 . Ab5 . F5 . C6 . Bb5 . Ab5 . G5 . | F5 . F5 . Ab5 . F5 . Eb5 . F5 . C5 . . .' },
      subida: true
    },
    {
      id: 'brega_funk', nome: 'Recife Cintilante', genero: 'Brega funk', descricao: 'Batida quebrada e sintetizador brilhante', bpm: 150, ganho: 1.4,
      acordes: ['Gm', 'Eb', 'Bb', 'F'],
      bateria: { bumbo: 'x..x..x...x.....', palma: DOIS_QUATRO, aro: '..x.....x.x.....', chimbal: Q16 },
      baixo: { inst: 'oito', padrao: 'R . . R . . R . . . R . . . . .', vol: 0.48 },
      harmonia: { inst: 'stab', padrao: QUATRO, vol: 0.04 },
      melodia: { inst: 'lead', brilho: 3600, vol: 0.05, notas: 'D5 . G5 . A5 . Bb5 . A5 . G5 . F5 . D5 . | Eb5 . . . D5 . C5 . D5 - - - . . . .' }
    },

    /* ── FORRÓ, PISEIRO, ARROCHA, SERTANEJO ─────────────────────── */
    {
      id: 'piseiro', nome: 'Pisa no Paredão', genero: 'Piseiro', descricao: 'Teclado de piseiro, tchaca no contratempo', bpm: 155, ganho: 1.16,
      acordes: ['Am', 'F', 'C', 'G'],
      bateria: { bumbo: QUATRO, caixa: '..x...x...x...x.', chimbal: Q16 },
      baixo: { inst: 'baixo', padrao: '. . R . . . 5 . . . R . . . 5 .', vol: 0.32 },
      harmonia: { inst: 'stab', padrao: QUATRO, vol: 0.035 },
      melodia: { inst: 'sanfona', vol: 0.06, notas:
        'E5 . A5 . C6 . B5 . A5 . G5 . E5 . . . | F5 . A5 . C6 . A5 . G5 . E5 . C5 . D5 . | E5 . G5 . C6 . B5 . G5 . E5 . D5 . C5 . | D5 . G5 . B5 . A5 . G5 - - - . . . .' }
    },
    {
      id: 'forro', nome: 'Festa no Sertão', genero: 'Forró', descricao: 'Sanfona, zabumba e triângulo', bpm: 120, ganho: 1.38,
      acordes: ['C', 'F', 'G7', 'C'],
      bateria: { bumbo: 'x.....x...x.....', aro: '..x...x...x...x.', triangulo: 'x.o.x.o.x.o.x.o.' },
      baixo: { inst: 'baixo', padrao: 'R . . . . . 5 . R . . . . . 5 .', vol: 0.3 },
      harmonia: { inst: 'sanfona', padrao: '..x...x...x...x.', segura: 0.3, vol: 0.05 },
      melodia: { inst: 'sanfona', vol: 0.07, notas:
        'G5 . E5 . G5 . C6 - - . B5 . A5 . G5 . | A5 . F5 . A5 . C6 . B5 . A5 . G5 - - . | B4 . D5 . G5 . F5 . E5 . D5 . F5 . E5 . | D5 - - . C5 . . . . . . . . . . .' }
    },
    {
      id: 'arrocha', nome: 'Coração no Arrocha', genero: 'Arrocha', descricao: 'Lento, teclado em arpejo, romântico', bpm: 72, ganho: 1.27,
      acordes: ['Bb', 'Gm', 'Eb', 'F'],
      bateria: { bumbo: 'x.......x.x.....', caixa: DOIS_QUATRO, chimbal: Q16 },
      baixo: { inst: 'baixo', padrao: 'R - - . . . . . R . 5 . . . . .', vol: 0.3 },
      harmonia: { inst: 'arpejo', passos: 1, decai: 0.35, vol: 0.04, fundo: 0.03, ordem: [0, 1, 2, 1, 2, 1, 0, 1] },
      melodia: { inst: 'epiano', vol: 0.075, notas:
        'D5 - - - F5 - D5 - C5 - - - Bb4 - - - | G4 - - - Bb4 - C5 - D5 - - - . . . . | Eb5 - - - D5 - C5 - Bb4 - - - G4 - - - | A4 - - - C5 - - - F4 - - - . . . .' }
    },
    {
      id: 'sertanejo_pop', nome: 'Estrada de Terra', genero: 'Sertanejo', descricao: 'Violão, sanfona e batida de estrada', bpm: 95, ganho: 1.41,
      acordes: ['G', 'D', 'Em', 'C'],
      bateria: { bumbo: 'x.......x.x.....', caixa: DOIS_QUATRO, chimbal: Q16 },
      baixo: { inst: 'baixo', padrao: 'R . . . . . R . 5 . . . . . . .', vol: 0.3 },
      harmonia: { inst: 'violao', padrao: 'x..x..x.x.x.x...', vol: 0.065 },
      melodia: { inst: 'sanfona', vol: 0.06, notas:
        'B4 . D5 . G5 - - . F#5 . E5 . D5 - - . | A4 . D5 . F#5 - - . E5 . D5 . A4 - - . | B4 . E5 . G5 - - . F#5 . G5 . A5 - - . | G5 - - . E5 . D5 - - - . . . . . .' }
    },
    {
      id: 'sertanejo_univ', nome: 'Arrasta pra Cima', genero: 'Sertanejo', descricao: 'Sertanejo universitário animado, de festa', bpm: 150, ganho: 1.32,
      acordes: ['D', 'A', 'Bm', 'G'],
      bateria: { bumbo: QUATRO, caixa: DOIS_QUATRO, chocalho: 'xoxoxoxoxoxoxoxo' },
      baixo: { inst: 'baixo', padrao: 'R . . . 5 . . . R . . . 5 . . .', vol: 0.3 },
      harmonia: { inst: 'violao', padrao: Q16, vol: 0.045, decai: 0.5 },
      melodia: { inst: 'lead', brilho: 2800, vol: 0.05, notas:
        'F#5 . . F#5 . . E5 . F#5 . A5 . . . F#5 . | E5 . . E5 . . C#5 . E5 . A5 . . . . . | D5 . . D5 . . B4 . D5 . F#5 . . . D5 . | G5 . F#5 . E5 . D5 . E5 - - - . . . .' }
    },

    /* ── SAMBA, PAGODE, AXÉ, BOSSA, MPB ─────────────────────────── */
    {
      id: 'pagode', nome: 'Roda de Pagode', genero: 'Pagode', descricao: 'Cavaco, surdo e pandeiro', bpm: 96, ganho: 1.22, swing: 0.18,
      acordes: ['D', 'Bm7', 'Em7', 'A7'],
      bateria: { tom: ['D3', '........x.......'], tom2: ['A3', 'x..x..x...x..x..'], chocalho: 'xoxoxoxoxoxoxoxo', aro: '..x...x...x...x.' },
      baixo: { inst: 'baixo', padrao: 'R . . . . . 5 . R . . . . . 5 .', vol: 0.3 },
      harmonia: { inst: 'violao', padrao: 'x.xx.x.xx.x.x.x.', oitava: 1, vol: 0.04, decai: 0.35 },
      melodia: { inst: 'epiano', vol: 0.07, notas:
        'A5 . F#5 . A5 . B5 - - . A5 . F#5 . E5 . | D5 . F#5 . B5 - - . A5 . G5 . F#5 . E5 . | G5 . E5 . G5 . A5 - - . G5 . E5 . C#5 . | E5 - - . D5 . . . . . . . . . . .' }
    },
    {
      id: 'axe', nome: 'Trio Elétrico', genero: 'Axé', descricao: 'Timbal, metais e muita energia', bpm: 135, ganho: 1.07,
      acordes: ['E', 'A', 'B', 'A'],
      bateria: { bumbo: 'x.......x.......', tom: ['E4', 'x..x..x.x..x..x.'], tom2: ['B3', '..x...x...x...x.'], chimbal: Q16, palma: DOIS_QUATRO },
      baixo: { inst: 'baixo', padrao: 'R . . R . . R . R . . R . . 5 .', vol: 0.3 },
      harmonia: { inst: 'metal', padrao: 'x.....x.....x...', segura: 0.4, vol: 0.05 },
      melodia: { inst: 'lead', brilho: 3200, vol: 0.05, notas:
        'B5 . . G#5 . . E5 . F#5 . G#5 . B5 . . . | C#6 . . A5 . . F#5 . E5 . F#5 . A5 . . . | B5 . . G#5 . . B5 . D#6 . C#6 . B5 . . . | A5 . G#5 . F#5 . E5 - - - . . . . . .' },
      subida: true
    },
    {
      id: 'bossa', nome: 'Tarde no Leblon', genero: 'Bossa nova', descricao: 'Violão de nylon e piano, elegante', bpm: 120, ganho: 1.41, swing: 0.1,
      acordes: ['Fmaj7', 'Gm7', 'C9', 'Fmaj7', 'Bbmaj7', 'Bbm6', 'Am7', 'D7'],
      bateria: { aro: 'x..x..x...x..x..', chimbal: 'oooooooooooooooo', bumbo: 'o.....o.o.....o.' },
      baixo: { inst: 'baixo', padrao: 'R . . . . . 5 . R . . . . . 5 .', vol: 0.26 },
      harmonia: { inst: 'violao', padrao: 'x..x..x...x..x..', vol: 0.05, decai: 0.6 },
      melodia: { inst: 'epiano', vol: 0.07, notas:
        'A5 - - . G5 . F5 . E5 - - - D5 . C5 . | D5 - - - . . . . . . . . . . . . | E5 - - . F5 . G5 . Bb5 - - - A5 . G5 . | F5 - - - . . . . . . . . . . . . | ' +
        'D5 - - . C5 . Bb4 . A4 - - - Bb4 . C5 . | Db5 - - - C5 - - - . . . . . . . . | C5 - - . E5 . G5 . A5 - - - G5 . E5 . | F#5 - - - . . . . . . . . . . . .' }
    },
    {
      id: 'mpb', nome: 'Varanda', genero: 'MPB', descricao: 'Violão dedilhado e assobio, acolhedor', bpm: 88, ganho: 1.16,
      acordes: ['D', 'Bm', 'G', 'A'],
      bateria: { bumbo: 'x.......x.......', aro: DOIS_QUATRO, chocalho: 'o.o.o.o.o.o.o.o.' },
      baixo: { inst: 'baixo', padrao: 'R - - - . . . . 5 - - - . . . .', vol: 0.26 },
      harmonia: { inst: 'arpejo', passos: 2, vol: 0.07, decai: 0.8, ordem: [0, 1, 2, 1, 2, 1, 0, 1] },
      melodia: { inst: 'assobio', vol: 0.06, notas:
        'F#5 - - - A5 - F#5 - E5 - D5 - - - . . | D5 - - - F#5 - D5 - B4 - - - . . . . | G5 - - - B5 - G5 - F#5 - E5 - - - . . | E5 - - - F#5 - E5 - A4 - - - . . . .' }
    },

    /* ── AFRO, AMAPIANO, HOUSE, ELETRÔNICA ──────────────────────── */
    {
      id: 'afro_house', nome: 'Savana Dourada', genero: 'Afro house', descricao: 'Percussão africana, marimba e batida reta', bpm: 122, ganho: 1.05,
      acordes: ['Am', 'Am', 'G', 'F'],
      bateria: { bumbo: QUATRO, chimbalAberto: '..x...x...x...x.', chocalho: 'xoxoxoxoxoxoxoxo', tom: ['A3', '...x..x....x..x.'], tom2: ['E4', 'x.....x.x.....x.'], palma: DOIS_QUATRO },
      baixo: { inst: 'baixo', padrao: '. . R . . . R . . . R . . . 5 .', vol: 0.32 },
      harmonia: { inst: 'pad', vol: 0.035, brilho: 1300 },
      melodia: { inst: 'pluck', vol: 0.11, notas: 'E5 . A5 . . C6 . . B5 . A5 . . G5 . . | E5 . . . G5 . A5 . . . E5 . D5 . . .' },
      contra: { inst: 'sino', vol: 0.06, entra: 3, notas: 'A5 - - - . . . . E6 - - - . . . .' },
      subida: true
    },
    {
      id: 'amapiano', nome: 'Sol de Joburg', genero: 'Amapiano', descricao: 'Log drum, piano jazzístico e chocalho', bpm: 112, ganho: 1.27, swing: 0.12,
      acordes: ['Fm9', 'Bbm9', 'Ebmaj7', 'Db'],
      bateria: { bumbo: 'x.......x.......', chocalho: 'xoxoxoxoxoxoxoxo', aro: '...x..x....x.x..', palma: DOIS_QUATRO },
      baixo: { inst: 'logdrum', padrao: '. . . R . . R . . . . 5 . R . . | . . . R . . R . . . 8 . . 5 . .', vol: 0.5 },
      harmonia: { inst: 'epiano', padrao: 'x.....x.....x...', segura: 1.5, vol: 0.045 },
      melodia: { inst: 'pluck', vol: 0.1, notas: 'C6 . . Ab5 . . F5 . . . Eb5 . F5 . . . | Ab5 . . F5 . . Eb5 . C5 . . . . . . .' }
    },
    {
      id: 'tech_house', nome: 'Galpão', genero: 'House', descricao: 'Tech house com grave saltado', bpm: 125, ganho: 1.29,
      acordes: ['Gm', 'Gm', 'Gm', 'F'],
      bateria: { bumbo: QUATRO, palma: DOIS_QUATRO, chimbalAberto: '..x...x...x...x.', chimbal: 'oooooooooooooooo' },
      baixo: { inst: 'baixo', padrao: '. . R . . . R . . . R R . . R .', vol: 0.34 },
      harmonia: { inst: 'stab', padrao: '...x.....x....x.', vol: 0.07 },
      melodia: { inst: 'chip', vol: 0.06, notas: 'G5 . . . . . Bb5 . . . A5 . . . F5 . | G5 . . . D5 . . . F5 . . . G5 . . .' },
      subida: true
    },
    {
      id: 'deep_house', nome: 'Fim de Tarde', genero: 'House', descricao: 'Deep house macio, acordes que respiram', bpm: 120, ganho: 1.15,
      acordes: ['Cm7', 'Cm7', 'Fm7', 'Fm7'],
      bateria: { bumbo: QUATRO, palma: DOIS_QUATRO, chimbalAberto: '..x...x...x...x.', chocalho: 'o.o.o.o.o.o.o.o.' },
      baixo: { inst: 'baixo', padrao: 'R . . R . . . . R . . R . . 5 .', vol: 0.32 },
      harmonia: { inst: 'padBomba', vol: 0.05, brilho: 1800 },
      melodia: { inst: 'epiano', vol: 0.07, notas: 'G5 - - . Eb5 . . . C5 - - . Bb4 . . . | C5 - - . Eb5 . F5 . G5 - - - . . . .' }
    },
    {
      id: 'future_bass', nome: 'Céu de Neon', genero: 'Eletrônica', descricao: 'Acordes largos que pulsam, gancho brilhante', bpm: 150, ganho: 0.6,
      acordes: ['Fmaj7', 'G', 'Em7', 'Am'],
      bateria: { bumbo: 'x.........x.....', caixa: '........x.......', chimbal: Q16 },
      baixo: { inst: 'oito', padrao: 'R - - - - - - - - - R - - - - -', vol: 0.45 },
      harmonia: { inst: 'padBomba', vol: 0.06, brilho: 3200 },
      melodia: { inst: 'chip', vol: 0.06, notas: 'E5 . G5 . C6 . E6 . D6 . C6 . A5 . G5 . | G5 . A5 . C6 . D6 . E6 - - . D6 . C6 .' },
      subida: true
    },
    {
      id: 'tropical', nome: 'Brisa', genero: 'Eletrônica', descricao: 'Tropical house, marimba e assobio', bpm: 104, ganho: 1.24,
      acordes: ['Em', 'C', 'G', 'D'],
      bateria: { bumbo: QUATRO, palma: DOIS_QUATRO, chocalho: 'xoxoxoxoxoxoxoxo' },
      baixo: { inst: 'baixo', padrao: 'R . . . . . R . . . R . . . . .', vol: 0.3 },
      harmonia: { inst: 'pad', vol: 0.04, brilho: 1400 },
      melodia: { inst: 'pluck', vol: 0.11, notas: 'B5 . G5 . E5 . G5 . B5 . . A5 . G5 . . | E5 . G5 . A5 . . . G5 . E5 . D5 . . .' },
      contra: { inst: 'assobio', vol: 0.05, entra: 3, notas: 'B5 - - - A5 - G5 - E5 - - - . . . . | G5 - - - A5 - B5 - D6 - - - B5 - - -' }
    },
    {
      id: 'synthwave', nome: 'Avenida Retrô', genero: 'Eletrônica', descricao: 'Anos 80, baixo em colcheias e lead cantado', bpm: 100, ganho: 1.32,
      acordes: ['Am', 'F', 'C', 'G'],
      bateria: { bumbo: QUATRO, caixa: DOIS_QUATRO, chimbal: 'xoxoxoxoxoxoxoxo' },
      baixo: { inst: 'baixo', padrao: 'R . R . R . R . R . R . R . R .', vol: 0.28 },
      harmonia: { inst: 'pad', vol: 0.045, brilho: 2200 },
      melodia: { inst: 'lead', brilho: 3500, vol: 0.05, notas: 'E5 - - - A5 - - - B5 - C6 - B5 - A5 - | G5 - - - - - - - E5 - - - D5 - - -' }
    },
    {
      id: 'jersey_club', nome: 'Pulo', genero: 'Jersey club', descricao: 'Bumbo saltado, o ritmo das trends de dança', bpm: 140, ganho: 1.2,
      acordes: ['Dm', 'Bb', 'F', 'C'],
      bateria: { bumbo: 'x..x..x.x.x.x...', palma: DOIS_QUATRO, chimbal: Q16 },
      baixo: { inst: 'oito', padrao: 'R . . . . . R . . . . . R . . .', vol: 0.45 },
      harmonia: { inst: 'stab', padrao: 'x.......x.......', vol: 0.05 },
      melodia: { inst: 'chip', vol: 0.06, notas: 'A5 . . A5 . . F5 . A5 . . C6 . . A5 . | G5 . . G5 . . E5 . F5 . . D5 . . . .' },
      subida: true
    },

    /* ── POP, REGGAETON, TRAP, LO-FI ─────────────────────────────── */
    {
      id: 'reggaeton', nome: 'Calor', genero: 'Reggaeton', descricao: 'Dembow clássico e melodia latina', bpm: 95, ganho: 1.33,
      acordes: ['Am', 'F', 'C', 'G'],
      bateria: { bumbo: QUATRO, caixa: '...x..x....x..x.', chimbal: Q16 },
      baixo: { inst: 'baixo', padrao: 'R . . R . . R . R . . R . . R .', vol: 0.32 },
      harmonia: { inst: 'pad', vol: 0.035, brilho: 1600 },
      melodia: { inst: 'pluck', vol: 0.11, notas:
        'A5 . . C6 . . B5 . A5 . . E5 . . G5 . | F5 . . A5 . . G5 . F5 . . C5 . . E5 . | E5 . . G5 . . F5 . E5 . . C5 . . D5 . | D5 . . G5 . . F5 . E5 - - - . . . .' }
    },
    {
      id: 'trap', nome: 'Subindo', genero: 'Trap', descricao: 'Trap motivacional, 808 e sino', bpm: 140, ganho: 0.6,
      acordes: ['Cm', 'Ab', 'Eb', 'Bb'],
      bateria: { bumbo: 'x.........x.x...', caixa: '........x.......', chimbal: 'x.x.xxx.x.x.x.xx' },
      baixo: { inst: 'oito', padrao: 'R - - - - - - - - - R - - - 5 -', vol: 0.5 },
      harmonia: { inst: 'pad', vol: 0.045, brilho: 1200 },
      melodia: { inst: 'sino', vol: 0.1, notas: 'G5 . . . Eb5 . . . C5 . . . Eb5 . G5 . | Ab5 . . . G5 . . . Eb5 . . . . . . .' },
      contra: { inst: 'metal', vol: 0.04, entra: 3, notas: 'C5 - - - - - - - Bb4 - - - - - - -' }
    },
    {
      id: 'lofi', nome: 'Café e Chuva', genero: 'Lo-fi', descricao: 'Lo-fi tranquilo, piano e chiado de vinil', bpm: 80, ganho: 1.36, swing: 0.22,
      acordes: ['Fmaj7', 'Em7', 'Dm7', 'Cmaj7'],
      bateria: { bumbo: 'x.......x.x.....', caixa: '....o.......o...', chimbal: Q16 },
      baixo: { inst: 'baixo', padrao: 'R - - . . . . . 5 - - . . . . .', vol: 0.26 },
      harmonia: { inst: 'epiano', padrao: 'x.......x.......', segura: 1.8, vol: 0.045 },
      melodia: { inst: 'pluck', vol: 0.09, notas: 'A5 . . . G5 . E5 . . . C5 . D5 . . . | G5 . . . E5 . D5 . . . B4 . C5 . . . | F5 . . . E5 . C5 . . . A4 . B4 . . . | E5 - - - . . . . . . . . . . . .' },
      vinil: 0.025
    },
    {
      id: 'pop_ensolarado', nome: 'Dia Bom', genero: 'Pop', descricao: 'Pop alegre de comercial, palmas e piano', bpm: 116, ganho: 1.32,
      acordes: ['C', 'Am', 'F', 'G'],
      bateria: { bumbo: 'x.......x.x.....', palma: DOIS_QUATRO, chimbal: Q16 },
      baixo: { inst: 'baixo', padrao: 'R . . . R . . . R . . . 5 . . .', vol: 0.3 },
      harmonia: { inst: 'epiano', padrao: 'x..x..x.x..x..x.', segura: 0.6, vol: 0.035 },
      melodia: { inst: 'lead', brilho: 2600, vol: 0.045, notas: 'G5 . E5 . G5 . C6 . . . B5 . A5 . G5 . | A5 . F5 . A5 . C6 . . . D6 . C6 - - .' }
    },

    /* ── MARCA, CORPORATIVO, CINEMA ─────────────────────────────── */
    {
      id: 'ukulele', nome: 'Bom Dia, Cliente', genero: 'Alegre', descricao: 'Ukulele, palmas e assobio de comercial', bpm: 120, ganho: 1.43,
      acordes: ['C', 'G', 'Am', 'F'],
      bateria: { bumbo: 'x.......x.......', palma: DOIS_QUATRO, chocalho: 'xoxoxoxoxoxoxoxo' },
      baixo: { inst: 'baixo', padrao: 'R . . . . . . . 5 . . . . . . .', vol: 0.26 },
      harmonia: { inst: 'violao', padrao: 'x...x.xx..x.x.x.', oitava: 1, vol: 0.045, decai: 0.5 },
      melodia: { inst: 'assobio', vol: 0.055, notas:
        'E5 . G5 . C6 - - . B5 . G5 . A5 - - . | D5 . G5 . B5 - - . A5 . G5 . E5 - - . | C5 . E5 . A5 - - . G5 . E5 . F5 - - . | F5 . A5 . C6 - - . D6 . C6 . G5 - - .' },
      contra: { inst: 'sino', vol: 0.05, entra: 2, notas: 'C6 . . . . . . . G5 . . . . . . .' }
    },
    {
      id: 'corporativo', nome: 'Novo Projeto', genero: 'Corporativo', descricao: 'Inspirador, piano em colcheias que cresce', bpm: 110, ganho: 1.38,
      acordes: ['D', 'A', 'Bm', 'G'],
      bateria: { bumbo: 'x.......x.......', palma: DOIS_QUATRO, chimbal: 'o.o.o.o.o.o.o.o.' },
      baixo: { inst: 'baixo', padrao: 'R . . . . . . . R . . . . . . .', vol: 0.28 },
      harmonia: { inst: 'arpejo', passos: 2, vol: 0.06, decai: 0.5, fundo: 0.03 },
      melodia: { inst: 'epiano', vol: 0.07, notas:
        'F#5 - - - E5 - D5 - E5 - - - A4 - - - | D5 - - - C#5 - B4 - C#5 - - - . . . . | B4 - - - C#5 - D5 - F#5 - - - E5 - D5 - | D5 - - - E5 - - - D5 - - - . . . .' },
      subida: true
    },
    {
      id: 'cinematico', nome: 'Grande Obra', genero: 'Cinemático', descricao: 'Épico, tambores e metais', bpm: 90, ganho: 0.94,
      acordes: ['Dm', 'Bb', 'F', 'C'],
      bateria: { tom: ['D3', 'x..x..x.x..x..x.'], tom2: ['A3', DOIS_QUATRO], bumbo: 'x.......x.......' },
      baixo: { inst: 'baixo', padrao: 'R - - - - - - - R - - - - - - -', vol: 0.3 },
      harmonia: { inst: 'metal', padrao: 'x...............', segura: 4, vol: 0.05, fundo: 0.04 },
      melodia: { inst: 'metal', vol: 0.05, notas:
        'A4 - - - D5 - - - F5 - - - E5 - D5 - | D5 - - - C5 - - - Bb4 - - - A4 - - - | F5 - - - A5 - - - C6 - - - Bb5 - A5 - | G5 - - - E5 - - - C5 - - - . . . .' },
      subida: true
    },
    {
      id: 'rock', nome: 'Ligado no 220', genero: 'Rock', descricao: 'Guitarra distorcida e bateria de garagem', bpm: 140, ganho: 1.27,
      acordes: ['E5', 'A5', 'B5', 'A5'],
      bateria: { bumbo: 'x.....x.x.......', caixa: DOIS_QUATRO, chimbal: Q16 },
      baixo: { inst: 'baixo', padrao: 'R . R . R . R . R . R . R . R .', vol: 0.28 },
      harmonia: { inst: 'guitarra', padrao: Q16, segura: 0.45, vol: 0.05 },
      melodia: { inst: 'lead', brilho: 3000, vol: 0.04, notas: 'E5 . G5 . A5 . . . B5 . . . A5 . G5 . | E5 . . . D5 . E5 . . . . . . . . .' },
      final: 'guitarra'
    },
    {
      id: 'natal', nome: 'Luzes da Cidade', genero: 'Natal', descricao: 'Fim de ano: sinos, guizos e alegria', bpm: 130, ganho: 1.38,
      acordes: ['G', 'C', 'D', 'G', 'Em', 'C', 'D7', 'G'],
      bateria: { bumbo: 'x.......x.......', palma: DOIS_QUATRO, guizo: Q16 },
      baixo: { inst: 'baixo', padrao: 'R . . . 5 . . . R . . . 5 . . .', vol: 0.28 },
      harmonia: { inst: 'epiano', padrao: QUATRO, segura: 0.9, vol: 0.035 },
      melodia: { inst: 'sino', vol: 0.09, notas:
        'D5 . G5 . G5 . A5 . B5 - - . G5 . . . | E5 . C6 . C6 . B5 . A5 - - . . . . . | F#5 . A5 . A5 . B5 . C6 - - . A5 . . . | B5 . G5 . G5 . A5 . G5 - - . . . . . | ' +
        'B5 . A5 . G5 . E5 . G5 - - . D5 . . . | E5 . F#5 . G5 . A5 . B5 - - . . . . . | C6 . B5 . A5 . G5 . A5 - - . E5 . . . | D5 . F#5 . A5 . F#5 . G5 - - - . . . .' },
      final: 'sino'
    }
  ]);
})(window);
