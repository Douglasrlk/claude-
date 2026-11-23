// Confere a notação de todas as trilhas do catálogo do Studio.
// Rodar: node infra/tests/trilhas.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(readFileSync(join(raiz, 'site/studio-trilhas.js'), 'utf8'), ctx);
const T = ctx.FIELDO.StudioTrilhas;
const defs = [];
const registrarReal = T.registrar;
T.registrar = (lista) => { defs.push(...lista); return registrarReal(lista); };
vm.runInContext(readFileSync(join(raiz, 'site/studio-trilhas-catalogo.js'), 'utf8'), ctx);

let n = 0;
const caso = (nome, fn) => { fn(); n++; console.log('ok', nome); };

caso('notação básica', () => {
  assert.equal(T._nota('C4'), 60); assert.equal(T._nota('A4'), 69); assert.equal(T._nota('Bb3'), 58); assert.equal(T._nota('F#5'), 78);
  assert.deepEqual(Array.from(T._acorde('Am').notas), [57, 60, 64]);
  assert.deepEqual(Array.from(T._acorde('Cmaj7').notas), [60, 64, 67, 71]);
  assert.throws(() => T._linha('C4 . .'), /precisa de 16/);
  const l = T._linha('C4 - - . E4 . . . G4 - . . . . . .');
  assert.equal(l.ev.length, 3); assert.equal(l.ev[0].dur, 3); assert.equal(l.ev[2].dur, 2);
});

const ids = new Set();
caso(`catálogo tem ${defs.length} trilhas novas (pedido: 30)`, () => assert.ok(defs.length >= 30));
for (const d of defs) {
  caso(`${d.id} — ${d.nome} (${d.genero}, ${d.bpm} bpm)`, () => {
    assert.match(d.id, /^[a-z0-9_]{2,32}$/);
    assert.ok(!ids.has(d.id), 'id repetido'); ids.add(d.id);
    assert.ok(d.nome && d.descricao && d.genero && d.bpm >= 60 && d.bpm <= 180);
    d.acordes.forEach((a) => T._acorde(a));
    for (const [k, v] of Object.entries(d.bateria || {})) {
      const r = Array.isArray(v) ? (T._nota(v[0]), v[1]) : v;
      const s = r.replace(/[\s|]/g, '');
      assert.equal(s.length % 16, 0, `bateria ${k} com ${s.length} passos`);
      assert.match(s, /^[xo.]+$/, `bateria ${k} com caractere inválido`);
    }
    if (d.baixo) T._linha(d.baixo.padrao).ev.forEach((e) => assert.match(e.v, /^(R|b2|2|b3|3|4|b5|5|b6|6|b7|7|8|9|-5|-8|[A-G](#|b)?-?\d)$/, 'grau ' + e.v));
    for (const mel of [d.melodia, d.contra].filter(Boolean)) {
      const L = T._linha(mel.notas);
      assert.ok(L.ev.length >= (mel === d.melodia ? 4 : 1), 'melodia curta demais');
      L.ev.forEach((e) => { const x = T._nota(e.v); assert.ok(x >= 45 && x <= 96, `nota fora da região: ${e.v}`); });
    }
    if (d.harmonia && d.harmonia.padrao) assert.equal(d.harmonia.padrao.replace(/[\s|]/g, '').length % 16, 0);
  });
}
caso('lista do Studio: originais + catálogo + "sem música"', () => {
  assert.equal(T.lista.length, 3 + defs.length + 1);
  assert.equal(T.lista[T.lista.length - 1].id, 'nenhuma');
});

// melodias não podem ser iguais entre si (cópia acidental de uma faixa na outra)
caso('nenhuma melodia repetida entre faixas', () => {
  const vistas = new Map();
  for (const d of defs) {
    const k = d.melodia.notas.replace(/\s+/g, ' ');
    assert.ok(!vistas.has(k), `${d.id} repete a melodia de ${vistas.get(k)}`); vistas.set(k, d.id);
  }
});
console.log(`\n${n} testes passaram.`);
