/* ============================================================
   Fieldo · db.condo.js  v1.0  —  módulo do Zelo (gestão de condomínio)
   ─────────────────────────────────────────────────────────────
   Carrega DEPOIS de db.js. Usa FIELDO.rest (get/post/patch) e
   FIELDO.Auth — não reimplementa timeout, JWT ou tratamento de
   erro: tudo isso já vive em db.js e é reaproveitado daqui.

   Requer que a página defina, ANTES de <script src="db.js">:
     <script>window.FIELDO_APP_NS = 'zelo';</script>
   Sem isso a sessão do Zelo colide com a do Fieldo profissional
   (mesma origem, mesmo localStorage — ver PATCH-v7).

   Tabelas (Supabase, mesmo projeto do Fieldo):
     condo_sindicos, condo_condominios,
     condo_manutencoes_recorrentes, condo_servicos_contratados
   RLS: id = auth.uid() em condo_sindicos; as demais herdam posse
   via join até condo_condominios.sindico_id. Testado com
   set local role anon/authenticated antes deste arquivo existir.
============================================================ */

var FIELDO_CONDO = (function () {
  'use strict';

  if (typeof FIELDO === 'undefined' || !FIELDO.rest || !FIELDO.Auth) {
    console.error('[db.condo.js] FIELDO.rest/Auth ausentes — carregue db.js antes deste arquivo.');
    return { Sindicos: {}, Condominios: {}, Manutencoes: {}, ServicosContratados: {} };
  }

  var _get   = FIELDO.rest.get;
  var _post  = FIELDO.rest.post;
  var _patch = FIELDO.rest.patch;
  var _del   = FIELDO.rest.del;
  var Auth   = FIELDO.Auth;
  var LS_KEY = 'session_data'; /* já namespaced por FIELDO_APP_NS dentro de db.js */

  var _sindicoData = null;

  /* ════════════════════════════════════════════════════════════
     DATAS — exportado porque zelo/painel.html calculava a próxima
     execução por conta própria, com os MESMOS dois bugs. Duas
     cópias da regra = duas chances de errar; agora é uma só.
  ════════════════════════════════════════════════════════════ */

  /* Data de HOJE no fuso de quem está usando. new Date().toISOString() é UTC:
     quem marca a manutenção como feita às 22h de 13/08 no Brasil gravaria
     14/08 — e o erro se propaga para proxima_execucao. Mesmo bug B14 da
     auditoria do core, em roupa nova. */
  function _hojeLocal() {
    var d = new Date();
    return _iso(d);
  }

  /* toISOString() converte para UTC antes de cortar — para quem está em
     UTC-3 isso volta um dia. Formata a partir dos getters LOCAIS. */
  function _iso(d) {
    return d.getFullYear() + '-' +
           ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
           ('0' + d.getDate()).slice(-2);
  }

  /* setMonth estoura em fim de mês: 31/01 + 1 mês vira 03/03, porque o dia 31
     não existe em fevereiro e o Date "transborda". Fixa o dia 1, soma o mês,
     e só então volta para o menor entre o dia original e o último do mês. */
  function _somarMeses(dataISO, meses) {
    var d = new Date(dataISO + 'T00:00:00');
    if (isNaN(d.getTime())) throw new Error('data_invalida: ' + dataISO);
    var dia = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + (meses || 0));
    var ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(dia, ultimoDia));
    return _iso(d);
  }

  var Datas = { hojeLocal: _hojeLocal, somarMeses: _somarMeses, iso: _iso };

  /* ════════════════════════════════════════════════════════════
     SINDICOS — id = auth.uid(), igual Professionals no core
  ════════════════════════════════════════════════════════════ */
  var Sindicos = {

    /* me(true) força ida ao servidor — usado pelo onboarding para saber se
       o síndico JÁ existe antes de tentar criar de novo. */
    me: function (force) {
      var id = Auth.getId();
      if (!id) return Promise.resolve(null);
      if (_sindicoData && !force) return Promise.resolve(_sindicoData);
      return _get('/condo_sindicos?id=eq.' + encodeURIComponent(id) + '&limit=1')
        .then(function (rows) { return rows[0] || null; })
        .then(function (s) {
          /* v8.4: confere s.id === id, não só "s existe". O db.js:1035 tem
             esse guard e o comentário de lá explica o motivo: uma resposta
             inesperada (HTML de erro de proxy, corpo sem content-type json)
             vira `s`, é gravada na sessão e DESLOGA o síndico na checagem
             seguinte. Esta cópia tinha ficado sem. */
          if (s && s.id === id) { _sindicoData = s; Auth.setSession(s); }
          return s;
        });
    },

    /* O id NÃO é escolhido aqui: vem do auth.uid() da sessão anônima
       (Session.ensure()). A policy sindico_all_own recusa qualquer
       outro valor — mesma defesa que Professionals.create usa. */
    create: function (data) {
      return Auth.Session.ensure().then(function (s) {
        data.id = s.user_id;
        return _post('/condo_sindicos', data);
      }).then(function (rows) {
        var sindico = Array.isArray(rows) ? rows[0] : rows;
        if (sindico) { _sindicoData = sindico; Auth.setSession(sindico); }
        return sindico;
      });
    },

    update: function (data) {
      var id = Auth.getId();
      if (!id) return Promise.reject(new Error('Não autenticado'));
      return _patch('/condo_sindicos?id=eq.' + id, data)
        .then(function (rows) {
          var s = Array.isArray(rows) ? rows[0] : rows;
          if (s) { _sindicoData = s; Auth.setSession(s); }
          return s;
        });
    },
  };

  /* ════════════════════════════════════════════════════════════
     CONDOMINIOS
  ════════════════════════════════════════════════════════════ */
  var Condominios = {

    list: function () {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      return _get('/condo_condominios?sindico_id=eq.' + id + '&order=created_at.desc');
    },

    getById: function (condoId) {
      return _get('/condo_condominios?id=eq.' + encodeURIComponent(condoId) + '&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },

    create: function (data) {
      var id = Auth.getId();
      if (!id) return Promise.reject(new Error('Não autenticado'));
      data.sindico_id = id;
      return _post('/condo_condominios', data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    update: function (condoId, data) {
      return _patch('/condo_condominios?id=eq.' + encodeURIComponent(condoId), data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },
  };

  /* ════════════════════════════════════════════════════════════
     MANUTENCOES RECORRENTES
  ════════════════════════════════════════════════════════════ */
  var Manutencoes = {

    listByCondominio: function (condoId) {
      return _get('/condo_manutencoes_recorrentes?condominio_id=eq.' +
        encodeURIComponent(condoId) + '&order=proxima_execucao.asc');
    },

    create: function (condoId, data) {
      data.condominio_id = condoId;
      return _post('/condo_manutencoes_recorrentes', data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    /* Marca execução feita e já calcula a próxima data — evita
       divergência de fuso/mês se ficasse por conta do front. */
    marcarExecutada: function (manutId, dataExecucaoISO) {
      return _get('/condo_manutencoes_recorrentes?id=eq.' + encodeURIComponent(manutId) + '&limit=1')
        .then(function (rows) {
          var m = rows[0];
          if (!m) throw new Error('Manutenção não encontrada');
          /* v8.4: era new Date().toISOString().slice(0,10) — UTC. Marcar
             manutenção como feita às 22h de 13/08 no Brasil gravava 14/08,
             e o erro se propagava para proxima_execucao. Mesmo bug B14 da
             auditoria do core. Agora usa a data LOCAL de quem executou —
             que é quem sabe em que dia a coisa foi feita. */
          var exec = dataExecucaoISO || _hojeLocal();
          return _patch('/condo_manutencoes_recorrentes?id=eq.' + encodeURIComponent(manutId), {
            ultima_execucao:  exec,
            proxima_execucao: _somarMeses(exec, m.frequencia_meses || 12),
          });
        }).then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    update: function (manutId, data) {
      return _patch('/condo_manutencoes_recorrentes?id=eq.' + encodeURIComponent(manutId), data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    remove: function (manutId) {
      return _del('/condo_manutencoes_recorrentes?id=eq.' + encodeURIComponent(manutId));
    },
  };

  /* ════════════════════════════════════════════════════════════
     SERVICOS CONTRATADOS — a ponte de valor com o Fieldo.
     report_id aponta pro relatório do profissional contratado via
     marketplace (professional_stats), já verificado e com hash.
  ════════════════════════════════════════════════════════════ */
  var ServicosContratados = {

    listByCondominio: function (condoId) {
      return _get('/condo_servicos_contratados?condominio_id=eq.' +
        encodeURIComponent(condoId) + '&order=created_at.desc');
    },

    create: function (condoId, data) {
      data.condominio_id = condoId;
      return _post('/condo_servicos_contratados', data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    remove: function (servicoId) {
      return _del('/condo_servicos_contratados?id=eq.' + encodeURIComponent(servicoId));
    },
  };

  return {
    Sindicos:            Sindicos,
    Condominios:         Condominios,
    Manutencoes:         Manutencoes,
    ServicosContratados: ServicosContratados,
    Datas:               Datas,
  };
})();
