// CÓPIA EXATA de locacao/precos.js (v12.42), só com o export no fim.
// A regra de preço por período precisa dar o MESMO valor no painel e aqui no
// assistente. Mudou o original? Copie de novo. infra/tests/precos.test.mjs compara os dois.
/* ============================================================
   Fieldo Locação · precos.js  v12.42
   ─────────────────────────────────────────────────────────────
   Preço por período: diária, semanal (7 dias), quinzenal (15 dias)
   e mensal (30 dias). A locadora decide quais usa e quanto cobra;
   nenhum é obrigatório sozinho, mas o equipamento precisa de pelo
   menos um para entrar numa locação com valor calculado.

   REGRA DO CÁLCULO — a combinação MAIS BARATA que cobre o período.
     Ex.: diária 80, semana 400, 10 dias
          10 diárias = 800 · 1 semana + 3 diárias = 640 · 2 semanas = 800
          → 1 semana + 3 diárias = R$ 640.
     Ex.: só preço mensal (1.200) e 5 dias → 1 mês (cobre 30 dias).
   Pode cobrir mais dias do que o pedido quando isso sai mais barato
   (6 diárias de 80 = 480 > 1 semana de 400 → cobra a semana). Em
   empate de valor: o que cobre menos dias, depois o que tem menos
   períodos. É o valor SUGERIDO: a locadora continua podendo digitar
   outro total na locação.

   Mês = 30 dias, quinzena = 15 dias (convenção do aluguel de
   equipamento; o texto do formulário diz isso à locadora).

   Este arquivo é a ÚNICA implementação da regra. A cópia em
   supabase/functions/assistant/precos-locacao.js é este mesmo texto
   com `export default` no fim — o teste em infra/tests compara as duas.
   Valores em centavos por dentro: soma de float com 0,1 erra.
============================================================ */
var FieldoPrecos = (function () {
  'use strict';

  /* do maior para o menor: é a ordem em que a composição é escrita */
  var PERIODOS = [
    { chave: 'mes',      campo: 'preco_mes',      dias: 30, um: 'mês',      varios: 'meses',      rotulo: 'Mensal',    por: 'por mês' },
    { chave: 'quinzena', campo: 'preco_quinzena', dias: 15, um: 'quinzena', varios: 'quinzenas',  rotulo: 'Quinzenal', por: 'por quinzena' },
    { chave: 'semana',   campo: 'preco_semana',   dias: 7,  um: 'semana',   varios: 'semanas',    rotulo: 'Semanal',   por: 'por semana' },
    { chave: 'dia',      campo: 'preco_dia',      dias: 1,  um: 'diária',   varios: 'diárias',    rotulo: 'Diária',    por: 'por dia' },
  ];
  var POR_CHAVE = {};
  PERIODOS.forEach(function (p) { POR_CHAVE[p.chave] = p; });

  /* Acima disso a conta exata não compensa: guloso do maior período. */
  var LIMITE_DIAS_EXATO = 3660;

  function _num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : null;
  }
  function _centavos(n) { return Math.round(n * 100); }

  /* Tabela de preços de um equipamento (ou de um objeto já no formato
     { dia, semana, quinzena, mes }). Preço 0, vazio ou inválido = não usa. */
  function tabela(e) {
    e = e || {};
    var t = {};
    PERIODOS.forEach(function (p) {
      var v = e[p.campo] !== undefined ? e[p.campo] : e[p.chave];
      t[p.chave] = _num(v);
    });
    return t;
  }

  function temPreco(e) {
    var t = tabela(e);
    return PERIODOS.some(function (p) { return t[p.chave] != null; });
  }

  /* Valor de UMA unidade do equipamento para `dias` dias.
     Devolve null se não há preço nenhum; senão:
       { dias, cobre, total, periodos: [{ chave, qtd, preco }] } */
  function calcular(e, dias) {
    var t = tabela(e);
    var n = Math.max(1, Math.floor(Number(dias) || 0));
    var usaveis = PERIODOS.filter(function (p) { return t[p.chave] != null; })
      .map(function (p) { return { p: p, c: _centavos(t[p.chave]) }; });
    if (!usaveis.length) return null;

    var qtd = {};
    if (n <= LIMITE_DIAS_EXATO) {
      /* custo[k] = menor custo para cobrir AO MENOS k dias */
      var custo = [0], cobre = [0], nper = [0], escolha = [null];
      for (var k = 1; k <= n; k++) {
        var melhor = null;
        for (var i = 0; i < usaveis.length; i++) {
          var u = usaveis[i], antes = Math.max(0, k - u.p.dias);
          var c = custo[antes] + u.c, cb = cobre[antes] + u.p.dias, np = nper[antes] + 1;
          if (!melhor || c < melhor.c || (c === melhor.c && (cb < melhor.cb || (cb === melhor.cb && np < melhor.np)))) {
            melhor = { c: c, cb: cb, np: np, u: u, antes: antes };
          }
        }
        custo[k] = melhor.c; cobre[k] = melhor.cb; nper[k] = melhor.np; escolha[k] = melhor;
      }
      for (var x = n; x > 0; x = escolha[x].antes) {
        var ch = escolha[x].u.p.chave;
        qtd[ch] = (qtd[ch] || 0) + 1;
      }
    } else {
      var resta = n;
      usaveis.forEach(function (u, idx) {
        var ultimo = idx === usaveis.length - 1;
        var q = ultimo ? Math.ceil(resta / u.p.dias) : Math.floor(resta / u.p.dias);
        if (q > 0) { qtd[u.p.chave] = q; resta -= q * u.p.dias; }
      });
    }

    var periodos = [], total = 0, dCobre = 0;
    PERIODOS.forEach(function (p) {
      if (!qtd[p.chave]) return;
      periodos.push({ chave: p.chave, qtd: qtd[p.chave], preco: t[p.chave] });
      total += qtd[p.chave] * _centavos(t[p.chave]);
      dCobre += qtd[p.chave] * p.dias;
    });
    return { dias: n, cobre: dCobre, total: total / 100, periodos: periodos };
  }

  /* O que se grava em locacao_itens.cobranca: dá para refazer a conta
     (renovação) com os preços da época, sem depender do cadastro atual. */
  function cobranca(e, dias) {
    var r = calcular(e, dias);
    if (!r) return null;
    var t = tabela(e), tab = {};
    PERIODOS.forEach(function (p) { if (t[p.chave] != null) tab[p.chave] = t[p.chave]; });
    return { v: 1, dias: r.dias, cobre: r.cobre, unitario: r.total, periodos: r.periodos, tabela: tab };
  }

  function _brl(n) {
    return 'R$ ' + Number(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  /* "1 semana + 3 diárias" */
  function descrever(r) {
    if (!r || !r.periodos || !r.periodos.length) return '';
    return r.periodos.map(function (x) {
      var p = POR_CHAVE[x.chave];
      return x.qtd + ' ' + (x.qtd === 1 ? p.um : p.varios);
    }).join(' + ');
  }

  /* "1 semana (R$ 400,00) + 3 diárias (R$ 80,00)" — para o contrato */
  function descreverComPreco(r) {
    if (!r || !r.periodos || !r.periodos.length) return '';
    return r.periodos.map(function (x) {
      var p = POR_CHAVE[x.chave];
      return x.qtd + ' ' + (x.qtd === 1 ? p.um : p.varios) + ' (' + _brl(x.preco) + ')';
    }).join(' + ');
  }

  /* Lista curta da tabela: [{ chave, rotulo, preco, por }] na ordem dia → mês */
  function lista(e) {
    var t = tabela(e);
    return PERIODOS.slice().reverse().filter(function (p) { return t[p.chave] != null; })
      .map(function (p) { return { chave: p.chave, rotulo: p.rotulo, preco: t[p.chave], por: p.por, um: p.um, dias: p.dias }; });
  }

  /* "R$ 80,00/dia · R$ 400,00/semana" */
  function resumo(e, sep) {
    return lista(e).map(function (x) { return _brl(x.preco) + '/' + (x.chave === 'dia' ? 'dia' : x.um); }).join(sep || ' · ');
  }

  return {
    PERIODOS: PERIODOS,
    tabela: tabela,
    temPreco: temPreco,
    calcular: calcular,
    cobranca: cobranca,
    descrever: descrever,
    descreverComPreco: descreverComPreco,
    lista: lista,
    resumo: resumo,
  };
})();

if (typeof globalThis !== 'undefined') globalThis.FieldoPrecos = FieldoPrecos;

export default FieldoPrecos;
