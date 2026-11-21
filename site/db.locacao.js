/* ============================================================
   Fieldo · db.locacao.js  v1.0  —  módulo da Locação de equipamentos
   ─────────────────────────────────────────────────────────────
   Carrega DEPOIS de db.js. Usa FIELDO.rest (get/post/patch/del) e
   FIELDO.Auth — mesmo padrão do db.condo.js: não reimplementa
   timeout, JWT ou tratamento de erro.

   Requer que a página defina, ANTES de <script src="db.js">:
     <script>window.FIELDO_APP_NS = 'loc';</script>

   Tabelas (Supabase, mesmo projeto do Fieldo):
     locadoras, equipamentos, equipamento_categorias,
     locacoes, locacao_itens, locacao_laudos
   RLS: id = auth.uid() em locadoras; equipamentos herda via
   locadora_id. locacoes NÃO tem leitura pública nenhuma — cliente
   acessa a própria locação só pela RPC do token (fora do escopo
   deste módulo v1, que cobre o catálogo/vitrine).
============================================================ */

var FIELDO_LOCACAO = (function () {
  'use strict';

  if (typeof FIELDO === 'undefined' || !FIELDO.rest || !FIELDO.Auth) {
    console.error('[db.locacao.js] FIELDO.rest/Auth ausentes — carregue db.js antes deste arquivo.');
    return { Locadoras: {}, EquipamentoCategorias: {}, Equipamentos: {} };
  }

  var _get       = FIELDO.rest.get;
  var _getPublic = FIELDO.rest.getPublic;
  var _post      = FIELDO.rest.post;
  var _patch     = FIELDO.rest.patch;
  var _del       = FIELDO.rest.del;
  var Auth       = FIELDO.Auth;

  var _locadoraData = null;

  /* ════════════════════════════════════════════════════════════
     LOCADORAS — id = auth.uid(), igual Professionals/Sindicos
  ════════════════════════════════════════════════════════════ */
  var Locadoras = {

    /* me(true) força ida ao servidor — necessário depois de trocar de sessão
       (recuperação por código) e no onboarding, pra saber se a locadora JÁ
       existe antes de tentar criar de novo e bater na PK. */
    me: function (force) {
      var id = Auth.getId();
      if (!id) return Promise.resolve(null);
      if (_locadoraData && !force) return Promise.resolve(_locadoraData);
      return _get('/locadoras?id=eq.' + encodeURIComponent(id) + '&limit=1')
        .then(function (rows) { return rows[0] || null; })
        .then(function (l) {
          /* v8.4: confere l.id === id, não só "l existe". Mesmo guard de
             db.js:1035 e db.condo.js: uma resposta inesperada (HTML de erro
             de proxy, corpo sem content-type json) vira `l`, é gravada na
             sessão e DESLOGA a locadora na checagem seguinte. */
          if (l && l.id === id) { _locadoraData = l; Auth.setSession(l); }
          return l;
        });
    },

    getBySlug: function (slug) {
      return _getPublic('/locadoras?slug=eq.' + encodeURIComponent(slug) + '&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },

    /* O id vem do auth.uid() da sessão anônima — a policy
       locadora_insert_self recusa qualquer outro valor. */
    create: function (data) {
      return Auth.Session.ensure().then(function (s) {
        data.id = s.user_id;
        return _post('/locadoras', data);
      }).then(function (rows) {
        var l = Array.isArray(rows) ? rows[0] : rows;
        if (l) { _locadoraData = l; Auth.setSession(l); }
        return l;
      });
    },

    update: function (data) {
      var id = Auth.getId();
      if (!id) return Promise.reject(new Error('Não autenticado'));
      return _patch('/locadoras?id=eq.' + id, data)
        .then(function (rows) {
          var l = Array.isArray(rows) ? rows[0] : rows;
          if (l) { _locadoraData = l; Auth.setSession(l); }
          return l;
        });
    },
  };

  /* ════════════════════════════════════════════════════════════
     CATEGORIAS — leitura pública, só as aprovadas (moderação)
  ════════════════════════════════════════════════════════════ */
  var EquipamentoCategorias = {
    listAprovadas: function () {
      return _getPublic('/equipamento_categorias?aprovada=eq.true&order=ordem.asc');
    },
  };

  /* ════════════════════════════════════════════════════════════
     EQUIPAMENTOS — catálogo da locadora
  ════════════════════════════════════════════════════════════ */
  var Equipamentos = {

    /* Painel da própria locadora — todos os itens, público ou não. */
    listOwn: function () {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      return _get('/equipamentos?locadora_id=eq.' + id + '&order=created_at.desc');
    },

    /* Vitrine pública — só o que a própria locadora decidiu publicar
       (RLS já filtra is_public+ativo+locadora.is_public; aqui só
       fecha o filtro de qual locadora). */
    listPublicByLocadora: function (locadoraId) {
      return _getPublic('/equipamentos?locadora_id=eq.' + encodeURIComponent(locadoraId) +
        '&order=created_at.desc');
    },

    create: function (data) {
      var id = Auth.getId();
      if (!id) return Promise.reject(new Error('Não autenticado'));
      data.locadora_id = id;
      return _post('/equipamentos', data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    update: function (equipId, data) {
      return _patch('/equipamentos?id=eq.' + encodeURIComponent(equipId), data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    remove: function (equipId) {
      return _del('/equipamentos?id=eq.' + encodeURIComponent(equipId));
    },
  };

  /* ════════════════════════════════════════════════════════════
     DATAS E DIÁRIAS — v8.5
     As regras de data moram aqui, não na tela. Foi exatamente a
     duplicação dessas contas entre db.condo.js e zelo/painel.html
     que gerou os dois bugs de data da v8.4.
  ════════════════════════════════════════════════════════════ */

  /* Data local, não UTC. toISOString() converte antes de cortar e
     devolve o dia seguinte para quem registra à noite no Brasil. */
  function _hojeLocal() {
    var d = new Date();
    return d.getFullYear() + '-' +
           ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
           ('0' + d.getDate()).slice(-2);
  }

  /* Quantas diárias entre saída e devolução prevista.
     DECISÃO DE NEGÓCIO, não lei da física: pegou dia 10 e devolve dia
     12 = 2 diárias (conta a diferença, não os dias no calendário). E o
     mínimo é 1: pegar e devolver no mesmo dia é uma diária, não zero.
     Se a sua locadora cobra diferente, muda AQUI e a tela toda segue. */
  function _diarias(dataSaida, dataDevolucao) {
    var a = new Date(dataSaida + 'T00:00:00');
    var b = new Date(dataDevolucao + 'T00:00:00');
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
    var dias = Math.round((b - a) / 86400000);
    return Math.max(1, dias);
  }

  /* Status para MOSTRAR, derivado na leitura — não gravado.
     Por que derivar: 'atrasada' é um estado que depende do relógio.
     Se fosse gravado, precisaria de um job diário para virar sozinho, e
     sem esse job a tela mostraria "em andamento" para uma locação
     vencida há duas semanas. Derivar não pode ficar desatualizado.
     Os estados que dependem de DECISÃO humana (devolvida, cancelada)
     continuam gravados, porque só a pessoa sabe que aconteceram. */
  function _statusVisivel(loc, hojeISO) {
    if (!loc) return 'reservada';
    if (loc.status === 'devolvida' || loc.status === 'cancelada') return loc.status;
    var hoje = hojeISO || _hojeLocal();
    if (loc.data_prevista_devolucao && loc.data_prevista_devolucao < hoje) return 'atrasada';
    if (loc.data_saida && loc.data_saida <= hoje) return 'em_andamento';
    return 'reservada';
  }

  var STATUS_ROTULO = {
    reservada:    'Reservada',
    em_andamento: 'Em uso',
    atrasada:     'Atrasada',
    devolvida:    'Devolvida',
    cancelada:    'Cancelada',
  };

  /* Uma locação "ocupa" equipamento enquanto não foi devolvida nem
     cancelada. Reservada também ocupa: prometer para dois clientes a
     mesma betoneira é o erro que esta função existe para evitar. */
  function _ocupaEstoque(loc) {
    return loc && loc.status !== 'devolvida' && loc.status !== 'cancelada';
  }

  /* v12.19 · disponibilidade POR PERÍODO (decisão do dono, 30/10).
     Antes, qualquer locação aberta segurava a unidade, de qualquer data:
     uma reserva de dezembro bloqueava a betoneira em outubro.
     Agora uma locação só ocupa os dias entre a saída e a devolução
     prevista. Atrasada (não devolvida e já vencida) continua ocupando até
     hoje e além: o equipamento ainda não voltou, então o fim efetivo é
     o maior entre a devolução prevista e hoje. Datas no formato ISO
     (AAAA-MM-DD) comparam certo como texto. */
  function _fimEfetivo(loc, hoje) {
    var fim = loc.data_prevista_devolucao || loc.data_saida || hoje;
    return fim < hoje ? hoje : fim;
  }
  function _cruza(loc, inicio, fim, hoje) {
    if (!_ocupaEstoque(loc) || !loc.data_saida) return false;
    return loc.data_saida <= fim && _fimEfetivo(loc, hoje) >= inicio;
  }
  /* { equipamento_id: unidades ocupadas no período } — soma TODAS as
     locações que se cruzam com o período. É conservador de propósito:
     duas locações que não se cruzam entre si mas cruzam o período somam
     juntas. Prometer a menos é melhor que prometer o que não tem. */
  function _ocupadoNoPeriodo(locacoes, inicio, fim, ignorarId, hojeISO) {
    var hoje = hojeISO || _hojeLocal(), mapa = {};
    if (!inicio) return mapa;
    fim = fim && fim >= inicio ? fim : inicio;
    (locacoes || []).forEach(function (l) {
      if (!l || l.id === ignorarId || !_cruza(l, inicio, fim, hoje)) return;
      (l.locacao_itens || []).forEach(function (it) {
        if (!it || !it.equipamento_id) return;
        mapa[it.equipamento_id] = (mapa[it.equipamento_id] || 0) + (it.quantidade || 0);
      });
    });
    return mapa;
  }

  var Datas = {
    hojeLocal: _hojeLocal,
    diarias: _diarias,
    statusVisivel: _statusVisivel,
    rotulo: function (s) { return STATUS_ROTULO[s] || s; },
    ocupaEstoque: _ocupaEstoque,
    ocupadoNoPeriodo: _ocupadoNoPeriodo,
    /* status gravado ao criar/editar: futuro = reservada, senão em uso */
    /* o gatilho trg_locacoes troca em_andamento por atrasada sozinho */
    statusInicial: function (saida) { return saida > _hojeLocal() ? 'reservada' : 'em_andamento'; },
  };

  /* ════════════════════════════════════════════════════════════
     LOCACOES — o núcleo do negócio. v8.5
     Até aqui o schema existia inteiro (locacoes 23 colunas,
     locacao_itens, locacao_laudos, RLS e grants) e não havia UMA
     linha de código chamando. Por isso locacoes tinha 0 registros:
     não era bug, era código que nunca foi escrito.
  ════════════════════════════════════════════════════════════ */
  var Locacoes = {

    /* Traz a locação com os itens embutidos (PostgREST resolve o join
       pela FK locacao_itens.locacao_id) e o nome do equipamento junto —
       senão a tela precisaria de N+1 requisições para escrever "Betoneira". */
    list: function (opts) {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      opts = opts || {};
      var qs = '/locacoes?locadora_id=eq.' + id +
        '&select=*,locacao_itens(id,equipamento_id,quantidade,preco_dia_aplicado,subtotal,cobranca,equipamentos(nome,marca))' +
        '&order=data_saida.desc';
      /* Filtro por estado GRAVADO. 'atrasada' não entra aqui de
         propósito: é derivada e não existe na coluna — filtrar por ela
         no servidor devolveria vazio e pareceria "nenhuma atrasada". */
      if (opts.status) qs += '&status=eq.' + encodeURIComponent(opts.status);
      if (opts.limit)  qs += '&limit=' + parseInt(opts.limit, 10);
      return _get(qs);
    },

    getById: function (locId) {
      return _get('/locacoes?id=eq.' + encodeURIComponent(locId) +
        '&select=*,locacao_itens(id,equipamento_id,quantidade,preco_dia_aplicado,subtotal,cobranca,equipamentos(nome,marca))' +
        '&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },

    /* Quantas unidades de cada equipamento estão comprometidas hoje.
       Devolve { equipamento_id: quantidade }.

       Limitação que eu prefiro declarar a esconder: isto conta o que
       está fora AGORA, não faz reserva por período. Duas locações
       futuras em semanas diferentes disputam o mesmo estoque nesta
       conta. Resolver de verdade pede checar sobreposição de datas —
       decisão de produto, não de código, e fica registrada no PATCH. */
    comprometido: function () {
      var id = Auth.getId();
      if (!id) return Promise.resolve({});
      return _get('/locacoes?locadora_id=eq.' + id +
        '&status=in.(reservada,em_andamento,atrasada)' +
        '&select=id,status,locacao_itens(equipamento_id,quantidade)')
        .then(function (locs) {
          var mapa = {};
          (locs || []).forEach(function (l) {
            (l.locacao_itens || []).forEach(function (it) {
              if (!it || !it.equipamento_id) return;
              mapa[it.equipamento_id] = (mapa[it.equipamento_id] || 0) + (it.quantidade || 0);
            });
          });
          return mapa;
        });
    },

    /* Cria a locação e os itens.
       Sem transação: o PostgREST não expõe uma, e são duas tabelas. Se
       os itens falharem, a locação fica órfã — e uma locação sem item
       é lixo silencioso. Por isso o catch APAGA a locação recém-criada
       antes de propagar o erro. Não é atômico de verdade (se o delete
       também falhar, sobra), mas é honesto: o erro sobe, a tela avisa,
       e não fica um registro fantasma somando no relatório. */
    create: function (dados, itens) {
      var id = Auth.getId();
      if (!id) return Promise.reject(new Error('Não autenticado'));
      if (!itens || !itens.length) return Promise.reject(new Error('locacao_sem_itens'));

      var payload = {};
      Object.keys(dados || {}).forEach(function (k) { payload[k] = dados[k]; });
      payload.locadora_id = id;
      /* O banco tem CHECK (data_prevista_devolucao >= data_saida). Barrar
         aqui dá mensagem em português; deixar passar dá erro 400 cru. */
      if (!payload.data_saida || !payload.data_prevista_devolucao) {
        return Promise.reject(new Error('datas_obrigatorias'));
      }
      if (payload.data_prevista_devolucao < payload.data_saida) {
        return Promise.reject(new Error('data_devolucao_antes_da_saida'));
      }
      if (!payload.client_name) return Promise.reject(new Error('cliente_obrigatorio'));

      var locacaoCriada = null;
      return _post('/locacoes', payload)
        .then(function (rows) {
          locacaoCriada = Array.isArray(rows) ? rows[0] : rows;
          if (!locacaoCriada || !locacaoCriada.id) throw new Error('locacao_sem_id');
          var corpo = itens.map(function (it) {
            return {
              locacao_id:         locacaoCriada.id,
              equipamento_id:     it.equipamento_id,
              quantidade:         it.quantidade,
              preco_dia_aplicado: it.preco_dia_aplicado != null ? it.preco_dia_aplicado : null,
              subtotal:           it.subtotal != null ? it.subtotal : null,
              cobranca:           it.cobranca || null, /* v12.42 · composição por período */
            };
          });
          return _post('/locacao_itens', corpo);
        })
        .then(function () { return locacaoCriada; })
        .catch(function (err) {
          if (!locacaoCriada || !locacaoCriada.id) throw err;
          return _del('/locacoes?id=eq.' + encodeURIComponent(locacaoCriada.id))
            .catch(function () { /* o erro original importa mais que este */ })
            .then(function () { throw err; });
        });
    },

    /* Devolução. Grava a data REAL (pode ser diferente da prevista) e
       só então o status vira 'devolvida' — a partir daí o equipamento
       volta ao estoque em comprometido(). */
    marcarDevolvida: function (locId, dataDevolucaoISO, caucaoStatus) {
      var patch = {
        status:         'devolvida',
        data_devolucao: dataDevolucaoISO || _hojeLocal(),
      };
      /* pendente/retida/devolvida/abatida — o CHECK do banco recusa o resto. */
      if (caucaoStatus) patch.caucao_status = caucaoStatus;
      return _patch('/locacoes?id=eq.' + encodeURIComponent(locId), patch)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    cancelar: function (locId) {
      return _patch('/locacoes?id=eq.' + encodeURIComponent(locId), { status: 'cancelada' })
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    update: function (locId, data) {
      return _patch('/locacoes?id=eq.' + encodeURIComponent(locId), data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    /* v12.19 · editar uma locação (antes não havia como: data errada =
       cancelar e refazer). Mesmas validações do create. Os itens são
       trocados assim: grava os NOVOS primeiro e só depois apaga os
       antigos pelo id. Se gravar os novos falhar, nada foi apagado e a
       locação continua como estava; se apagar os antigos falhar, tenta
       de novo uma vez e avisa — nunca fica uma locação sem item. */
    atualizarComItens: function (locId, dados, itens, idsItensAntigos) {
      if (!locId) return Promise.reject(new Error('locacao_sem_id'));
      if (!itens || !itens.length) return Promise.reject(new Error('locacao_sem_itens'));
      if (!dados.data_saida || !dados.data_prevista_devolucao) return Promise.reject(new Error('datas_obrigatorias'));
      if (dados.data_prevista_devolucao < dados.data_saida) return Promise.reject(new Error('data_devolucao_antes_da_saida'));
      if (!dados.client_name) return Promise.reject(new Error('cliente_obrigatorio'));
      var payload = {};
      Object.keys(dados).forEach(function (k) { payload[k] = dados[k]; });
      delete payload.locadora_id; delete payload.id;
      var corpo = itens.map(function (it) {
        return {
          locacao_id: locId, equipamento_id: it.equipamento_id, quantidade: it.quantidade,
          preco_dia_aplicado: it.preco_dia_aplicado != null ? it.preco_dia_aplicado : null,
          subtotal: it.subtotal != null ? it.subtotal : null,
          cobranca: it.cobranca || null,
        };
      });
      var velhos = (idsItensAntigos || []).filter(Boolean);
      function apagarVelhos() {
        if (!velhos.length) return Promise.resolve();
        return _del('/locacao_itens?id=in.(' + velhos.map(encodeURIComponent).join(',') + ')');
      }
      return _patch('/locacoes?id=eq.' + encodeURIComponent(locId), payload)
        .then(function () { return _post('/locacao_itens', corpo); })
        .then(function () {
          return apagarVelhos().catch(function () { return apagarVelhos(); })
            .catch(function () { throw new Error('itens_antigos_ficaram'); });
        })
        .then(function () { return Locacoes.getById(locId); });
    },

    /* Locações que ainda ocupam equipamento, com datas — base do
       "livres nessas datas" do assistente de nova locação. */
    ativasComDatas: function () {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      return _get('/locacoes?locadora_id=eq.' + id +
        '&status=in.(reservada,em_andamento,atrasada)' +
        '&select=id,status,data_saida,data_prevista_devolucao,locacao_itens(equipamento_id,quantidade)');
    },

    remove: function (locId) {
      /* locacao_itens cai junto por ON DELETE CASCADE. */
      return _del('/locacoes?id=eq.' + encodeURIComponent(locId));
    },
  };

  /* ════════════════════════════════════════════════════════════
     FOTOS — v12.3: foto de perfil da locadora + fotos dos equipamentos
     ─────────────────────────────────────────────────────────────
     Mesmos buckets públicos do app dos profissionais, sem tabela nova:
       avatars/<uid>/locadora.jpg          → locadoras.logo_url
       photos/<uid>/equip/<aleatorio>.jpg  → equipamentos.fotos[]
     As policies av_write/ph_write exigem que a primeira pasta seja o
     auth.uid() — e o id da locadora É o auth.uid(). Nenhuma outra
     locadora consegue escrever aqui.

     A imagem é reduzida no aparelho antes de subir (mesmo motivo do
     uploadAvatar do db.js, v5.8.2): foto de celular tem 3–5 MB, o
     bucket recusa acima de 5 MB, e a locadora está no 4G da obra.
  ════════════════════════════════════════════════════════════ */
  var Fotos = (function () {
    var LIMITE_POR_EQUIP = 5;
    var cfg = FIELDO.config || {};

    function _reduzir(file, maxDim, qualidade) {
      return new Promise(function (resolve, reject) {
        if (!file || !/^image\//.test(file.type || '')) return reject(new Error('Escolha uma imagem (JPG ou PNG).'));
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          URL.revokeObjectURL(url);
          try {
            var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            var esc = Math.min(1, maxDim / Math.max(w, h));
            var cv = document.createElement('canvas');
            cv.width = Math.round(w * esc); cv.height = Math.round(h * esc);
            var ctx = cv.getContext('2d');
            ctx.fillStyle = '#ffffff';            /* PNG transparente não vira fundo preto no JPEG */
            ctx.fillRect(0, 0, cv.width, cv.height);
            ctx.drawImage(img, 0, 0, cv.width, cv.height);
            cv.toBlob(function (b) { b ? resolve(b) : reject(new Error('Não foi possível preparar a imagem.')); },
                      'image/jpeg', qualidade);
          } catch (e) { reject(e); }
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          /* HEIC do iPhone fora do Safari cai aqui. */
          reject(new Error('Este formato de imagem não abriu. Tente uma foto em JPG ou PNG.'));
        };
        img.src = url;
      });
    }

    function _subir(bucket, path, blob) {
      return Auth.Session.getAccessToken().then(function (token) {
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var t = ctrl ? setTimeout(function () { ctrl.abort(); }, 45000) : null;
        return fetch(cfg.STORAGE_URL + '/' + bucket + '/' + path, {
          method: 'PUT',
          headers: {
            'apikey':        cfg.ANON_KEY,
            'Authorization': 'Bearer ' + (token || cfg.ANON_KEY),
            'Content-Type':  'image/jpeg',
            'x-upsert':      'true',
          },
          body: blob,
          signal: ctrl ? ctrl.signal : undefined,
        }).then(function (r) {
          if (t) clearTimeout(t);
          if (r.ok) return cfg.SUPABASE_URL + '/storage/v1/object/public/' + bucket + '/' + path;
          if (r.status === 413) throw new Error('Imagem grande demais.');
          if (r.status === 401 || r.status === 403) throw new Error('Sua sessão expirou. Entre de novo.');
          throw new Error('O envio falhou (' + r.status + '). Tente de novo.');
        }, function (err) {
          if (t) clearTimeout(t);
          if (err && err.name === 'AbortError') throw new Error('A conexão demorou demais. Tente de novo.');
          throw new Error('Sem conexão. Tente de novo quando o sinal voltar.');
        });
      });
    }

    function _idAleatorio() {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }

    return {
      LIMITE_POR_EQUIP: LIMITE_POR_EQUIP,

      /* Foto de perfil: sobe, grava logo_url e devolve a locadora atualizada.
         O ?v= força o navegador (e a CDN da vitrine) a buscar a nova. */
      enviarPerfil: function (file) {
        var uid = Auth.getId();
        if (!uid) return Promise.reject(new Error('Sua sessão expirou. Entre de novo.'));
        var path = uid + '/locadora.jpg';
        return _reduzir(file, 640, 0.85)
          .then(function (blob) { return _subir('avatars', path, blob); })
          .then(function (url) { return Locadoras.update({ logo_url: url + '?v=' + Date.now() }); });
      },

      removerPerfil: function () {
        return Locadoras.update({ logo_url: null });
      },

      /* Foto de equipamento: só sobe e devolve a URL. Quem grava no
         equipamento é o Salvar do formulário (equipamentos.fotos). */
      enviarEquipamento: function (file) {
        var uid = Auth.getId();
        if (!uid) return Promise.reject(new Error('Sua sessão expirou. Entre de novo.'));
        var path = uid + '/equip/' + _idAleatorio() + '.jpg';
        return _reduzir(file, 1280, 0.82).then(function (blob) { return _subir('photos', path, blob); });
      },

      /* Apaga do bucket uma foto que saiu do equipamento. Melhor esforço:
         se falhar, sobra um arquivo órfão, nunca um erro na tela. Só
         apaga o que está na pasta da própria locadora. */
      apagar: function (url) {
        var uid = Auth.getId();
        var m = /\/storage\/v1\/object\/public\/(photos|avatars)\/([^?#]+)/.exec(String(url || ''));
        if (!uid || !m || m[2].indexOf(uid + '/') !== 0) return Promise.resolve(false);
        return Auth.Session.getAccessToken().then(function (token) {
          return fetch(cfg.STORAGE_URL + '/' + m[1] + '/' + m[2], {
            method: 'DELETE',
            headers: { 'apikey': cfg.ANON_KEY, 'Authorization': 'Bearer ' + (token || cfg.ANON_KEY) },
          }).then(function (r) { return r.ok; }, function () { return false; });
        }).catch(function () { return false; });
      },
    };
  })();

  return {
    Locadoras:             Locadoras,
    EquipamentoCategorias: EquipamentoCategorias,
    Equipamentos:          Equipamentos,
    Locacoes:              Locacoes,
    Datas:                 Datas,
    Fotos:                 Fotos,
  };
})();
