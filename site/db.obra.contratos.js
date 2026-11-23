/* ============================================================
   Fieldo · db.obra.contratos.js  v12.40 — contrato de obra
   ─────────────────────────────────────────────────────────────
   Carrega DEPOIS de db.js. Acrescenta FIELDO.ObraContratos.
   O profissional LÊ as tabelas (RLS por professional_id) e ESCREVE só
   pelas funções obra_contrato_* do banco, que validam dono, estado,
   plano e dados (migration 2026-11-18_obra_contratos.sql).
   Mesmo desenho de db.locacao.contratos.js.
============================================================ */
(function () {
  'use strict';
  if (typeof FIELDO === 'undefined' || !FIELDO.rest) {
    console.error('[db.obra.contratos.js] carregue db.js antes deste arquivo.');
    return;
  }
  var _get = FIELDO.rest.get, _rpc = FIELDO.rest.rpc, Auth = FIELDO.Auth;

  var MSG = {
    nao_autenticado:       'Sua sessão expirou. Entre de novo.',
    pro_necessario:        'Seu plano não permite esta ação.',
    nao_encontrado:        'Contrato não encontrado.',
    obra_nao_encontrada:   'Obra não encontrada.',
    ja_existe:             'Esta obra já tem um contrato em andamento.',
    ja_existe_rascunho:    'Já existe um rascunho de nova versão deste contrato.',
    nao_editavel:          'Este contrato já foi enviado e não pode mais ser editado. Crie uma nova versão.',
    estado_invalido:       'Esta ação não é possível no estado atual do contrato.',
    campos_invalidos:      'Faltam dados obrigatórios no contrato.',
    texto_invalido:        'Não foi possível gerar o texto do contrato. Recarregue a página e tente de novo.',
    validade_invalida:     'Validade do link inválida.',
    aceite_obrigatorio:    'É preciso confirmar que leu e concorda com os termos.',
    aceite_invalido:       'Aceite inválido.',
    nome_invalido:         'Informe o nome completo.',
    traco_invalido:        'A imagem da assinatura é inválida. Limpe e desenhe de novo.',
    documento_nao_confere: 'O CPF/CNPJ informado não confere com o do contrato.',
    muitas_tentativas:     'Muitas tentativas. Aguarde uma hora ou peça um novo link.',
    ja_assinado:           'Este contrato já foi assinado.',
    revogado:              'Este link foi cancelado. Peça um novo link ao profissional.',
    expirado:              'Este link expirou. Peça um novo link ao profissional.',
    cancelado:             'Este contrato foi cancelado.',
    substituido:           'Este contrato foi substituído por uma nova versão. Peça o novo link ao profissional.',
    recusado:              'Este contrato foi recusado.',
    pdf_invalido:          'PDF inválido.',
    pdf_ja_registrado:     'O PDF deste contrato já foi arquivado.'
  };

  var STATUS = {
    rascunho:           'Rascunho',
    aguardando_cliente: 'Aguardando assinatura do cliente',
    assinado:           'Assinado pelas duas partes',
    recusado:           'Recusado pelo cliente',
    cancelado:          'Cancelado',
    substituido:        'Substituído por nova versão'
  };

  function res(r) {
    r = Array.isArray(r) ? r[0] : r;
    if (r && r.ok) return r;
    var e = new Error(MSG[r && r.error] || 'Não foi possível concluir a operação.');
    e.code = (r && r.error) || 'erro';
    e.detalhe = r || null;
    throw e;
  }

  var COLS = 'id,obra_id,grupo_id,numero,versao,status,dados,documento_hash,enviado_em,concluido_em,' +
             'token_expira_em,revogado_em,substituido_por,pdf_path,pdf_hash,created_at,updated_at';

  /* o banco guarda só o hash do token; quem enviou guarda o token neste
     aparelho para copiar o link de novo sem invalidar o que já foi mandado */
  function chave(id) { return 'fieldo_obra_ct_' + id; }
  var Tokens = {
    guardar: function (id, token, expira) { try { localStorage.setItem(chave(id), JSON.stringify({ t: token, e: expira || null })); } catch (e) {} },
    ler: function (id) {
      try {
        var o = JSON.parse(localStorage.getItem(chave(id)) || 'null');
        if (!o || !o.t) return null;
        if (o.e && new Date(o.e).getTime() < Date.now()) { localStorage.removeItem(chave(id)); return null; }
        return o.t;
      } catch (e) { return null; }
    },
    esquecer: function (id) { try { localStorage.removeItem(chave(id)); } catch (e) {} }
  };

  var C = {
    MSG: MSG, STATUS: STATUS, Tokens: Tokens, res: res,

    /* versões do contrato desta obra, da mais nova para a mais antiga */
    daObra: function (obraId) {
      return _get('/obra_contratos?obra_id=eq.' + encodeURIComponent(obraId) +
        '&select=' + COLS + ',obra_contrato_assinaturas(parte,nome,assinado_em)&order=versao.desc');
    },
    getById: function (id) {
      return _get('/obra_contratos?id=eq.' + encodeURIComponent(id) +
        '&select=' + COLS + ',documento_texto,obra_contrato_assinaturas(*)&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },
    eventos: function (id) {
      return _get('/obra_contrato_eventos?contrato_id=eq.' + encodeURIComponent(id) +
        '&select=id,tipo,ator,detalhe,created_at&order=created_at.asc,id.asc');
    },

    criar: function (obraId) { return _rpc('obra_contrato_criar', { p_obra_id: obraId }).then(res); },
    salvar: function (id, edicao) { return _rpc('obra_contrato_salvar', { p_id: id, p_edicao: edicao || {} }).then(res); },
    enviar: function (id, texto, traco, validadeDias) {
      return _rpc('obra_contrato_enviar', {
        p_id: id, p_texto: texto, p_aceite: true, p_aceite_versao: ObraContratoDoc.ACEITE_VERSAO,
        p_aceite_texto: ObraContratoDoc.ACEITE_CONTRATADA, p_traco: traco || null,
        p_user_agent: (navigator.userAgent || '').slice(0, 400), p_validade_dias: validadeDias || 15
      }, { timeout: 30000 }).then(res).then(function (r) { Tokens.guardar(id, r.token, r.token_expira_em); return r; });
    },
    novoLink: function (id, validadeDias) {
      return _rpc('obra_contrato_novo_link', { p_id: id, p_validade_dias: validadeDias || 15 }).then(res)
        .then(function (r) { Tokens.guardar(id, r.token, r.token_expira_em); return r; });
    },
    cancelar: function (id, motivo) {
      return _rpc('obra_contrato_cancelar', { p_id: id, p_motivo: motivo || null }).then(res)
        .then(function (r) { Tokens.esquecer(id); return r; });
    },
    novaVersao: function (id) { return _rpc('obra_contrato_nova_versao', { p_id: id }).then(res); },

    /* ── link do cliente ── */
    linkAssinatura: function (token) {
      return FIELDO.publicUrl('contrato-obra-assinar.html') + '#t=' + encodeURIComponent(token);
    },
    mensagemWhatsApp: function (nomeCliente, link) {
      var p = String(nomeCliente || '').trim().split(/\s+/)[0];
      return 'Olá' + (p ? ', ' + p : '') + '! Segue o contrato da obra para você conferir e assinar pelo celular. ' +
             'É só abrir o link, ler e assinar no fim da página: ' + link;
    },
    porToken: function (token) {
      return _rpc('obra_contrato_por_token', { p_token: token }, { anon: true, timeout: 20000 })
        .then(function (r) { r = Array.isArray(r) ? r[0] : r; return r || { ok: false, error: 'nao_encontrado' }; });
    },
    assinarCliente: function (token, nome, documento, traco) {
      return _rpc('obra_contrato_assinar_cliente', {
        p_token: token, p_nome: nome, p_documento: documento, p_aceite: true,
        p_aceite_versao: ObraContratoDoc.ACEITE_VERSAO, p_aceite_texto: ObraContratoDoc.ACEITE_CONTRATANTE,
        p_traco: traco || null, p_user_agent: (navigator.userAgent || '').slice(0, 400)
      }, { anon: true, timeout: 30000 }).then(res);
    },
    recusar: function (token, motivo) {
      return _rpc('obra_contrato_recusar', { p_token: token, p_motivo: motivo || null }, { anon: true, timeout: 20000 }).then(res);
    },

    /* ── PDF: gerado com o mesmo gerador da Locação, outros rótulos ── */
    gerarPdf: function (contrato, assinaturas) {
      return FieldoContratoPdf.gerar(contrato, assinaturas || [], {
        titulo: 'Contrato de empreitada', assunto: 'Contrato de empreitada de obra', autor: 'Fieldo',
        rotulos: { contratada: 'CONTRATADA', contratante: 'CONTRATANTE' }
      });
    },

    /* arquiva o PDF final (bucket privado obra-contratos, pasta = id do profissional) */
    arquivarPdf: function (contrato, blob, hashHex) {
      var uid = Auth.getId();
      if (!uid) return Promise.reject(new Error(MSG.nao_autenticado));
      var caminho = uid + '/' + contrato.id + '/v' + contrato.versao + '-' + Date.now() + '.pdf';
      return Auth.Session.getAccessToken().then(function (token) {
        return fetch(FIELDO.config.STORAGE_URL + '/obra-contratos/' + caminho, {
          method: 'POST',
          headers: { apikey: FIELDO.config.ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/pdf', 'x-upsert': 'false' },
          body: blob
        });
      }).then(function (r) {
        if (!r.ok) throw new Error('Não foi possível arquivar o PDF (' + r.status + ').');
        return _rpc('obra_contrato_registrar_pdf', { p_id: contrato.id, p_path: caminho, p_hash: hashHex }).then(res);
      }).then(function () { return caminho; });
    },
    baixarPdfArquivado: function (caminho) {
      return Auth.Session.getAccessToken().then(function (token) {
        return fetch(FIELDO.config.STORAGE_URL + '/authenticated/obra-contratos/' + caminho, {
          headers: { apikey: FIELDO.config.ANON_KEY, Authorization: 'Bearer ' + token }
        });
      }).then(function (r) {
        if (!r.ok) throw new Error('Não foi possível baixar o PDF (' + r.status + ').');
        return r.blob();
      });
    }
  };

  FIELDO.ObraContratos = C;
})();
