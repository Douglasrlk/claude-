// Testes da regra de preço por período da Locação (site/locacao/precos.js).
// Rodar: node infra/tests/precos.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const original = readFileSync(join(raiz, 'site/locacao/precos.js'), 'utf8');
const ctx = {}; vm.createContext(ctx); vm.runInContext(original + '\n;this.FieldoPrecos = FieldoPrecos;', ctx);
const P = ctx.FieldoPrecos;

let n = 0;
const caso = (nome, fn) => { fn(); n++; console.log('ok', nome); };

caso('sem preço nenhum → null', () => {
  assert.equal(P.calcular({}, 5), null);
  assert.equal(P.temPreco({ preco_dia: 0, preco_mes: '' }), false);
});

caso('só diária: diária × dias', () => {
  const r = P.calcular({ preco_dia: 80 }, 10);
  assert.equal(r.total, 800); assert.equal(P.descrever(r), '10 diárias');
});

caso('10 dias com semana: 1 semana + 3 diárias', () => {
  const r = P.calcular({ preco_dia: 80, preco_semana: 400 }, 10);
  assert.equal(r.total, 640); assert.equal(P.descrever(r), '1 semana + 3 diárias'); assert.equal(r.cobre, 10);
});

caso('6 dias: semana sai mais barata que 6 diárias', () => {
  const r = P.calcular({ preco_dia: 80, preco_semana: 400 }, 6);
  assert.equal(r.total, 400); assert.equal(P.descrever(r), '1 semana'); assert.equal(r.cobre, 7);
});

caso('quinzena entra na combinação', () => {
  const e = { preco_dia: 80, preco_semana: 400, preco_quinzena: 700, preco_mes: 1200 };
  assert.equal(P.descrever(P.calcular(e, 15)), '1 quinzena');
  assert.equal(P.calcular(e, 17).total, 860);           // 1 quinzena + 2 diárias
  assert.equal(P.descrever(P.calcular(e, 30)), '1 mês');
  assert.equal(P.descrever(P.calcular(e, 45)), '1 mês + 1 quinzena');
});

caso('só mensal: 5 dias cobram 1 mês', () => {
  const r = P.calcular({ preco_mes: 1200 }, 5);
  assert.equal(r.total, 1200); assert.equal(r.cobre, 30); assert.equal(P.descrever(r), '1 mês');
});

caso('empate de valor: escolhe o que cobre menos dias', () => {
  // 7 diárias de 50 = 350 = 1 semana de 350 → mesmo valor e mesma cobertura; menos períodos
  assert.equal(P.descrever(P.calcular({ preco_dia: 50, preco_semana: 350 }, 7)), '1 semana');
  // 3 diárias de 100 = 300 = 1 semana de 300 → prefere 3 diárias (cobre 3, não 7)
  assert.equal(P.descrever(P.calcular({ preco_dia: 100, preco_semana: 300 }, 3)), '3 diárias');
});

caso('mesmo dia conta 1 diária; dias inválidos viram 1', () => {
  assert.equal(P.calcular({ preco_dia: 80 }, 0).total, 80);
  assert.equal(P.calcular({ preco_dia: 80 }, 'x').total, 80);
});

caso('centavos sem erro de float', () => {
  assert.equal(P.calcular({ preco_dia: 0.1 }, 3).total, 0.3);
  assert.equal(P.calcular({ preco_dia: 33.33 }, 3).total, 99.99);
});

caso('aceita preços como texto (vêm assim do PostgREST para numeric)', () => {
  assert.equal(P.calcular({ preco_dia: '80.00', preco_semana: '400.00' }, 10).total, 640);
});

caso('cobranca guarda tabela e composição', () => {
  const c = P.cobranca({ preco_dia: 80, preco_semana: 400, preco_mes: null }, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(c)), { v: 1, dias: 10, cobre: 10, unitario: 640,
    periodos: [{ chave: 'semana', qtd: 1, preco: 400 }, { chave: 'dia', qtd: 3, preco: 80 }],
    tabela: { semana: 400, dia: 80 } });
  // refazer a conta a partir da tabela gravada dá o mesmo valor
  assert.equal(P.calcular(c.tabela, 10).total, 640);
  assert.equal(P.descreverComPreco(c), '1 semana (R$ 400,00) + 3 diárias (R$ 80,00)');
});

caso('resumo e lista na ordem dia → mês', () => {
  assert.equal(P.resumo({ preco_mes: 1200, preco_dia: 80, preco_quinzena: 700 }), 'R$ 80,00/dia · R$ 700,00/quinzena · R$ 1.200,00/mês');
});

caso('períodos longos (acima do limite exato) usam o guloso sem travar', () => {
  const r = P.calcular({ preco_dia: 80, preco_mes: 1200 }, 4000);
  assert.equal(P.descrever(r), '133 meses + 10 diárias');
});

caso('confere com força bruta em 3.000 casos aleatórios', () => {
  const DIAS = { dia: 1, semana: 7, quinzena: 15, mes: 30 };
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let t = 0; t < 3000; t++) {
    const e = {};
    for (const k of Object.keys(DIAS)) if (rnd() < 0.6) e[k] = Math.round(rnd() * 3000) / 10 + 1;
    if (!Object.keys(e).length) e.dia = 10;
    const d = 1 + Math.floor(rnd() * 70);
    // força bruta: todas as quantidades que cobrem d dias sem período sobrando por inteiro
    let melhor = Infinity;
    const ks = Object.keys(e);
    const rec = (i, cob, custo) => {
      if (custo >= melhor) return;
      if (cob >= d) { melhor = custo; return; }
      if (i === ks.length) return;
      const L = DIAS[ks[i]], max = Math.ceil((d - cob) / L);
      for (let q = 0; q <= max; q++) rec(i + 1, cob + q * L, custo + q * Math.round(e[ks[i]] * 100));
    };
    rec(0, 0, 0);
    const r = P.calcular(e, d);
    assert.equal(Math.round(r.total * 100), melhor, JSON.stringify({ e, d, r }));
    assert.ok(r.cobre >= d);
  }
});

// A cópia do assistente precisa ser o mesmo texto + export.
const copia = readFileSync(join(raiz, 'site/supabase/functions/assistant/precos-locacao.js'), 'utf8');
caso('cópia do assistente idêntica ao original', () => {
  const corpo = copia.replace(/^(\/\/.*\n)+/, '').replace(/\nexport default FieldoPrecos;\n?$/, '\n');
  assert.equal(corpo.trimEnd(), original.trimEnd());
});

const docOrig = readFileSync(join(raiz, 'site/locacao/contrato-doc.js'), 'utf8');
const docCopia = readFileSync(join(raiz, 'site/supabase/functions/assistant/contrato-doc.js'), 'utf8');
caso('contrato-doc do assistente idêntico ao original', () => {
  const corpo = docCopia.replace(/^(\/\/.*\n)+/, '').replace(/\n+export default FieldoContratoDoc;\n?$/, '\n');
  assert.equal(corpo.trimEnd(), docOrig.trimEnd());
});

console.log(`\n${n} testes passaram.`);

// ── Contrato: itens sem cobrança por período geram o MESMO texto de antes ──
// (o hash do documento prova qual versão foi aceita; não pode mudar à toa)
import { execSync } from 'node:child_process';
const carregaDoc = (fonte) => { const c = { console }; vm.createContext(c); vm.runInContext(fonte + '\n;this.D = FieldoContratoDoc;', c); return c.D; };
const dadosBase = (itens) => ({
  locadora: { nome: 'Loc', razao_social: 'Loc Ltda', documento: '11222333000181', cidade: 'Caraguatatuba', uf: 'SP', whatsapp: '12900000000' },
  cliente: { nome: 'Cliente', documento: '52998224725', telefone: '12911111111' },
  locacao: { data_saida: '2026-11-21', data_prevista_devolucao: '2026-12-01', diarias: 10, valor_total: 640, caucao_valor: 300 },
  itens, condicoes: {},
});
caso('contrato sem cobrança por período: texto idêntico à versão anterior', () => {
  // versão de referência: a do zip v12.41 (primeiro commit que trouxe o site)
  const ref = execSync('git log --diff-filter=A --format=%H -- site/locacao/contrato-doc.js', { cwd: raiz, encoding: 'utf8' }).trim().split('\n').pop();
  const anterior = execSync(`git show ${ref}:site/locacao/contrato-doc.js`, { cwd: raiz, encoding: 'utf8' });
  if (anterior === docOrig) { console.log('   (sem versão anterior diferente no git para comparar)'); return; }
  const A = carregaDoc(anterior), B = carregaDoc(docOrig);
  const d = dadosBase([{ nome: 'Betoneira', quantidade: 1, preco_dia: 80, subtotal: 800 }]);
  assert.equal(JSON.stringify(B.render(d, A.clausulasPadrao(d))), JSON.stringify(A.render(d, A.clausulasPadrao(d))));
});
caso('contrato com cobrança por período mostra a composição e fala em dias', () => {
  const B = carregaDoc(docOrig);
  const c = P.cobranca({ preco_dia: 80, preco_semana: 400 }, 10);
  const t = B.render(dadosBase([{ nome: 'Betoneira', quantidade: 2, preco_dia: 80, subtotal: 1280, cobranca: c }]), []).texto;
  assert.match(t, /Devolução prevista: 01\/12\/2026 \(10 dias\)/);
  assert.match(t, /2× Betoneira — cobrança: 1 semana \(R\$ 400,00\) \+ 3 diárias \(R\$ 80,00\) por unidade — subtotal R\$ 1\.280,00/);
});
console.log(`${n} testes no total.`);
