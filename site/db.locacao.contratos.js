/* ============================================================
   Fieldo · db.locacao.contratos.js  v1.0 — contratos digitais da Locação
   ─────────────────────────────────────────────────────────────
   Carrega DEPOIS de db.js e db.locacao.js. Acrescenta
   FIELDO_LOCACAO.Contratos sem alterar nada do que já existe.

   A locadora LÊ as tabelas (RLS por locadora) e ESCREVE só por
   funções do banco (loc_contrato_*), que validam dono, estado e
   integridade no servidor.
   Requer as migrations 2026-10-19_loc_contratos_01/02 aplicadas.
============================================================ */
(function () {
  'use strict';

  if (typeof FIELDO === 'undefined' || !FIELDO.rest || typeof FIELDO_LOCACAO === 'undefined') {
    console.error('[db.locacao.contratos.js] carregue db.js e db.locacao.js antes deste arquivo.');
    return;
  }

  var _get = FIELDO.rest.get;
  var _rpc = FIELDO.rest.rpc;
  var Auth = FIELDO.Auth;

  var MSG = {
    nao_autenticado:        'Sua sessão expirou. Entre de novo.',
    nao_encontrado:         'Contrato não encontrado.',
    locacao_nao_encontrada: 'Locação não encontrada.',
    locacao_cancelada:      'Esta locação foi cancelada.',
    locacao_sem_itens:      'A locação não tem equipamentos.',
    locacao_mudou:          'A locação foi alterada depois que o rascunho foi montado. Atualize os dados do contrato.',
    ja_existe:              'Esta locação já tem um contrato em andamento.',
    ja_existe_rascunho:     'Já existe um rascunho de nova versão.',
    nao_editavel:           'Este contrato já foi enviado e não pode mais ser editado. Crie uma nova versão.',
    estado_invalido:        'Esta ação não é possível no estado atual do contrato.',
    campos_invalidos:       'Faltam dados obrigatórios no contrato.',
    texto_invalido:         'Não foi possível gerar o texto do contrato.',
    clausulas_invalidas:    'Alguma cláusula está inválida (título até 200 e texto até 8.000 caracteres).',
    validade_invalida:      'Validade do link inválida.',
    aceite_obrigatorio:     'É preciso confirmar que leu e concorda com os termos.',
    aceite_invalido:        'Aceite inválido.',
    nome_invalido:          'Informe o nome completo.',
    traco_invalido:         'A imagem da assinatura é inválida. Limpe e desenhe de novo.',
    documento_nao_confere:  'O CPF/CNPJ informado não confere com o do contrato.',
    muitas_tentativas:      'Muitas tentativas. Aguarde uma hora ou peça um novo link.',
    ja_assinado:            'Esta parte já assinou o contrato.',
    revogado:               'Este link foi cancelado pela locadora. Peça um novo link.',
    expirado:               'Este link expirou. Peça um novo link à locadora.',
    cancelado:              'Este contrato foi cancelado.',
    substituido:            'Este contrato foi substituído por uma nova versão. Peça o novo link à locadora.',
    recusado:               'Este contrato foi recusado.',
    pdf_invalido:           'PDF inválido.',
    pdf_ja_registrado:      'O PDF deste contrato já foi arquivado.'
  };

  var STATUS = {
    rascunho:            'Rascunho',
    aguardando_cliente:  'Aguardando assinatura do cliente',
    aguardando_locadora: 'Aguardando assinatura da locadora',
    assinado:            'Assinado por todas as partes',
    recusado:            'Recusado',
    cancelado:           'Cancelado',
    substituido:         'Substituído por nova versão'
  };

  /* Resposta das funções do banco: { ok:true, ... } ou { ok:false, error } */
  function res(r) {
    r = Array.isArray(r) ? r[0] : r;
    if (r && r.ok) return r;
    var e = new Error(MSG[r && r.error] || 'Não foi possível concluir a operação.');
    e.code = (r && r.error) || 'erro';
    e.detalhe = r || null;
    throw e;
  }

  /* Colunas lidas na lista (sem o texto completo nem o hash do token) */
  var COLS = 'id,locacao_id,grupo_id,numero,versao,status,dados,clausulas,origem_hash,documento_hash,' +
             'enviado_em,concluido_em,token_expira_em,revogado_em,substituido_por,pdf_path,pdf_hash,' +
             'created_at,updated_at';

  /* O banco guarda só o hash do token. Quem enviou o link guarda o token
     neste aparelho para poder copiar o link de novo sem invalidar o que já
     foi mandado ao cliente. Em outro aparelho: gerar novo link. */
  function chaveToken(id) { return 'fieldo_loc_ct_' + id; }
  var Tokens = {
    guardar: function (id, token, expiraEm) {
      try { localStorage.setItem(chaveToken(id), JSON.stringify({ t: token, e: expiraEm || null })); } catch (e) {}
    },
    ler: function (id) {
      try {
        var o = JSON.parse(localStorage.getItem(chaveToken(id)) || 'null');
        if (!o || !o.t) return null;
        if (o.e && new Date(o.e).getTime() < Date.now()) { localStorage.removeItem(chaveToken(id)); return null; }
        return o.t;
      } catch (e) { return null; }
    },
    esquecer: function (id) { try { localStorage.removeItem(chaveToken(id)); } catch (e) {} }
  };

  var Contratos = {
    STATUS: STATUS,
    MSG: MSG,
    Tokens: Tokens,
    res: res,

    /* ── leitura ─────────────────────────────────────────────── */
    list: function () {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      return _get('/loc_contratos?locadora_id=eq.' + id +
        '&select=' + COLS + ',loc_contrato_assinaturas(parte,nome,assinado_em)' +
        '&order=updated_at.desc');
    },

    getById: function (contratoId) {
      return _get('/loc_contratos?id=eq.' + encodeURIComponent(contratoId) +
        '&select=' + COLS + ',documento_texto,loc_contrato_assinaturas(*)&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },

    eventos: function (contratoId) {
      return _get('/loc_contrato_eventos?contrato_id=eq.' + encodeURIComponent(contratoId) +
        '&select=id,tipo,ator,detalhe,created_at&order=created_at.asc,id.asc');
    },

    modelo: function () {
      var id = Auth.getId();
      if (!id) return Promise.resolve(null);
      return _get('/loc_contrato_modelos?locadora_id=eq.' + id + '&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },

    /* ── escrita da locadora (funções do banco) ──────────────── */
    criar: function (locacaoId, clausulasPadrao) {
      return _rpc('loc_contrato_criar', { p_locacao_id: locacaoId, p_clausulas: clausulasPadrao || null }).then(res);
    },

    salvar: function (contratoId, edicao, clausulas, resync) {
      return _rpc('loc_contrato_salvar', {
        p_id: contratoId, p_edicao: edicao || {}, p_clausulas: clausulas || null, p_resync: !!resync
      }).then(res);
    },

    enviar: function (contratoId, texto, validadeDias) {
      return _rpc('loc_contrato_enviar', { p_id: contratoId, p_texto: texto, p_validade_dias: validadeDias || 7 })
        .then(res)
        .then(function (r) { Tokens.guardar(contratoId, r.token, r.token_expira_em); return r; });
    },

    novoLink: function (contratoId, validadeDias) {
      return _rpc('loc_contrato_novo_link', { p_id: contratoId, p_validade_dias: validadeDias || 7 })
        .then(res)
        .then(function (r) { Tokens.guardar(contratoId, r.token, r.token_expira_em); return r; });
    },

    revogarLink: function (contratoId) {
      return _rpc('loc_contrato_revogar_link', { p_id: contratoId }).then(res)
        .then(function (r) { Tokens.esquecer(contratoId); return r; });
    },

    cancelar: function (contratoId, motivo) {
      return _rpc('loc_contrato_cancelar', { p_id: contratoId, p_motivo: motivo || null }).then(res)
        .then(function (r) { Tokens.esquecer(contratoId); return r; });
    },

    novaVersao: function (contratoId) {
      return _rpc('loc_contrato_nova_versao', { p_id: contratoId }).then(res);
    },

    assinarLocadora: function (contratoId, aceiteVersao, aceiteTexto, traco) {
      return _rpc('loc_contrato_assinar_locadora', {
        p_id: contratoId, p_aceite: true, p_aceite_versao: aceiteVersao, p_aceite_texto: aceiteTexto,
        p_traco: traco || null, p_user_agent: (navigator.userAgent || '').slice(0, 400)
      }).then(res);
    },

    modeloSalvar: function (clausulas, condicoes) {
      return _rpc('loc_contrato_modelo_salvar', { p_clausulas: clausulas || [], p_condicoes: condicoes || {} }).then(res);
    }
  };

  /* ── link do cliente (página pública, sempre com a anon key) ── */
  Contratos.linkAssinatura = function (token) {
    return FIELDO.publicUrl('locacao/contrato-assinar.html') + '#t=' + encodeURIComponent(token);
  };

  Contratos.mensagemWhatsApp = function (link) {
    return 'Olá! Seu contrato de locação está disponível para conferência e assinatura digital. ' +
           'Acesse o link abaixo para visualizar os dados e concluir a assinatura: ' + link +
           ' Em caso de dúvidas, entre em contato conosco.';
  };

  Contratos.porToken = function (token) {
    return _rpc('loc_contrato_por_token', { p_token: token }, { anon: true, timeout: 20000 })
      .then(function (r) { r = Array.isArray(r) ? r[0] : r; return r || { ok: false, error: 'nao_encontrado' }; });
  };

  Contratos.assinarCliente = function (token, nome, documento, aceiteVersao, aceiteTexto, traco) {
    return _rpc('loc_contrato_assinar_cliente', {
      p_token: token, p_nome: nome, p_documento: documento, p_aceite: true,
      p_aceite_versao: aceiteVersao, p_aceite_texto: aceiteTexto, p_traco: traco || null,
      p_user_agent: (navigator.userAgent || '').slice(0, 400)
    }, { anon: true, timeout: 30000 }).then(res);
  };

  Contratos.recusar = function (token, motivo) {
    return _rpc('loc_contrato_recusar', { p_token: token, p_motivo: motivo || null }, { anon: true, timeout: 20000 })
      .then(res);
  };

  /* ── PDF final: bucket privado "loc-contratos", pasta = id da locadora ── */
  function fetchComPrazo(url, init, ms) {
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, ms) : null;
    if (ctl) init.signal = ctl.signal;
    return fetch(url, init).then(
      function (r) { if (t) clearTimeout(t); return r; },
      function (e) { if (t) clearTimeout(t); throw e; });
  }

  function cabecalhos(token, extra) {
    var h = { 'apikey': FIELDO.config.ANON_KEY, 'Authorization': 'Bearer ' + (token || FIELDO.config.ANON_KEY) };
    for (var k in (extra || {})) h[k] = extra[k];
    return h;
  }

  Contratos.arquivarPdf = function (contrato, blob, hashHex) {
    var uid = Auth.getId();
    if (!uid) return Promise.reject(new Error('Sua sessão expirou. Entre de novo.'));
    var caminho = uid + '/' + contrato.id + '/v' + contrato.versao + '-' + Date.now() + '.pdf';
    return Auth.Session.getAccessToken()
      .then(function (token) {
        return fetchComPrazo(FIELDO.config.STORAGE_URL + '/loc-contratos/' + caminho, {
          method: 'POST',
          headers: cabecalhos(token, { 'Content-Type': 'application/pdf', 'x-upsert': 'false' }),
          body: blob
        }, 60000);
      })
      .then(function (r) {
        if (!r.ok) throw new Error('Não foi possível arquivar o PDF (' + r.status + ').');
        return _rpc('loc_contrato_registrar_pdf', { p_id: contrato.id, p_path: caminho, p_hash: hashHex }).then(res);
      })
      .then(function () { return caminho; });
  };

  Contratos.baixarPdfArquivado = function (caminho) {
    return Auth.Session.getAccessToken()
      .then(function (token) {
        return fetchComPrazo(FIELDO.config.STORAGE_URL + '/authenticated/loc-contratos/' + caminho,
          { method: 'GET', headers: cabecalhos(token) }, 60000);
      })
      .then(function (r) {
        if (!r.ok) throw new Error('Não foi possível baixar o PDF (' + r.status + ').');
        return r.blob();
      });
  };

  FIELDO_LOCACAO.Contratos = Contratos;
})();
