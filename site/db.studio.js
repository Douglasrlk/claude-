/* ============================================================
   Fieldo · db.studio.js  v12.41 — Fieldo Studio
   ─────────────────────────────────────────────────────────────
   Carrega DEPOIS de db.js. Acrescenta FIELDO.Studio.
   O profissional LÊ studio_videos pela RLS (só os próprios) e ESCREVE
   só pelas funções studio_* do banco, que conferem consentimento das
   fotos, plano, cota e dono (migration 2026-11-19_fieldo_studio.sql).
   Mesmo desenho de db.obra.contratos.js.
============================================================ */
(function () {
  'use strict';
  if (typeof FIELDO === 'undefined' || !FIELDO.rest) {
    console.error('[db.studio.js] carregue db.js antes deste arquivo.');
    return;
  }
  var _rpc = FIELDO.rest.rpc, _del = FIELDO.rest.del;

  var MSG = {
    nao_autenticado:           'Sua sessão expirou. Entre de novo.',
    perfil_nao_encontrado:     'Complete seu perfil antes de criar vídeos.',
    servico_nao_encontrado:    'Serviço não encontrado.',
    portfolio_desligado:       'Para usar fotos em vídeo, ative "Mostrar fotos dos meus serviços" no seu perfil.',
    servico_privado:           'Este serviço é privado. Só serviços públicos podem virar vídeo.',
    servico_fora_do_portfolio: 'As fotos deste serviço não estão liberadas para o portfólio.',
    sem_fotos:                 'Este serviço não tem fotos.',
    perfil_privado:            'Seu perfil está oculto. Ative o perfil público para o link do vídeo funcionar.',
    pro_necessario:            'Este recurso é do Fieldo Pro.',
    cota_esgotada:             'Você já usou os vídeos grátis deste mês.',
    modelo_invalido:           'Modelo de vídeo inválido.',
    trilha_invalida:           'Trilha inválida.',
    roteiro_invalido:          'Não foi possível salvar o roteiro. Recarregue a página.',
    roteiro_grande:            'Roteiro grande demais.',
    fotos_invalidas:           'Escolha pelo menos uma foto ou um vídeo (até 8 fotos e 3 vídeos).',
    foto_fora_do_servico:      'Uma das fotos não pertence mais a este serviço. Revise as fotos.',
    texto_invalido:            'Os textos aceitam até 60 caracteres, sem < ou >.',
    limite_de_videos:          'Você chegou ao limite de vídeos guardados. Exclua alguns antigos.',
    servico_diferente:         'Um vídeo já gerado não pode trocar de serviço. Crie um vídeo novo.',
    nao_encontrado:            'Vídeo não encontrado.',
    formato_invalido:          'Formato de vídeo inválido.',
    duracao_invalida:          'Duração de vídeo inválida.',
    indisponivel:              'O Fieldo Studio ainda está sendo ativado no servidor. Tente de novo em instantes.'
  };

  function erro(codigo, extra) {
    var e = new Error(MSG[codigo] || 'Não foi possível concluir agora. Tente de novo.');
    e.code = codigo || 'erro';
    if (extra) e.detalhe = extra;
    return e;
  }

  function res(r) {
    r = Array.isArray(r) && r.length === 1 && r[0] && r[0].ok !== undefined ? r[0] : r;
    if (r && r.ok) return r;
    throw erro(r && r.error, r);
  }

  /* função inexistente no banco = migration ainda não aplicada */
  function rede(e) {
    if (e && e.code && MSG[e.code]) throw e;
    var m = String((e && e.message) || '');
    if ((e && e.status === 404) || /PGRST202|Could not find the function|studio_/.test(m) && /not find|does not exist/i.test(m)) throw erro('indisponivel');
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) { var x = new Error('Sem conexão. Verifique sua internet.'); x.code = 'offline'; throw x; }
    throw e;
  }

  FIELDO.Studio = {
    MSG: MSG,

    /** perfil, cota do mês e serviços com fotos (elegíveis ou com o motivo) */
    fontes: function () {
      return _rpc('studio_fontes', {}).then(res, rede);
    },

    /** cria (id null) ou atualiza o roteiro; não consome cota */
    salvar: function (v) {
      return _rpc('studio_salvar', {
        p_id: v.id || null, p_report_id: v.reportId, p_modelo: v.modelo, p_trilha: v.trilha,
        p_roteiro: v.roteiro, p_marca: v.marca !== false
      }).then(res, rede);
    },

    /** antes de gravar: reconfere tudo e, na 1ª vez, reserva a cota */
    exportar: function (id, formato, duracaoMs) {
      return _rpc('studio_exportar', { p_id: id, p_formato: formato, p_duracao_ms: Math.round(duracaoMs) }).then(res, rede);
    },

    compartilhado: function (id) {
      return _rpc('studio_compartilhado', { p_id: id }).then(res, rede).catch(function () { return null; });
    },

    /** vídeos do profissional com visitas e contatos de cada um */
    meus: function () {
      return _rpc('studio_meus', {}).then(function (r) { return Array.isArray(r) ? r : []; }, rede);
    },

    excluir: function (id) {
      return _del('/studio_videos?id=eq.' + encodeURIComponent(id)).catch(rede);
    }
  };
})();
