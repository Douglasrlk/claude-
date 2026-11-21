/* ============================================================
   Fieldo · db.js  v4.3
   ─────────────────────────────────────────────────────────────
   Camada de acesso ao Supabase + entitlement Pro local.
   URL:  https://jrsctnncoljdcvdofxsg.supabase.co
   Região: us-east-2

   ÍNDICE DE MÓDULOS (FIELDO.*)
   ┌──────────────────────────────────────────────────────────┐
   │  config         → URLs, anon key, plan limits             │
   │  UI             → toast, format, escape, errors           │
   │  Auth           → sessão por professional_id (telefone)   │
   │  AuthEmail      → DEPRECATED (stub) — substituído v4.0    │
   │                                                            │
   │  Professionals  → CRUD perfil + upload avatar             │
   │  Reports        → relatórios de serviço (local-first)     │
   │  Avaliacoes     → reviews atômicas                        │
   │  Hashes         → document hashes determinísticos          │
   │  Budgets        → orçamentos (local-first)                │
   │  Contratos      → empreitadas + work_entries (Pro)         │
   │  Marketplace    → busca pública                           │
   │                                                            │
   │  License        → HMAC verify offline (modelo FadReview)   │
   │  Validator      → estados tipados de licença              │
   │  RateLimit      → tentativas por janela                   │
   │  Pro            → wrapper de compat sobre License         │
   │                                                            │
   │  LocalDB        → IndexedDB wrapper (drafts/sync/photos)  │
   │  Draft          → auto-save de formulários                │
   │  SyncEngine     → fila + retry em background              │
   │                                                            │
   │  Niches         → categorias default + custom (NOVO 4.3)  │
   │  Themes         → paletas alternativas Pro (NOVO 4.3)     │
   │  Photos         → resize/upload pipeline (NOVO 4.3)       │
   │  UpgradeUI      → modal de upgrade (NOVO 4.3)             │
   │  UsageGuard     → entitlement+quota multi-camada (4.3)    │
   │                                                            │
   │  HBG / Nav      → menu UI compartilhado                   │
   └──────────────────────────────────────────────────────────┘

   v4.3 changes (Phase 3 + Phase 4 do roadmap pós-FadReview):
   - FIELDO.UpgradeUI: modal reutilizável com hero+features+CTAs
     (Ativar Pro / WhatsApp). Sem dep externa, estilos injetados.
   - FIELDO.UsageGuard: guard(action) + enforce(action) que abre
     UpgradeUI quando bloqueado. Single source pra "pode fazer X?".
   - FIELDO.Niches: 8 defaults + até 12 customizáveis (Pro).
     Persiste em LS, expõe emoji()/label() universais.
   - FIELDO.Themes: paper/midnight/sage/ember. Pro liberou os 3
     últimos. Boot aplica antes do paint pra evitar flash.
   - FIELDO.Photos: resize 1600px/JPEG .82 client-side, upload
     pra Supabase Storage com fallback no IDB pra retry offline.

   v4.2 changes (offline-first):
   - LocalDB + Draft + SyncEngine + Reports/Budgets local-first.

   v4.1 changes (Validator + RateLimit):
   - Validator: estados tipados VALID/EXPIRED/INVALID/RATE_LIMITED.
   - RateLimit: 5 tentativas/10min em ativações, sessionStorage.

   v4.0 changes (HMAC client-side):
   - FIELDO.License substitui RPCs activate_pro_code/has_pro_access
   - FIELDO.AuthEmail virou stub (Supabase Auth removido)
   - Emissao de licenca: Edge Function license-issue (v5.0)
============================================================ */

var FIELDO = (function () {
  'use strict';

  /* ════════════════════════════════════════════════════════════
     CONFIG — endpoints, chaves, limites
  ════════════════════════════════════════════════════════════ */
  var SUPABASE_URL  = 'https://jrsctnncoljdcvdofxsg.supabase.co';
  var REST_URL      = SUPABASE_URL + '/rest/v1';
  var STORAGE_URL   = SUPABASE_URL + '/storage/v1/object';
  var EDGE_URL      = SUPABASE_URL + '/functions/v1';

  /* ── v6.8: endereço público dos links compartilhados ──────────

     Problema real: testando em http://127.0.0.1:12886, os links
     enviados ao cliente saíam com esse endereço. O WhatsApp NÃO
     reconhece IP local como link — marca só os números soltos — e o
     cliente precisava recortar e colar. Pior: mesmo colando, o
     endereço não existe fora do aparelho do profissional.

     Link para terceiro precisa SEMPRE apontar para o domínio público,
     independentemente de onde o app está rodando. */
  /* ⚠️ CONFIGURE ANTES DE ENVIAR QUALQUER LINK A CLIENTE ⚠️

     Endereço público onde o app está publicado. É para cá que vão os
     links de relatório, orçamento e avaliação.

     Estava fixado em 'https://fieldo.netlify.app' desde a v4 — um
     domínio que NÃO pertence mais ao projeto (o site foi excluído da
     Netlify). Subdomínio abandonado pode ser registrado por qualquer
     um, e os links carregam TOKENS na URL: quem registrasse receberia
     token de avaliação e de aprovação de orçamento dos seus clientes.

     Deixar vazio é mais seguro que apontar para domínio alheio: sem
     configuração, o app usa a própria origem e avisa no console. */
  /* v11.0 · domínio próprio desde a v10.18. Só é usado fora de produção
     (publicUrl usa a origem real quando publicado), mas apontar para o
     endereço antigo fazia links gerados em teste local saírem com ele. */
  var PUBLIC_BASE_URL = 'https://fieldo-zelo.com.br';
  /* v9.3: configurado. O site publicado é fieldo-zelo.netlify.app —
     confirmado na Netlify, é o único projeto da conta. Foi um deploy
     por drop, publicado às 10:26 de 16/08/2026.
     'fieldo-app.netlify.app' NUNCA existiu: robots.txt e o sitemap
     anunciavam esse endereço havia 9 versões, e ele dá 404. */

  function _origemLocal(o) {
    return !o || o === 'null' || o === 'file://' ||
           /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.|0\.0\.0\.0)/.test(o);
  }

  /* Monta URL destinada ao CLIENTE. Em ambiente local usa o domínio
     público; em produção usa a origem real (permite domínio próprio
     sem mexer no código). */
  var _avisouUrl = false;

  function publicUrl(caminho) {
    var o = (typeof window !== 'undefined' && window.location && window.location.origin) || '';
    var base;

    if (!_origemLocal(o)) {
      base = o.replace(/\/+$/, '');            /* publicado: usa a origem real */
    } else if (PUBLIC_BASE_URL) {
      base = PUBLIC_BASE_URL.replace(/\/+$/, '');
    } else {
      /* Local e sem configuração: usa a origem local mesmo. O link não
         vai funcionar para o cliente — mas apontar para um domínio de
         terceiro seria pior. Avisa uma vez, alto. */
      base = o.replace(/\/+$/, '');
      if (!_avisouUrl) {
        _avisouUrl = true;
        console.warn('[Fieldo] PUBLIC_BASE_URL não configurado em db.js. ' +
          'Links gerados apontam para ' + base + ' e NÃO abrirão no aparelho do cliente.');
      }
    }
    return base + (String(caminho).charAt(0) === '/' ? '' : '/') + caminho;
  }

  /* ── v10.19 · A URL PÚBLICA DO PERFIL, NUM LUGAR SÓ ──────────────
   *
   * Quatro lugares montavam `perfil.html?slug=…` à mão: o Ver e o
   * Compartilhar do painel, e os dois equivalentes do meu-perfil. Essa
   * forma leva 301 para /p/:slug — funciona, mas é um salto a mais no
   * celular do cliente, e é o endereço não-canônico que sai circulando
   * no WhatsApp.
   *
   * O share-card já tinha sido corrigido na v10.9, com esta mesma
   * conclusão escrita lá: "link novo não tem por que nascer apontando
   * para o endereço antigo". Ficou pela metade — estes quatro não
   * foram junto.
   *
   * A migração de domínio expôs isso: um link antigo agora encadeia
   * netlify.app → 301 → com.br/perfil.html?slug= → 301 → com.br/p/slug.
   * Dois saltos.
   *
   * Sem slug não há URL limpa: /p/ exige slug. Aí continua o ?id=, que
   * é o caminho de quem ainda não completou o perfil.
   *
   * Mesma decisão do waLink na v5.5.2: uma implementação, para o bug
   * não voltar pelo quinto lugar. */
  function perfilUrl(prof, src) {
    var p = prof || {};
    var q = src ? '?src=' + encodeURIComponent(src) : '';
    if (p.slug) return publicUrl('p/' + encodeURIComponent(p.slug) + q);
    return publicUrl('perfil.html?id=' + encodeURIComponent(p.id || '') +
                     (src ? '&src=' + encodeURIComponent(src) : ''));
  }

  /* Permite checar do app se os links são compartilháveis */
  function publicUrlConfigurado() {
    var o = (typeof window !== 'undefined' && window.location && window.location.origin) || '';
    return !_origemLocal(o) || !!PUBLIC_BASE_URL;
  }
  var ANON_KEY      = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impyc2N0bm5jb2xqZGN2ZG9meHNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTEzMzgsImV4cCI6MjA5MDc4NzMzOH0.XJj5d37fOgK4nN9B3xI_x7P1HE_4lvnYC_qx_5eF0FI';

  var HEADERS = {
    'apikey':        ANON_KEY,
    'Authorization': 'Bearer ' + ANON_KEY,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
  };

  var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; /* 30 dias */

  /* v8.6: Contratos deixou de ser porta trancada e virou porta com
     medida. O módulo existia, funcionava, e o banco tinha 1 empreiteiro
     e 1 empreitada — de UM usuário, o próprio dono. Ninguém mais
     descobria: o item sumia do menu e o clique batia num modal.

     Os limites abaixo são de CRIAÇÃO, nunca de leitura. Quem foi Pro e
     voltou pro grátis continua enxergando e editando tudo o que já
     cadastrou — perder acesso ao próprio dado é confisco, não downgrade. */
  var PLAN_LIMITS = {
    free: { reportsPerMonth: 5,        empreiteiros: 1,        empreitadas: 1 },
    pro:  { reportsPerMonth: Infinity, empreiteiros: Infinity, empreitadas: Infinity },
  };

  /* ════════════════════════════════════════════════════════════
     ESTADO LOCAL (privado ao IIFE)
  ════════════════════════════════════════════════════════════ */
  var _profId   = null;
  var _profData = null;
  var _profRefreshing = false; /* v10.22 · trava contra refresh em paralelo. Ver Professionals.me. */

  /* ════════════════════════════════════════════════════════════
     INTERNAL HTTP — fetch wrapper para REST do Supabase
     Sempre usa anon key (RLS do banco é a fonte de verdade).
     v5.0: todo request autenticado leva o JWT do Supabase Auth.
     A RLS do Postgres é a única fonte de verdade de autorização.
  ════════════════════════════════════════════════════════════ */
  /* v10.6 · o `Prefer` deixou de ser fixo — e isso conserta um bug de
     dois meses.
     ─────────────────────────────────────────────────────────────────
     `return=representation` faz o PostgREST devolver a linha inserida,
     o que exige privilégio de SELECT além do de INSERT. As tabelas de
     escrita pública (signup_leads, funnel_events) dão INSERT ao `anon`
     e NÃO dão SELECT — de propósito: qualquer visitante pode deixar um
     lead, ninguém pode ler a lista de leads pela API.

     Resultado: todo INSERT público voltava
     `permission denied for table signup_leads`. A captura de lead do
     onboarding nunca gravou uma linha sequer. `signup_leads` com 0
     linhas parecia "ninguém digitou e-mail" — e o próprio comentário da
     função no entrar.html já temia exatamente essa leitura errada.

     Confirmado no banco: o mesmo INSERT com `anon` passa sem RETURNING
     e falha com RETURNING.

     `return=minimal` não pede a linha de volta, então basta o INSERT. */
  function _headers(token, prefer) {
    return {
      'apikey':        ANON_KEY,
      'Authorization': 'Bearer ' + (token || ANON_KEY),
      'Content-Type':  'application/json',
      'Prefer':        prefer || 'return=representation',
    };
  }

  /* opts.anon = true  → força a anon key (leitura pública: QR, perfil,
     marketplace). Sem isso, o JWT do dono vazaria em página pública. */
  function _req(method, path, body, opts) {
    opts = opts || {};
    function envia(token) {
      var init = { method: method, headers: _headers(token, opts.prefer) };
      if (body !== undefined) init.body = JSON.stringify(body);
      /* v5.8.2: com timeout. Sem ele, uma requisição que nunca responde
         (sinal oscilando, proxy travado) deixa o botão girando
         indefinidamente — o usuário não sabe se espera ou desiste.

         v9.15: 25s continua o padrão, porque é a espera de QUEM ESTÁ
         TRABALHANDO — subindo foto de obra no 4G ruim, com o dado já
         salvo localmente. Mas as páginas públicas têm outro dono da
         espera: o CLIENTE, que só quer ler e vai embora antes disso.
         Elas passam `timeout` menor. Um número só não servia pros
         dois — e o jeito errado de resolver seria uma segunda
         implementação de timeout. */
      return _fetchComTimeout(REST_URL + path, init, opts.timeout || 25000);
    }

    var tokenP = opts.anon ? Promise.resolve(null) : Session.getAccessToken();

    return tokenP.then(envia).then(function (r) {
      /* ── v7.1: UMA retentativa quando o servidor responde 401 ──

         `getAccessToken` devolve o token ANTIGO quando o refresh falha.
         Isso é deliberado — é o que mantém o app utilizável offline.
         Mas ONLINE produz uma requisição condenada: o JWT está vencido,
         o Supabase responde 401, e a tela mostra "erro ao carregar".

         Recarregar a página resolvia porque o refresh que havia falhado
         terminava em segundo plano e gravava o token novo. Era o bug do
         "o erro some quando eu atualizo".

         401 é o servidor dizendo que a credencial venceu. A resposta
         certa é renovar e tentar de novo, uma vez só — laço de refresh
         em token realmente inválido seria pior que o erro. */
      if (r.status !== 401 || opts.anon) return r;
      return Session.refresh()
        .then(function (ns) { return envia(ns && ns.access_token); })
        .catch(function () { return r; });
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) {
        var err = new Error(t || ('HTTP ' + r.status));
        err.status = r.status;
        throw err;
      });
      var ct = r.headers.get('content-type') || '';
      return ct.includes('json') ? r.json() : r.text();
    });
  }

  function _get(path, opts)   { return _req('GET',    path, undefined, opts); }
  function _post(path, body)  { return _req('POST',   path, body); }
  /* v7.6: par de _get/_getPublic, mas pra POST — precisa pra captura
     de lead, que acontece ANTES de qualquer sessão existir (a pessoa
     ainda não clicou em "Criar meu perfil"). Sem isto, _post tentaria
     usar um JWT que não existe. */
  /* Escrita pública: quem chama não tem (nem deve ter) SELECT na tabela,
     então não pode pedir a linha de volta. Ver _headers. */
  function _postPublic(path, body, opts) {
    opts = opts || {};
    return _req('POST', path, body, {
      anon:    true,
      prefer:  opts.prefer || 'return=minimal',
      timeout: opts.timeout,
    });
  }
  function _patch(path, body) { return _req('PATCH',  path, body); }
  function _del(path)         { return _req('DELETE', path); }

  /* ── v6.7: colunas seguras por tabela ────────────────────────

     A v6.5 revogou colunas sensíveis do `anon` (tokens, telefone,
     e-mail). Efeito colateral: o PostgREST monta `SELECT *`, e no
     Postgres isso exige privilégio em TODAS as colunas — a consulta
     inteira passou a falhar com "permission denied", derrubando perfil,
     relatório e busca.

     Em vez de espalhar `select=` por dezenas de chamadas (e esquecer
     numa delas), a lista fica aqui, num lugar só. Coluna nova precisa
     ser adicionada aqui para virar pública — o padrão passa a ser
     "privado até que se decida o contrário". */
  var COLUNAS_PUBLICAS = {
    /* v10.30 · area_atendimento/tipo_atendimento entraram aqui de
       propósito. phone e email NÃO entram: email é o canal privado de
       notificação da conta (configuracoes.html) e phone nunca teve UI
       que o preenchesse — nenhum profissional consentiu em expor
       nenhum dos dois numa página pública.
       v10.32 · pix_key/pix_tipo/include_pix SAÍRAM daqui — correção de
       segurança. Enquanto estavam nesta lista, o GRANT column-level do
       anon na tabela deixava qualquer visitante baixar a chave Pix
       (em alguns casos o próprio CPF) de TODO profissional público
       numa única chamada REST, sem precisar de link nenhum — mesma
       classe de bug que este projeto já corrigiu uma vez pra
       `rating_token` (ver getByToken, mais abaixo). Quem precisa
       mostrar o Pix de UM profissional específico numa página pública
       (hoje só relatorio.html) usa Professionals.getPixPublico(id) —
       mesma regra de visibilidade de sempre, um profissional por vez,
       nunca a tabela inteira. */
    professionals: 'id,name,profissao,specialty,niche,city,slug,whatsapp,bio,' +
                   'logo_url,instagram,plan,' +
                   'is_public,portfolio_publico,area_atendimento,tipo_atendimento,created_at,' +
                   /* v12.13 · credibilidade: CNPJ conferido + campos declarados */
                   'cnpj,empresa_nome,cnpj_situacao,cnpj_abertura,cnpj_verificado_em,' +
                   'atua_desde,garantia,formas_pagamento,atende_urgencia,registros,' +
                   /* v12.30 · outras_profissoes faltava desde a v12.25 e
                      cidades_atendidas desde a v12.28: o servidor mostrava
                      "Também: Encanador" e "Também atende Ubatuba" e o JS
                      apagava as duas linhas um instante depois, porque a
                      leitura pública não trazia as colunas. aceita_ligacao
                      é o botão "Ligar" (v12.30). As duas últimas só existem
                      depois do SQL das fases 3 e 5: ver _comSelect(path, nivel). */
                   'outras_profissoes,cidades_atendidas,aceita_ligacao',
    /* v11.0 · segurança (auditoria 11/10/2026, achado C2). Esta lista
       levava client_name, service_location, valor, payment_status,
       paid_at, client_paid_claim_at e linked_budget_id — e o GRANT do
       anon acompanhava. Resultado: qualquer visitante listava nome,
       endereço e valor de TODOS os clientes de TODOS os profissionais
       numa chamada só. Mesma classe de bug que a v10.32 fechou no Pix.
       Agora a leitura pública leva só o que a vitrine mostra; o nome
       vem já encurtado do banco (cliente_curto, mantido por gatilho).
       Dado completo do cliente sai só por quem tem o link: dono logado
       (RLS), cliente pelo token (report_por_token) ou pelo orçamento
       (relatorio_do_orcamento).

       v12.26 · auditoria SEO/GEO (03/11), achado P1. A descrição inteira
       (service_description) e o nome curto do cliente também saíram:
       a descrição é a mensagem ao cliente, com valor, saldo de
       empreitada e endereço. A vitrine mostra só o título limpo, que o
       banco agora calcula (titulo_publico, mesma regra de
       Profissoes.tituloServico). `tipo` separa serviço de foto de
       trabalho (portfolio), que não conta como serviço (achado P2).
       Antes do SQL da v12.26 as colunas não existem: _comSelect(path,
       true) devolve a lista antiga para a segunda tentativa (ver
       _getPublic). */
    reports:       'id,professional_id,category_key,category_label,' +
                   'niche,service_date,titulo_publico,tipo,' +
                   'photos,is_public,rating,rating_comment,rating_used,' +
                   'portfolio_ok,created_at,updated_at',
    /* v11.0 · `budgets` SAIU daqui de propósito. Nenhuma página pública
       lista orçamentos, e o anon deixou de ter qualquer leitura direta
       na tabela. O cliente abre o dele pelo link: orcamento_publico(id)
       ou orcamento_por_token(t). Ver Budgets.getById. */
    /* v11.0 · nome de quem avaliou só na forma curta ("Maria A."). */
    avaliacoes:    'id,professional_id,report_id,nota,comentario,nome_avaliador_curto,' +
                   'resposta,respondido_em,created_at',
    /* v11.0 · o resumo do selo leva o nome completo do cliente, e o
       ref_id de orçamento é a chave do link do cliente. Listagem pública
       só serve para contar selos; conferir um documento é pela RPC
       verificar_hash (quem tem o hash) e o selo de um relatório pela
       RPC selo_por_ref. Ver Hashes.verify/getByRef. */
    document_hashes: 'id,professional_id,tipo,created_at',

    /* v7.0 · Locação.

       `equipamentos` tem colunas revogadas do anon, então SEM esta
       entrada o PostgREST monta SELECT * e a leitura pública do
       catálogo falha inteira com "permission denied" — exatamente a
       regressão da v6.5 que a v6.7 corrigiu. Coluna nova só vira
       pública ao ser escrita aqui.

       `locacoes` NÃO entra, de propósito: o anon não recebe uma coluna
       sequer dessa tabela (tem CPF da caução). O cliente enxerga a
       locação dele pela RPC do token, nunca por leitura direta. */
    /* ⚠️ v7.1: era `professional_id`. A coluna virou `locadora_id`
       quando locadora passou a ser entidade própria, e este mapa ficou
       para trás. PostgREST devolve 400 "column does not exist" e a
       leitura pública do catálogo falha inteira — não degrada, quebra. */
    /* v7.9: locadoras faltava aqui — mesma classe de bug do v6.5/v6.7
       em equipamentos. Sem esta entrada, qualquer leitura pública de
       locadoras vira SELECT * e falha inteira com "permission denied",
       porque só um subconjunto de colunas tem GRANT pro anon (cnpj,
       razao_social, email, phone, pix_key/tipo, plan* ficam de fora).
       Confirmado 1:1 contra os GRANTs reais do banco antes de escrever
       esta lista — não é suposição. */
    locadoras:     'id,nome,slug,city,city_slug,uf,endereco,whatsapp,bio,' +
                   'logo_url,instagram,horario,entrega,raio_entrega_km,' +
                   'is_public,created_at,updated_at',

    equipamentos:  'id,locadora_id,categoria_id,nome,marca,modelo,' +
                   'descricao,specs,fotos,preco_dia,preco_semana,preco_mes,' +
                   'caucao,quantidade,slug,ativo,is_public,created_at,updated_at',
  };

  /* Injeta `select=` quando a chamada não trouxe um. Views não precisam
     (não têm colunas revogadas), então ficam de fora do mapa. */
  /* v12.30 · `nivel` diz quantos SQLs ainda faltam rodar (true = 1, como
     antes). 0 = as colunas de hoje. Em reports, 1 ou mais = antes da
     v12.26. Em professionals, 1 = sem a coluna da fase 5
     (aceita_ligacao), 2 = sem a da fase 3 também (cidades_atendidas). */
  function _comSelect(path, nivel) {
    if (path.indexOf('select=') !== -1) return path;
    var tabela = (path.match(/^\/([a-z_]+)/) || [])[1];
    var cols = COLUNAS_PUBLICAS[tabela];
    if (!cols) return path;
    nivel = nivel === true ? 1 : (Number(nivel) || 0);
    /* v12.26 · banco ainda sem titulo_publico: a lista de antes */
    if (nivel >= 1 && tabela === 'reports') cols = cols.replace('titulo_publico,tipo', 'service_description,cliente_curto');
    if (nivel >= 1 && tabela === 'professionals') cols = cols.replace(',aceita_ligacao', '');
    if (nivel >= 2 && tabela === 'professionals') cols = cols.replace(',cidades_atendidas', '');
    return path + (path.indexOf('?') === -1 ? '?' : '&') + 'select=' + cols;
  }
  /* v12.26 · "a coluna titulo_publico não existe" = o site foi publicado
     antes do SQL. Só nesse caso vale tentar de novo com a lista antiga;
     depois do SQL esse erro não acontece mais. */
  function _semTituloPublico(err) {
    return !!err && Number(err.status || err) === 400 &&
      /titulo_publico|tipo|aceita_ligacao|cidades_atendidas/.test(String(err.message || err.corpo || ''));
  }

  /* Leitura pública explícita — usada por relatorio/perfil/explorar */
  var _pub = { anon: true };
  function _getPublic(path) {
    var tentar = function (nivel) {
      return _get(_comSelect(path, nivel), _pub).catch(function (err) {
        if (nivel < 2 && _semTituloPublico(err)) return tentar(nivel + 1);
        throw err;
      });
    };
    return tentar(0);
  }

  /* RPC (funções SECURITY DEFINER do Postgres) */
  function _rpc(fn, args, opts) {
    return _req('POST', '/rpc/' + fn, args || {}, opts);
  }

  /* ════════════════════════════════════════════════════════════
     LS — wrapper com prefixo "fieldo_" para evitar colisão

     v7.0 — namespace de app (Fieldo / Locação / Zelo) no mesmo
     domínio. localStorage é por ORIGEM, não por path: sem isto,
     /zelo/ e /locacao/ leriam a MESMA sessão do Fieldo profissional
     no mesmo aparelho. window.FIELDO_APP_NS deve ser definido ANTES
     deste script carregar, só nas páginas de /zelo/ e /locacao/. O
     Fieldo core nunca define isso → cai em '' → mesmas chaves de
     sempre, ninguém desloga em produção.
  ════════════════════════════════════════════════════════════ */
  var APP_NS = (typeof window !== 'undefined' && window.FIELDO_APP_NS) || '';
  function _lsKey(k) {
    return APP_NS ? ('fieldo_' + APP_NS + '_' + k) : ('fieldo_' + k);
  }
  var LS = {
    get:    function (k)    { try { return JSON.parse(localStorage.getItem(_lsKey(k))); } catch(e) { return null; } },
    set:    function (k, v) { try { localStorage.setItem(_lsKey(k), JSON.stringify(v)); } catch(e) {} },
    remove: function (k)    { try { localStorage.removeItem(_lsKey(k)); } catch(e) {} },
  };

  /* ════════════════════════════════════════════════════════════
     ORIGEM — de onde veio quem se cadastrou  (v9.4)

     A v9.1 pôs `?de=relatorio` e `?de=orcamento` nos convites dos
     documentos, e o teste da época dizia "a origem é rastreável".
     Era meia verdade: o link CARREGA o parâmetro e nada do outro
     lado gravava. Não existia coluna em signup_leads nem em
     professionals. Rastreável no sentido de que a informação passa
     pela porta — e cai no chão.

     Isso é o mesmo defeito das quatro correções anteriores: a peça
     existe, a regra existe, a ligação entre as duas não. Desta vez
     fui eu quem construiu, na versão passada.

     Por que isto vem ANTES de qualquer anúncio: sem esta linha, um
     cadastro vindo do Instagram pago e um vindo do relatório de
     serviço são exatamente a mesma linha no banco. Não dá para
     saber se o dinheiro fez alguma coisa.

     PRIMEIRO TOQUE, não último. Quem chega pelo relatório, some, e
     volta uma semana depois pelo Google continua sendo do
     relatório — foi o relatório que apresentou o produto. Último
     toque daria crédito à busca pelo nome, que é consequência.

     Sem cookie, sem terceiro, sem pixel: é a nossa própria URL
     escrita no nosso próprio banco. Não há o que consentir com
     terceiro porque não há terceiro.
  ════════════════════════════════════════════════════════════ */
  /* ═══════════════════════════════════════════════════
     CONSENTIMENTO — v12.36 (LGPD)
     ───────────────────────────────────────────────────
     A escolha do banner de cookies (consentimento.js) fica em
     localStorage 'fieldo_consent', SEM namespace de app: vale para o
     Fieldo, o Zelo e a Locação ao mesmo tempo, porque é a mesma origem
     e a mesma pessoa no mesmo navegador.

     Regra: sem "Aceitar" explícito, nada de medição. Nem identificador
     de visitante, nem origem gravada, nem page_view. Recusar ou não
     responder dá o mesmo resultado.
  ═══════════════════════════════════════════════════ */
  var Consentimento = {
    CHAVE: 'fieldo_consent',
    ler: function () {
      try { return JSON.parse(localStorage.getItem('fieldo_consent')) || null; } catch (e) { return null; }
    },
    /* Mesma regra do consentimento.js: versão 1 e escolha com menos de
       365 dias. Vencida, vale como "ainda não respondeu" (sem medição). */
    analytics: function () {
      var c = Consentimento.ler();
      if (!c || c.v !== 1 || c.analytics !== true) return false;
      if (c.ts && (Date.now() - Date.parse(c.ts)) > 365 * 864e5) return false;
      return true;
    },
  };

  var Origem = (function () {
    var KEY = 'origem';
    var _memoria = null; /* v12.36 · sem consentimento a origem vive só nesta página */

    /* O valor vem da URL, que é do usuário. Normaliza e corta. O
       banco também tem CHECK de 120 — cinto e suspensório, porque
       aqui é o cliente e cliente não é lugar de confiar. */
    function _limpar(s) {
      return String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9:_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
    }

    function _param(busca, nome) {
      var m = new RegExp('[?&]' + nome + '=([^&#]*)').exec(busca || '');
      return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
    }

    /* A ordem importa e é uma decisão, não acaso:
       1. `de=`  — nosso, explícito, posto por nós no rodapé do
                   documento. Vence tudo.
       2. utm_*  — o que anúncio e campanha usam. Guarda origem e
                   campanha juntas para dar pra separar criativo.
       3. fbclid — a Meta carimba sozinha, mesmo sem utm. Salva o
                   caso de esquecer a utm no anúncio, que acontece.
       4. referrer externo — alguém linkou de algum lugar.
       Nada disso → null, que na leitura vira "direto". */
    function detectar(busca, referrer, origemAtual) {
      var de = _param(busca, 'de');
      if (de) return _limpar(de);

      var src  = _param(busca, 'utm_source');
      var camp = _param(busca, 'utm_campaign');
      if (src) return _limpar(camp ? src + ':' + camp : src);

      if (_param(busca, 'fbclid')) return 'meta:sem-utm';

      var ref = String(referrer || '');
      if (ref) {
        var host = (/^https?:\/\/([^\/]+)/.exec(ref) || [])[1] || '';
        /* referrer do próprio site não é origem — é navegação interna */
        if (host && host !== String(origemAtual || '').replace(/^https?:\/\//, '')) {
          return _limpar('ref:' + host.replace(/^www\./, ''));
        }
      }
      return null;
    }

    return {
      detectar: detectar,   /* exposto para teste, sem depender de window */

      /* Roda no carregamento de qualquer página. Só grava se ainda
         não houver nada: primeiro toque. */
      capturar: function () {
        if (typeof window === 'undefined' || !window.location) return null;
        var atual = LS.get(KEY);
        if (atual) return atual;
        var achado = detectar(window.location.search,
                              (typeof document !== 'undefined' && document.referrer) || '',
                              window.location.origin);
        /* v12.36 · só grava no navegador com consentimento de medição */
        if (achado && Consentimento.analytics()) LS.set(KEY, achado);
        else if (achado) _memoria = achado;
        return achado;
      },

      /* v12.36 · chamado quando a pessoa aceita no banner: o que estava
         só em memória passa a valer para as próximas páginas. */
      persistir: function () {
        if (_memoria && !LS.get(KEY) && Consentimento.analytics()) LS.set(KEY, _memoria);
      },

      valor: function () { return LS.get(KEY) || _memoria || null; },
    };
  })();

  /* ════════════════════════════════════════════════════════════
     ANALYTICS — funil de aquisição site-wide  (v10.23)
     ─────────────────────────────────────────────────────────────
     Por que existe: o site tinha impact_events (visita/whatsapp por
     PERFIL) e funnel_events (2 passos do formulário de cadastro), e
     nada entre eles. Dava pra saber quantos começaram o cadastro, não
     quantos CHEGARAM antes disso — se o vazamento é na landing, isso
     era invisível.

     anonymous_id: id de visitante, gerado no navegador, sem relação com
     documento/contato. authenticated ou não, todo mundo tem um, desde a
     primeira página. session_id vive no sessionStorage de propósito —
     ele expira sozinho quando a aba fecha, que é exatamente o limite de
     "uma sessão" que faz sentido aqui, sem reimplementar timeout de
     inatividade.

     Escreve em analytics_events via o MESMO postPublic que já existe
     (mesmo padrão de funnel_events/signup_leads: insert-only, sem
     SELECT para anon — quem lê é a Edge Function admin-analytics, com
     service role, atrás do portão x-admin-key). Nunca pode atrapalhar
     quem está navegando: toda chamada é best-effort, sempre com catch,
     nunca lançada pra fora.
  ════════════════════════════════════════════════════════════ */
  var Analytics = (function () {
    var ANON_ID_KEY    = 'analytics_anon_id';
    var SESSION_ID_KEY = '_fieldo_session_id'; /* sessionStorage direto — de propósito sem passar por LS/_lsKey: não deve sobreviver ao fechar a aba */
    var _sessionId  = null;
    var _erros      = 0;
    var MAX_ERROS_POR_PAGINA = 5; /* uma tela quebrada em loop não pode virar milhares de inserts */

    /* Eventos de "chegou nesta página" que dependem só do pathname —
       cobre explore_view/subscription_view/landing_view em três páginas
       inteiras sem precisar tocar em nenhuma delas. */
    var VIEW_POR_PATH = {
      '/':              'landing_view',
      '/index.html':    'landing_view',
      '/explorar':      'explore_view',
      '/explorar.html': 'explore_view',
      '/planos.html':   'subscription_view',
    };

    function _uuid() {
      try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
      /* fallback só precisa ser único, não criptográfico */
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }

    function anonymousId() {
      var id = LS.get(ANON_ID_KEY);
      if (id) return id;
      id = _uuid();
      LS.set(ANON_ID_KEY, id);
      return id;
    }

    function sessionId() {
      if (_sessionId) return _sessionId;
      try {
        var id = sessionStorage.getItem(SESSION_ID_KEY);
        if (!id) { id = _uuid(); sessionStorage.setItem(SESSION_ID_KEY, id); }
        _sessionId = id;
      } catch (e) {
        _sessionId = _uuid(); /* sem sessionStorage disponível (aba privada?) — ainda funciona só nesta página */
      }
      return _sessionId;
    }

    function device() {
      var ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      if (/iPad|Tablet|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
      if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile';
      return 'desktop';
    }

    function track(eventName, props) {
      if (typeof window === 'undefined' || !FIELDO.rest || !FIELDO.rest.postPublic) return;
      /* v12.36 · LGPD: sem "Aceitar" no banner, nenhum evento sai daqui */
      if (!Consentimento.analytics()) return;
      try {
        var userId = null;
        try { userId = FIELDO.Auth && FIELDO.Auth.getId && FIELDO.Auth.getId(); } catch (e2) {}
        FIELDO.rest.postPublic('/analytics_events', {
          event_name:   String(eventName).slice(0, 60),
          anonymous_id: anonymousId(),
          session_id:   sessionId(),
          user_id:      userId || null,
          pathname:     window.location.pathname,
          referrer:     document.referrer || null,
          origem:       (FIELDO.Origem && FIELDO.Origem.valor()) || null,
          device:       device(),
          props:        props || {},
        }, { timeout: 8000 }).catch(function (err) {
          console.error('[analytics] evento não registrado (navegação segue normal):', eventName, err);
        });
      } catch (e) {
        console.error('[analytics] track falhou:', e);
      }
    }

    function _hookErros() {
      if (typeof window === 'undefined') return;
      window.addEventListener('error', function (ev) {
        if (_erros++ >= MAX_ERROS_POR_PAGINA) return;
        track('client_error', { message: String((ev && ev.message) || 'erro desconhecido').slice(0, 200) });
      });
      window.addEventListener('unhandledrejection', function (ev) {
        if (_erros++ >= MAX_ERROS_POR_PAGINA) return;
        var r = ev && ev.reason;
        track('client_error', { message: String((r && r.message) || r || 'rejeição não tratada').slice(0, 200) });
      });
    }

    function _autoPageView() {
      if (typeof window === 'undefined') return;
      track('page_view');
      var evento = VIEW_POR_PATH[window.location.pathname];
      if (evento) track(evento);
    }

    return {
      track:        track,
      anonymousId:  anonymousId,
      sessionId:    sessionId,
      _hookErros:     _hookErros,   /* uso interno — chamado no auto-boot no fim do arquivo */
      _autoPageView:  _autoPageView, /* idem */
    };
  })();

  /* ════════════════════════════════════════════════════════════
     SESSION — identidade via Supabase Anonymous Auth  (v5.0)

     Substitui a "sessão" v4 (um professional_id solto no
     localStorage, que o banco nunca verificava).

     Agora existe um usuário real em auth.users e um JWT assinado
     pelo Supabase. É esse JWT que faz auth.uid() funcionar — e é
     auth.uid() que torna a RLS possível. Sem isso, toda policy
     precisaria voltar a ser USING(true).

     Offline: o JWT é um arquivo de texto no dispositivo. Depois do
     primeiro boot, o app abre e opera sem rede. O refresh_token
     do Supabase não expira por inatividade, então voltar online
     depois de semanas ainda renova a sessão.

     Custo honesto: o PRIMEIRO boot exige internet uma única vez.
     Não há como emitir identidade verificável offline.
  ════════════════════════════════════════════════════════════ */
  var Session = (function () {

    var AUTH_URL   = SUPABASE_URL + '/auth/v1';
    var KEY        = 'auth';          /* LS.get('auth') */
    var SKEW_MS    = 120 * 1000;      /* renova 2min antes de expirar */
    var _mem       = null;
    var _refreshing = null;           /* dedupe de refresh concorrente */

    function _load() {
      if (_mem) return _mem;
      var s = LS.get(KEY);
      if (s && s.access_token && s.user_id) _mem = s;
      return _mem;
    }

    function _save(raw) {
      if (!raw || !raw.access_token) return null;
      var s = {
        access_token:  raw.access_token,
        refresh_token: raw.refresh_token || null,
        user_id:       (raw.user && raw.user.id) || (_mem && _mem.user_id),
        expires_at:    Date.now() + ((raw.expires_in || 3600) * 1000),
      };
      _mem = s;
      LS.set(KEY, s);
      return s;
    }

    function clear() { _mem = null; LS.remove(KEY); }

    function userId() { var s = _load(); return s ? s.user_id : null; }

    function _authFetch(path, body) {
      return fetch(AUTH_URL + path, {
        method:  'POST',
        headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body || {}),
      }).then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) {
            var e = new Error(j.msg || j.error_description || j.error || ('HTTP ' + r.status));
            e.status = r.status;
            e.code   = j.error_code || j.error;
            throw e;
          }
          return j;
        });
      });
    }

    /* Cria um usuário anônimo real. Sem email, sem senha, sem tela
       de login — mas com uuid e JWT válidos. */
    function signInAnonymously() {
      return _authFetch('/signup', {}).then(function (j) { return _save(j); });
    }

    function refresh() {
      var s = _load();
      if (!s || !s.refresh_token) return Promise.reject(new Error('sem refresh_token'));
      if (_refreshing) return _refreshing;
      _refreshing = _authFetch('/token?grant_type=refresh_token', {
        refresh_token: s.refresh_token,
      }).then(function (j) {
        _refreshing = null;
        return _save(j);
      }).catch(function (err) {
        _refreshing = null;
        /* refresh_token revogado/inválido → sessão morta de verdade */
        if (err.status === 400 || err.status === 401) clear();
        throw err;
      });
      return _refreshing;
    }

    /* Token para o REST. Renova se estiver perto de expirar E houver
       rede. Offline, devolve o token atual mesmo vencido: as leituras
       vêm do IndexedDB e as escritas caem na fila do SyncEngine, que
       reenvia com token novo quando a conexão voltar. */
    function getAccessToken() {
      var s = _load();
      if (!s) return Promise.resolve(null);

      var expiring = Date.now() > (s.expires_at - SKEW_MS);
      var online   = (typeof navigator === 'undefined') || navigator.onLine !== false;

      if (!expiring || !online) return Promise.resolve(s.access_token);

      return refresh()
        .then(function (ns) { return ns.access_token; })
        .catch(function () { return s.access_token; });
    }

    /* Fase 3 (evolução OAuth, ver MCP-fieldo-auditoria.md PARTE 3) —
       único chamador: oauth-conectar.html. Todo o resto do app só
       precisa do access_token (pra montar um cabeçalho Authorization
       na mão via _authFetch/_req) — mas a lib oficial supabase-js
       (usada SÓ nessa página, pra falar com o OAuth Server) exige os
       DOIS tokens juntos em auth.setSession({access_token,
       refresh_token}). Por isso esta função existe separada de
       getAccessToken: não é a mesma necessidade, e nenhum outro lugar
       do app deveria começar a depender do refresh_token direto — ele
       nunca saiu daqui antes. Reaproveita getAccessToken() (que já
       renova se precisar) em vez de duplicar essa lógica. */
    function getTokens() {
      return getAccessToken().then(function (access_token) {
        var s = _load();
        return (s && access_token) ? { access_token: access_token, refresh_token: s.refresh_token } : null;
      });
    }

    /* Vincula um código de recuperação à identidade anônima.

       Converte o usuário anônimo em permanente usando um email
       sintético DERIVADO DO PRÓPRIO CÓDIGO. Assim a recuperação
       precisa só do código — o profissional não decora uuid nenhum.

       Entropia: 16 chars em base32 Crockford ≈ 80 bits. Inviável
       de adivinhar, e o Supabase ainda aplica rate limit por IP. */
    var ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; /* sem I,L,O,U */

    function generateRecoveryCode() {
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      var out = '';
      for (var i = 0; i < 16; i++) out += ALPHABET[bytes[i] % 32];
      return out;
    }

    /* ── v6.5: o e-mail sintético deixou de conter o código ─────

       ANTES:  fd-6w1h8vss1p8kxtw8@device.fieldo.app
       O código estava LEGÍVEL em auth.users.email. Eu documentei três
       vezes que "o servidor nunca vê o código em texto claro" — era
       falso. Qualquer pessoa com leitura do banco (painel, backup
       vazado, futuro funcionário) assumia qualquer conta.

       AGORA: o e-mail carrega o SHA-256 do código, não o código.
       O servidor guarda:
         · email = hash (irreversível)
         · senha = bcrypt do código (irreversível)

       Nenhum dos dois permite reconstruir o código. E a recuperação
       continua exigindo apenas o código: o próprio aparelho calcula o
       hash para descobrir o e-mail. */
    function _sha256Hex(txt) {
      if (!(crypto && crypto.subtle)) {
        return Promise.reject(new Error('crypto_indisponivel'));
      }
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt))
        .then(function (buf) {
          var b = new Uint8Array(buf), s = '';
          for (var i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
          return s;
        });
    }

    /* Prefixo fixo para o hash não colidir com outro uso do mesmo código */
    function _emailFor(code) {
      return _sha256Hex('fieldo-recovery-v1:' + String(code).toUpperCase())
        .then(function (hex) {
          /* 32 hex = 128 bits: colisão é inviável, e cabe num e-mail */
          return 'fd-' + hex.slice(0, 32) + '@device.fieldo.app';
        });
    }

    /* v10.6 · a derivação do e-mail sintético foi separada do PUT.
     *
     * Motivo: o onboarding precisa saber se `crypto.subtle` existe ANTES
     * de criar o perfil — em http comum a conta nasceria sem recuperação
     * possível, e a pessoa só descobriria ao trocar de celular. Ao mesmo
     * tempo, o PUT precisa acontecer DEPOIS do perfil (ver comentário em
     * criarPerfil no entrar.html): ele rotaciona a sessão e derrubava o
     * insert que vinha em seguida.
     *
     * Separando as duas metades, o entrar.html consegue as duas coisas:
     * valida o crypto cedo, aplica o código tarde. */
    function recoveryEmailFor(code) {
      return _emailFor(code);
    }

    function attachRecoveryCode(code, emailPronto) {
      return Promise.all([
        getAccessToken(),
        emailPronto ? Promise.resolve(emailPronto) : _emailFor(code),
      ]).then(function (r) {
        var tok = r[0], email = r[1];
        return fetch(AUTH_URL + '/user', {
          method: 'PUT',
          headers: {
            'apikey':        ANON_KEY,
            'Authorization': 'Bearer ' + tok,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ email: email, password: code }),
        }).then(function (r) {
          if (!r.ok) return r.json().then(function (j) {
            throw new Error(j.msg || j.error_description || ('HTTP ' + r.status));
          });
          return true;
        });
      });
    }

    /* Restaura a identidade em outro aparelho a partir do código. */
    function recoverWithCode(code) {
      var clean = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
      if (clean.length !== 16) return Promise.reject(new Error('codigo_invalido'));
      return _emailFor(clean).then(function (email) {
        return _authFetch('/token?grant_type=password', {
          email:    email,
          password: clean,
        });
      }).then(function (j) {
        /* Persiste no aparelho novo: sem isto, quem acabou de recuperar
           veria "código indisponível" no Perfil e ficaria sem saída no
           próximo aparelho. */
        try { localStorage.setItem(_lsKey('recovery_code'), clean); } catch (e) {}
        return _save(j);
      });
    }

    /* ── v12.12 · TESTE: e-mail e senha no lugar do código ─────────
       O código de 16 caracteres continua funcionando como reserva
       (recoverWithCode). Estas três funções são o caminho novo. */

    /* Entra com e-mail e senha (o GoTrue confere o bcrypt no servidor) */
    function loginEmailSenha(email, senha) {
      return _authFetch('/token?grant_type=password', {
        email:    String(email || '').trim().toLowerCase(),
        password: String(senha || ''),
      }).then(function (j) {
        /* quem entra por e-mail não usa mais o código deste aparelho */
        try { localStorage.removeItem(_lsKey('recovery_code')); } catch (e) {}
        return _save(j);
      });
    }

    /* Grava e-mail e senha na PRÓPRIA conta. Vai pela Edge Function
       conta-acesso porque toda conta já tem o e-mail sintético, e trocar
       e-mail existente pelo navegador fica pendente de uma confirmação
       que nunca chega (ver comentário na função). */
    function definirAcesso(email, senha) {
      return getAccessToken().then(function (tok) {
        if (!tok) throw new Error('sem_sessao');
        return fetch(EDGE_URL + '/conta-acesso', {
          method: 'POST',
          headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, senha: senha }),
        });
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.code = j.error; throw e; }
          /* o código antigo deixa de valer (e-mail e senha mudaram) */
          try { localStorage.removeItem(_lsKey('recovery_code')); } catch (e) {}
          return j;
        });
      });
    }

    /* E-mail de acesso da conta, ou null se ela ainda usa o código */
    function emailDeAcesso() {
      return getAccessToken().then(function (tok) {
        if (!tok) return null;
        return fetch(AUTH_URL + '/user', { headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + tok } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (u) {
            var e = u && u.email;
            return (e && !/@device\.fieldo\.app$/i.test(e)) ? e : null;
          });
      });
    }

    /* Garante identidade: reusa a existente ou cria anônima. */
    function ensure() {
      var s = _load();
      if (s) return Promise.resolve(s);
      return signInAnonymously();
    }

    return {
      ensure:              ensure,
      signInAnonymously:   signInAnonymously,
      refresh:             refresh,
      getAccessToken:      getAccessToken,
      getTokens:           getTokens,
      userId:              userId,
      clear:               clear,
      generateRecoveryCode: generateRecoveryCode,
      attachRecoveryCode:  attachRecoveryCode,
      recoveryEmailFor:    recoveryEmailFor,
      recoverWithCode:     recoverWithCode,
      loginEmailSenha:     loginEmailSenha,
      definirAcesso:       definirAcesso,
      emailDeAcesso:       emailDeAcesso,
      isSignedIn:          function () { return !!userId(); },
    };
  })();


  /* ════════════════════════════════════════════════════════════
     AUTH — sessão por professional_id com TTL de 30 dias
  ════════════════════════════════════════════════════════════ */
  var Auth = {

    /* Agora devolve o auth.uid() real do JWT — o mesmo uuid que a
       RLS compara em toda policy. Continua SÍNCRONO de propósito:
       todas as páginas fazem `if (!Auth.isLoggedIn()) redirect` no
       topo do script, e transformar isso em async quebraria as 8
       páginas de uma vez. O bootstrap assíncrono acontece só no
       onboarding (entrar.html). */
    getId: function () {
      return Session.userId();
    },

    /* "Logado" = tem identidade E já completou o perfil. Quem tem
       sessão mas abandonou o onboarding volta pro onboarding. */
    isLoggedIn: function () {
      if (!Session.userId()) return false;
      var cached = LS.get('session_data');
      return !!(cached && cached.id === Session.userId());
    },

    setSession: function (prof) {
      _profData = prof;
      _profId   = prof && prof.id;
      LS.set('session_data', prof);
    },

    /* Sessão não expira mais por TTL local: quem manda é o JWT do
       Supabase. Mantido como no-op para não quebrar chamadores. */
    touchSession: function () {},

    logout: function () {
      _profId = null;
      _profData = null;
      LS.remove('session_data');
      Session.clear();
      /* Sem isto, o próximo usuário do mesmo aparelho encontraria o
         código de recuperação do anterior — acesso permanente à conta
         alheia. É a peça mais sensível guardada localmente. */
      try { localStorage.removeItem(_lsKey('recovery_code')); } catch (e) {}
      try { LocalDB.wipe(); } catch (e) {}
    },

    require: function (redirect) {
      if (!Auth.isLoggedIn()) {
        window.location.href = redirect || 'entrar.html';
        return false;
      }
      return true;
    },

    /* Exposto para o onboarding e a tela de recuperação */
    Session: Session,
  };


  /* ════════════════════════════════════════════════════════════
     PIX — BR Code / EMV  (v5.3)

     Gera a string "Copia e Cola" do padrão do Banco Central, COM O
     VALOR EMBUTIDO.

     Por que isso importa: antes o relatório mostrava só a chave. O
     cliente abria o banco, colava a chave, DIGITAVA o valor, conferia
     e pagava — 5 passos e uma chance de errar o número. Com o BR Code
     o valor já vem preenchido: colar e pagar.

     Não exige integração bancária, não tem custo, funciona offline.

     Limite honesto: PIX estático não notifica o recebimento. Saber que
     o cliente pagou depende do botão "Já paguei" (confiança) ou de um
     PSP (Mercado Pago, Gerencianet) — outro projeto.
  ════════════════════════════════════════════════════════════ */
  var Pix = (function () {

    /* Remove acentos e caracteres que o padrão EMV não aceita.
       Banco que recebe BR Code com acento costuma rejeitar. */
    function _ascii(s, max) {
      return String(s || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9 .,\-]/g, '')
        .trim().slice(0, max || 99).toUpperCase();
    }

    /* Campo EMV: ID + tamanho em 2 dígitos + valor */
    function _tlv(id, value) {
      var v = String(value);
      return id + String(v.length).padStart(2, '0') + v;
    }

    /* CRC16-CCITT (polinômio 0x1021, inicial 0xFFFF) — exigido pelo padrão */
    function _crc16(str) {
      var crc = 0xFFFF;
      for (var i = 0; i < str.length; i++) {
        crc ^= str.charCodeAt(i) << 8;
        for (var j = 0; j < 8; j++) {
          crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
          crc &= 0xFFFF;
        }
      }
      return crc.toString(16).toUpperCase().padStart(4, '0');
    }

    /* Normaliza a chave conforme o tipo. CPF/CNPJ/telefone viajam só
       com dígitos; telefone leva +55. E-mail e aleatória vão como estão. */
    function normalizeKey(key, tipo) {
      var k = String(key || '').trim();
      var t = String(tipo || '').toLowerCase();
      var digits = k.replace(/\D/g, '');

      if (t.indexOf('cpf') === 0 || t.indexOf('cnpj') === 0) return digits;
      if (t.indexOf('tel') === 0 || t.indexOf('cel') === 0 || t.indexOf('fone') >= 0) {
        return digits.length >= 10 && digits.indexOf('55') !== 0 ? '+55' + digits : '+' + digits;
      }
      if (t.indexOf('mail') >= 0 || k.indexOf('@') > 0) return k.toLowerCase();

      /* Sem tipo declarado: infere pelo formato */
      if (k.indexOf('@') > 0) return k.toLowerCase();
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(k)) return k.toLowerCase(); /* aleatória */
      if (digits.length === 11 || digits.length === 14) return digits;  /* CPF/CNPJ */
      if (digits.length >= 10 && digits.length <= 13) return '+55' + digits.replace(/^55/, '');
      return k;
    }

    /* Valida o mínimo antes de gerar — BR Code inválido é pior que
       nenhum: o cliente cola, o banco recusa, e ele acha que o
       profissional é golpe. */
    function validate(key, tipo) {
      var k = normalizeKey(key, tipo);
      if (!k) return { ok: false, error: 'Chave PIX não informada' };
      if (k.indexOf('@') > 0) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)
          ? { ok: true, key: k } : { ok: false, error: 'E-mail inválido' };
      }
      if (k.charAt(0) === '+') {
        return k.replace(/\D/g, '').length >= 12
          ? { ok: true, key: k } : { ok: false, error: 'Telefone inválido' };
      }
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) {
        return { ok: true, key: k };
      }
      if (/^\d{11}$/.test(k) || /^\d{14}$/.test(k)) return { ok: true, key: k };
      return { ok: false, error: 'Chave PIX em formato não reconhecido' };
    }

    /* Monta o BR Code. amount opcional: sem ele, o cliente digita o valor. */
    function brcode(opts) {
      opts = opts || {};
      var v = validate(opts.key, opts.tipo);
      if (!v.ok) return { ok: false, error: v.error };

      var nome   = _ascii(opts.name || 'RECEBEDOR', 25) || 'RECEBEDOR';
      var cidade = _ascii(opts.city || 'BRASIL', 15)     || 'BRASIL';

      /* txid: identifica a cobrança no extrato. '***' = sem identificador. */
      var txid = _ascii(opts.txid || '***', 25).replace(/[^A-Z0-9]/g, '') || '***';

      var mai = _tlv('00', 'br.gov.bcb.pix') + _tlv('01', v.key);

      var payload =
        _tlv('00', '01') +                    /* formato */
        _tlv('26', mai) +                     /* merchant account info */
        _tlv('52', '0000') +                  /* categoria */
        _tlv('53', '986');                    /* moeda BRL */

      if (opts.amount != null && Number(opts.amount) > 0) {
        payload += _tlv('54', Number(opts.amount).toFixed(2));
      }

      payload +=
        _tlv('58', 'BR') +
        _tlv('59', nome) +
        _tlv('60', cidade) +
        _tlv('62', _tlv('05', txid));

      payload += '6304';                      /* CRC placeholder */
      return { ok: true, code: payload + _crc16(payload), key: v.key };
    }

    return { brcode: brcode, validate: validate, normalizeKey: normalizeKey };
  })();


  /* ════════════════════════════════════════════════════════════
     PWA — registro do service worker  (v5.7)

     Um SW persiste no aparelho. Se servir cache quebrado, o usuário
     fica preso mesmo depois de você corrigir e publicar. Por isso:

       · só registra em HTTPS (ou localhost)
       · falha em silêncio — nenhuma feature do app depende dele
       · expõe FIELDO.PWA.reset() como botão de emergência, que
         remove o SW e limpa todos os caches
       · avisa quando há versão nova, em vez de trocar debaixo do
         usuário no meio de um formulário
  ════════════════════════════════════════════════════════════ */
  var PWA = (function () {

    var _reg = null;
    var _onUpdate = null;

    function suportado() {
      return typeof navigator !== 'undefined' &&
             'serviceWorker' in navigator &&
             (location.protocol === 'https:' ||
              location.hostname === 'localhost' ||
              location.hostname === '127.0.0.1');
    }

    /* v5.9: DESATIVADO.

       O service worker causou quatro falhas seguidas em produção: foto
       de perfil sumindo, dados sumindo ao atualizar, botões do menu
       voltando para a tela inicial e relatório não abrindo.

       Todas tinham a mesma raiz: eu tratei cache como configuração, não
       como código. O ganho (abrir offline) não pagou o custo.

       O app continua instalável na tela inicial pelo manifest.json, e o
       offline de DADOS segue funcionando pelo IndexedDB/SyncEngine, que
       é independente disto.

       registrar() virou no-op. reset() continua ativo para limpar
       instalações antigas. */
    function registrar() {
      return Promise.resolve(null);
    }


    /* Aplica a versão nova e recarrega. Chamado pelo usuário. */
    function atualizar() {
      if (!_reg || !_reg.waiting) { location.reload(); return; }
      _reg.waiting.postMessage('skip-waiting');
      var recarregou = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (recarregou) return;   /* Chrome dispara mais de uma vez */
        recarregou = true;
        location.reload();
      });
    }

    function onUpdate(fn) { _onUpdate = fn; }

    /* ── Botão de emergência ──────────────────────────────────
       Remove o SW e apaga todos os caches. Se algum dia o app
       "travar numa versão antiga", isto resolve sem depender de o
       usuário saber limpar dados do navegador. */
    function reset() {
      var tarefas = [];
      if (typeof caches !== 'undefined') {
        tarefas.push(caches.keys().then(function (ns) {
          return Promise.all(ns.map(function (n) { return caches.delete(n); }));
        }));
      }
      if (suportado()) {
        tarefas.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
          return Promise.all(rs.map(function (r) { return r.unregister(); }));
        }));
      }
      return Promise.all(tarefas).then(function () { location.reload(true); });
    }

    return {
      registrar: registrar,
      atualizar: atualizar,
      onUpdate:  onUpdate,
      reset:     reset,
      suportado: suportado,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     CACHE OFFLINE DE LISTAS  (v5.7.1)

     Bug corrigido: as listas faziam _get() sem fallback. Offline, a
     promise rejeitava e a tela ficava vazia — o app prometia "funciona
     sem internet" e mostrava zero serviços ao atualizar a página.

     Pior: os dados nunca eram gravados localmente, então não havia nem
     o que ler. O IndexedDB só guardava o que estava em fila de envio.

     Agora: toda leitura bem-sucedida grava (write-through); toda falha
     de rede lê do local. O offline passa a ser consequência do uso
     normal, sem o usuário precisar "preparar" nada.
  ════════════════════════════════════════════════════════════ */
  /* v8.0 · Filtro de arquivo para reports e budgets.
     TRÊS estados, de propósito:
       true      → só arquivados
       false     → só ativos
       undefined → SEM filtro (comportamento anterior, preservado)

     O terceiro estado não é preguiça: `Reports.stats`, `busca.html` e o
     `Budgets.list(999)` que numera orçamento em orcamento.html precisam
     enxergar TUDO. Se o padrão escondesse arquivados, a numeração passaria
     a reemitir números já usados e a busca perderia documentos antigos —
     eu trocaria um bug por dois.

     Antes disto, `{arquivados}` era passado por index.html e descartado
     em silêncio: arquivar gravava arquivado_em no banco e o serviço
     continuava na lista ativa para sempre. */
  function _filtroArquivo(arquivados) {
    if (arquivados === true)  return '&arquivado_em=not.is.null';
    if (arquivados === false) return '&arquivado_em=is.null';
    return '';
  }

  /* ════════════════════════════════════════════════════════════
     "O servidor não respondeu" — v8.7
     ─────────────────────────────────────────────────────────────
     Antes isto era uma expressão solta dentro do catch, montada com
     casamento de string: status 0, name TypeError, ou a mensagem
     batendo /fetch|network|Failed/. Duas coisas passavam batido:

       · TIMEOUT — _fetchComTimeout lança "A conexão demorou demais",
         com code 'timeout'. Nenhum dos testes acima pega. Era o P1
         que a auditoria já tinha apontado e ninguém tinha fechado.

       · 503 do PostgREST — o erro chega com status 503 e o corpo do
         PostgREST na mensagem. Também não bate em nada.

     Em 14/08 o PostgREST do projeto respondeu 503 por horas. O app
     tinha cópia local de tudo no IndexedDB e mesmo assim mostrou
     "erro ao carregar" em toda tela, porque a queda não se parecia
     com "offline" segundo esta lista. Do ponto de vista de quem está
     na obra, servidor fora e internet fora são a mesma coisa.

     O que NÃO entra aqui, de propósito: 4xx e 500.
       · 4xx é resposta de verdade (401 vencido, 403 sem permissão,
         404 não existe). Servir cache no lugar esconderia o motivo.
       · 500 é bug nosso. Mascarar com dado velho é exatamente o que
         a regra "não esconder erros" proíbe — o erro tem que subir.
  ════════════════════════════════════════════════════════════ */
  function _semResposta(err) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    if (!err) return false;
    if (err.code === 'timeout' || err.name === 'AbortError') return true;
    if (err.status === 0) return true;
    /* 502/503/504: o servidor existe mas não conseguiu atender.
       503 é o que o PostgREST devolve quando não alcança o Postgres. */
    if (err.status === 502 || err.status === 503 || err.status === 504) return true;
    if (err.name === 'TypeError') return true;
    return /fetch|network|Failed/i.test(String(err.message || ''));
  }

  /* Avisa a tela de que o que ela recebeu veio do cache local, não do
     servidor. Sem isto, cair para o cache seria indistinguível de estar
     tudo bem — e o usuário tomaria decisão com dado velho sem saber. */
  function _avisarDadosLocais(motivo) {
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('fieldo:dados-locais', {
          detail: { motivo: motivo || 'sem_resposta' },
        }));
      } catch (e) { /* navegador antigo: o dado aparece, só sem evento */ }
    }
    _faixaDadosLocais();
  }

  /* Faixa fixa avisando que a tela mostra dado do aparelho.
     ─────────────────────────────────────────────────────────────
     Por que existe: cair pro cache em silêncio é indistinguível de estar
     tudo funcionando. O profissional olharia a lista sem o serviço que
     acabou de fechar e concluiria que perdeu o registro — ou refaria.
     Silêncio aqui é esconder erro, que é exatamente o que o CONTEXTO
     proíbe.

     Mora no db.js e se monta sozinha porque são 20 páginas: pedir que
     cada uma escute o evento garantiria que metade esquecesse. Quem
     quiser tratamento próprio escuta 'fieldo:dados-locais'.

     Some sozinha na primeira leitura que voltar a dar certo. */
  var _faixaEl = null;
  function _faixaDadosLocais() {
    if (typeof document === 'undefined' || !document.body || _faixaEl) return;
    try {
      var d = document.createElement('div');
      d.id = 'fieldo-faixa-local';
      d.setAttribute('role', 'status');
      d.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9998;' +
        'background:#7a5b12;color:#fff;padding:.55rem .9rem;' +
        'font-family:system-ui,sans-serif;font-size:.75rem;line-height:1.45;' +
        'display:flex;align-items:center;gap:.6rem;justify-content:center';
      var t = document.createElement('span');
      t.textContent = 'Servidor fora do ar. Mostrando o que está salvo neste aparelho.';
      var b = document.createElement('button');
      b.textContent = 'Tentar de novo';
      b.style.cssText = 'border:0;border-radius:6px;padding:.3rem .7rem;flex:none;' +
        'background:#fff;color:#7a5b12;font-family:inherit;font-size:.72rem;font-weight:600';
      b.onclick = function () { location.reload(); };
      d.appendChild(t); d.appendChild(b);
      document.body.appendChild(d);
      _faixaEl = d;
    } catch (e) { /* a faixa nunca pode derrubar a página */ }
  }

  function _fecharFaixaDadosLocais() {
    if (!_faixaEl) return;
    try { if (_faixaEl.remove) _faixaEl.remove(); } catch (e) {}
    _faixaEl = null;
  }

  function _listaComCache(store, fetcher) {
    return fetcher()
      .then(function (rows) {
        /* Leitura deu certo: o servidor voltou, some com a faixa. */
        _fecharFaixaDadosLocais();
        /* Grava em segundo plano: se o IndexedDB falhar (aba privada,
           cota cheia), a leitura online não pode quebrar por isso. */
        _guardarLocal(store, rows).catch(function () {});
        return rows;
      })
      .catch(function (err) {
        if (!_semResposta(err)) throw err;

        /* Registra a causa real. Quando o suporte perguntar "por que
           apareceu dado velho", a resposta está no console, não no chute. */
        console.warn('[fieldo] servidor não respondeu (' +
          (err && (err.code || err.status || err.name) || '?') + ') — lendo cache local de ' + store);
        _avisarDadosLocais(err && (err.code || err.status || err.name));

        return LocalDB.list(store, { limit: 500 })
          .then(function (locais) {
            return locais
              .filter(function (r) { return r._syncStatus !== 'deleted'; })
              .map(_normalizarLocal)
              .filter(Boolean)
              .sort(function (a, b) {
                return String(b.created_at || '').localeCompare(String(a.created_at || ''));
              });
          })
          .catch(function () { return []; });
      });
  }

  /* Registros locais têm DUAS formas históricas:
       · create() grava embrulhado:  { data: {...}, _localId, _syncStatus }
       · o cache de leitura grava plano: { ...linha, _localId }

     A lista concatenava os dois sem normalizar, então o item criado
     offline aparecia EM BRANCO — o profissional via a linha vazia e
     concluía que tinha perdido o serviço.

     Desembrulha e marca como pendente para a UI poder sinalizar. */
  /* Junta os pendentes locais à lista que veio do servidor, SEM repetir.
     ─────────────────────────────────────────────────────────────
     v8.7: por que a checagem existe. Quando o servidor responde, `remote`
     só tem registros do servidor e a concatenação é segura. Mas quando
     _listaComCache CAI PRO CACHE, `remote` já é a leitura local inteira —
     pendentes inclusos. Concatenar os pendentes por cima duplicava cada
     serviço criado offline: a mesma obra aparecia duas vezes na lista, com
     o mesmo valor, e o total do dashboard contava em dobro.

     O bug existia desde que o fallback foi criado, mas só aparecia em modo
     avião. A v8.7 passou a cair pro cache também em 503/timeout, o que
     tornaria isso comum — daí fechar agora. */
  function _mesclarPendentes(remote, pendentes) {
    var vistos = {};
    (remote || []).forEach(function (r) {
      if (!r) return;
      if (r._localId) vistos['L:' + r._localId] = true;
      if (r.id)       vistos['S:' + r.id] = true;
    });
    var novos = (pendentes || []).filter(function (r) {
      if (!r) return false;
      if (r._localId && vistos['L:' + r._localId]) return false;
      if (r.id && vistos['S:' + r.id]) return false;
      return true;
    });
    return novos.concat(remote || []);
  }

  function _normalizarLocal(r) {
    if (!r) return null;
    var base = r.data && typeof r.data === 'object' ? r.data : r;
    return Object.assign({}, base, {
      id:           base.id || r._serverId || r._localId,
      _localId:     r._localId,
      _pendingSync: r._syncStatus === 'pending',
      created_at:   base.created_at || r.created_at ||
                    new Date(r._updatedAt || Date.now()).toISOString(),
    });
  }

  function _guardarLocal(store, rows) {
    if (!Array.isArray(rows) || !rows.length) return Promise.resolve();
    if (!LocalDB.isSupported || !LocalDB.isSupported()) return Promise.resolve();
    return Promise.all(rows.slice(0, 500).map(function (r) {
      if (!r || !r.id) return null;
      /* _localId = id do servidor: reescrever o mesmo registro em vez
         de acumular duplicata a cada carregamento. */
      var copia = Object.assign({}, r, {
        _localId: r.id, _serverId: r.id, _syncStatus: 'synced',
      });
      return LocalDB.put(store, copia).catch(function () { return null; });
    })).then(function () {});
  }

  /* ── v5.8.2 · utilidades de rede e imagem ──────────────────────

     Timeout: sem ele, um request que nunca responde deixa o botão
     girando para sempre. O usuário não tem como saber se deve esperar
     ou desistir — e foi exatamente o sintoma relatado em "editar perfil
     fica rodando". */
  function _fetchComTimeout(url, opts, ms) {
    var limite = ms || 30000;
    if (typeof AbortController === 'undefined') return fetch(url, opts);

    var ctrl = new AbortController();
    opts = Object.assign({}, opts, { signal: ctrl.signal });
    var estourou = false;
    var t = setTimeout(function () { estourou = true; ctrl.abort(); }, limite);

    return fetch(url, opts)
      .then(function (r) { clearTimeout(t); return r; })
      .catch(function (err) {
        clearTimeout(t);
        if (estourou) {
          var e = new Error('A conexão demorou demais. Tente de novo.');
          e.code = 'timeout';
          throw e;
        }
        throw err;
      });
  }

  /* Reduz a imagem no dispositivo antes de subir. Economiza dados do
     profissional, que costuma estar em plano limitado. */
  function _reduzirImagem(file, maxDim, qualidade) {
    return new Promise(function (resolve, reject) {
      if (typeof document === 'undefined' || !file || !file.type ||
          file.type.indexOf('image/') !== 0) return reject(new Error('nao_imagem'));

      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var esc = Math.min(1, (maxDim || 512) / Math.max(w, h));
          var cv = document.createElement('canvas');
          cv.width  = Math.round(w * esc);
          cv.height = Math.round(h * esc);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          cv.toBlob(function (blob) {
            blob ? resolve(blob) : reject(new Error('canvas_falhou'));
          }, 'image/jpeg', qualidade || 0.85);
        } catch (e) { reject(e); }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('imagem_invalida'));
      };
      img.src = url;
    });
  }

  /* ════════════════════════════════════════════════════════════
     PROFESSIONALS
  ════════════════════════════════════════════════════════════ */
  var Professionals = {

    getById: function (id) {
      return _getPublic('/professionals?id=eq.' + encodeURIComponent(id) + '&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },

    getByPhone: function (phone) {
      return _get('/professionals?phone=eq.' + encodeURIComponent(phone) + '&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },

    getBySlug: function (slug) {
      return _getPublic('/professionals?slug=eq.' + encodeURIComponent(slug) + '&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },

    /* v10.32 · correção de segurança. pix_key/pix_tipo/include_pix
       saíram do GRANT direto de `anon` na tabela (permitia baixar a
       chave Pix — às vezes o próprio CPF — de TODOS os profissionais
       públicos numa única chamada). Quem precisa mostrar o Pix de um
       profissional específico numa página pública (relatorio.html)
       usa esta função em vez de getById — mesma regra de visibilidade
       de antes, só que um profissional por vez, não a tabela inteira. */
    getPixPublico: function (id) {
      return _rpc('professional_pix_publico', { p_professional_id: id }, { anon: true })
        .then(function (rows) { return (rows && rows[0]) || null; });
    },

    /* me(true) força ida ao servidor e REESCREVE session_data.
       v8.0: existe porque o cache não tinha invalidador seguro. O único
       era License.activate, que APAGAVA session_data — e como
       Auth.isLoggedIn() depende dessa chave, ativar o Pro deslogava o
       usuário e o jogava no onboarding com perfil já existente.
       Use force quando o SERVIDOR mudou o perfil: ativação de plano,
       gatilho de perfil público, alteração feita em outro aparelho.

       v10.22 · POR QUE O CACHE AGORA TEM PRAZO
       Achado real: profissional pagou o Pro pelo Asaas (Pix/boleto), o
       asaas-webhook gravou plan='pro' no banco na hora — e o app, no
       aparelho da pessoa, continuou achando que era free. planos.html
       mostrava "ativo" certo, porque lê o status da assinatura direto
       do servidor; TODO o resto (tema, categoria personalizada, cota de
       empreiteiro em contratos.html) passa por aqui, sem force, e sem
       force isto só devolvia o que já estava no localStorage — sem
       prazo nenhum. session_data cacheado antes do pagamento continuava
       "válido" para sempre. O único código que chamava me(true) era
       License.activate — o resgate manual de código antigo. Quem paga
       de verdade, pelo Asaas, nunca passa por ali.
       Não dá pra empurrar aviso do webhook pro navegador (é servidor
       para servidor, sem canal de volta pro cliente). Solução com o
       mesmo espírito offline-first do resto do arquivo: o cache serve
       na hora — a tela não trava esperando rede — mas se estiver mais
       velho que SESSION_TTL, dispara um refresh em segundo plano, que
       reescreve o cache pra próxima leitura já vir certa. Timestamp
       fica em chave própria (session_data_at), não dentro do objeto do
       profissional — não quero um campo extra vazando pra dentro de um
       PATCH em Professionals.update() que reaproveite este objeto. */
    me: function (force) {
      var id = Auth.getId();
      if (!id) return Promise.resolve(null);
      var SESSION_TTL = 5 * 60 * 1000; /* 5 min: rápido o bastante pra não irritar quem acabou de pagar, longo o bastante pra não virar um fetch a cada tela. */
      if (!force) {
        if (_profData) return Promise.resolve(_profData);
        var cached = LS.get('session_data');
        if (cached && cached.id === id) {
          _profData = cached;
          var at = LS.get('session_data_at');
          var stale = !at || (Date.now() - at > SESSION_TTL);
          if (stale && !_profRefreshing) {
            _profRefreshing = true;
            Professionals.me(true).catch(function () {}).then(function () { _profRefreshing = false; });
          }
          return Promise.resolve(cached);
        }
      }
      return _get('/professionals?id=eq.' + encodeURIComponent(id) + '&limit=1')
        .then(function (rows) { return rows[0] || null; })
        .then(function (prof) {
        /* v8.0: o guard confere prof.id === id, não só "prof existe".
           Motivo concreto: session_data é a prova de login usada por
           Auth.isLoggedIn(). Se uma resposta inesperada (HTML de erro de
           proxy, corpo sem content-type json) virasse `prof`, gravar isso
           aqui DESLOGAVA o usuário na próxima checagem — o mesmo estrago
           que o bug de License.activate causava, por outro caminho.
           Preferir não atualizar o cache a corrompê-lo. */
        if (prof && prof.id === id) {
          _profData = prof;
          LS.set('session_data', prof);
          LS.set('session_data_at', Date.now());
        }
        return prof;
      });
    },

    /* O id NÃO é gerado pelo banco: é o auth.uid(). A policy
       prof_insert_self recusa qualquer outro valor, então não dá
       para criar perfil no lugar de outra pessoa. */
    create: function (data) {
      return Session.ensure().then(function (s) {
        data.id = s.user_id;
        return _post('/professionals', data);
      }).then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    update: function (data) {
      var id = Auth.getId();
      if (!id) return Promise.reject(new Error('Não autenticado'));
      return _patch('/professionals?id=eq.' + id, data)
        .then(function (rows) {
          var prof = Array.isArray(rows) ? rows[0] : rows;
          /* v10.22: carimba session_data_at aqui também — sem isso, um
             editar-perfil comum já nasceria "velho" pro TTL de me() e
             dispararia um refetch em segundo plano sem necessidade. */
          if (prof) { _profData = prof; LS.set('session_data', prof); LS.set('session_data_at', Date.now()); }
          return prof;
        });
    },

    /* Upload de avatar com VALIDAÇÃO de tipo e tamanho */
    uploadAvatar: function (file) {
      var id = Auth.getId();
      if (!id) return Promise.reject(new Error('Não autenticado'));
      if (!file) return Promise.reject(new Error('Arquivo vazio'));

      if (!file.type || !file.type.startsWith('image/')) {
        return Promise.reject(new Error('Arquivo não é uma imagem válida'));
      }
      if (file.size > 5 * 1024 * 1024) {
        return Promise.reject(new Error('Imagem maior que 5MB'));
      }

      /* Caminho prefixado pelo uid: a policy av_write exige que o
         primeiro segmento seja auth.uid(). */
      var path = id + '/avatar.jpg';

      /* v5.8.2: o arquivo era enviado CRU. Uma foto de celular de 12MP
         tem 3–5 MB; em 3G isso leva dezenas de segundos, e o usuário só
         vê o botão girando. Pior: se passar de 5 MB, o bucket recusa
         DEPOIS de subir tudo.

         As fotos de serviço já passavam por redução (Photos.add); o
         avatar não. Agora passa: ~2 MB viram ~80 KB.

         O bucket também só aceita jpeg/png/webp — enviar .gif dava erro
         no fim do upload. Reduzir sempre para JPEG elimina o caso. */
      return _reduzirImagem(file, 512, 0.85)
        .catch(function () { return file; })   /* canvas indisponível: envia como está */
        .then(function (blob) {
          return Session.getAccessToken().then(function (token) {
            return _fetchComTimeout(STORAGE_URL + '/avatars/' + path, {
              method: 'PUT',
              headers: {
                'apikey':        ANON_KEY,
                'Authorization': 'Bearer ' + (token || ANON_KEY),
                'Content-Type':  blob.type || 'image/jpeg',
                'x-upsert':      'true',
              },
              body: blob,
            }, 45000);
          });
        }).then(function (r) {
          if (!r.ok) {
            if (r.status === 413) throw new Error('Imagem grande demais');
            if (r.status === 403) throw new Error('Sem permissão para enviar');
            throw new Error('Upload falhou (' + r.status + ')');
          }
          return SUPABASE_URL + '/storage/v1/object/public/avatars/' + path + '?t=' + Date.now();
        });
    },

    buildSlug: function (name, profissao, city, id) {
      var parts = [name, profissao, city]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
      var suffix = id ? id.replace(/-/g,'').slice(0, 6) : Math.random().toString(36).slice(2, 8);
      return parts + '-' + suffix;
    },
  };

  /* ════════════════════════════════════════════════════════════
     REPORTS
  ════════════════════════════════════════════════════════════ */
  var Reports = {

    list: function (opts) {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      opts = opts || {};
      var qs = '/reports?professional_id=eq.' + id;
      qs += _filtroArquivo(opts.arquivados);
      qs += '&order=created_at.desc';
      if (opts.limit) qs += '&limit=' + opts.limit;

      return _listaComCache('reports', function () { return _get(qs); })
        .then(function (remote) {
          /* Mescla com pendentes locais (ainda não enviados) */
          return LocalDB.list('reports', { status: 'pending', limit: 100 })
            .then(function (pending) {
              var localOnly = pending
                .filter(function (r) { return !r._serverId; })
                .map(_normalizarLocal)
                .filter(Boolean);
              return _mesclarPendentes(remote, localOnly);
            })
            .catch(function () { return remote; });
        });
    },

    getById: function (id) {
      return _getPublic('/reports?id=eq.' + encodeURIComponent(id) + '&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },

    /* v6.1: via RPC. Antes filtrava direto na tabela, o que exigia que
       o `anon` pudesse LER a coluna rating_token — e quem lê a coluna
       lista TODOS os tokens e forja nota em qualquer relatório público.
       A RPC valida no servidor e devolve o relatório SEM o token. */
    getByToken: function (token) {
      /* Página do cliente (avaliar.html): 12s. Ele não sabe que existe
         um servidor; sabe que a tela não abriu. */
      return _rpc('report_por_token', { p_token: token }, { anon: true, timeout: 12000 })
        .then(function (res) {
          var r = Array.isArray(res) ? res[0] : res;
          return (r && r.id) ? r : null;
        });
    },

    /* Local-first: salva em IndexedDB + tenta REST + enfileira fallback */
    create: function (data) {
      var id = Auth.getId();
      if (!id) return Promise.reject(new Error('Não autenticado'));
      data.professional_id = id;

      /* 1. Salva local imediatamente */
      return LocalDB.put('reports', { data: data })
        .catch(function () { return null; }) /* IDB pode falhar — segue */
        .then(function (localRecord) {
          var localId = localRecord && localRecord._localId;

          /* 2. Tenta enviar pro Supabase agora */
          return _post('/reports', data)
            .then(function (rows) {
              var serverRow = Array.isArray(rows) ? rows[0] : rows;
              /* 3a. Sucesso: marca synced no local e retorna o servidor */
              if (localId && serverRow && serverRow.id) {
                LocalDB.update('reports', localId, {
                  _serverId:   serverRow.id,
                  _syncStatus: 'synced',
                  data:        serverRow,
                }).catch(function () {});
              }
              return serverRow;
            })
            .catch(function (err) {
              /* 3b. Falha: enfileira para SyncEngine */
              if (localId) {
                LocalDB.queueOp({
                  type:     'create',
                  table:    'reports',
                  localId:  localId,
                  payload:  data,
                }).catch(function () {});
              }
              /* Retorna registro local com flag de pendente */
              if (localRecord) {
                return Object.assign({}, data, {
                  id:           localId, /* usa localId como id "provisional" */
                  _pendingSync: true,
                  _localId:     localId,
                });
              }
              throw err;
            });
        });
    },

    update: function (reportId, data) {
      return _patch('/reports?id=eq.' + reportId, data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    delete: function (reportId) {
      return _del('/reports?id=eq.' + reportId);
    },

    recent: function (limit) {
      return Reports.list({ limit: limit || 5 });
    },

    stats: function () {
      /* Herda o cache offline de Reports.list. O .catch garante que uma
         falha aqui não derrube o dashboard inteiro. */
      return Reports.list().catch(function () { return []; }).then(function (rows) {
        var total = rows.length;
        /* v9.6: serviços PÚBLICOS, que é o número que decide a vitrine.
           O gatilho ativar_perfil_publico conta
             reports where professional_id = X and is_public
           e libera em 3. `total` conta tudo, inclusive o que a pessoa
           marcou como privado — usar ele para dizer "faltam N" faria o
           app prometer uma vitrine que nunca abriria. */
        var publicos = rows.filter(function (r) { return r.is_public === true; }).length;
        var now   = new Date();
        var mes   = rows.filter(function (r) {
          var d = new Date(r.created_at);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }).length;
        var comAvaliacao = rows.filter(function (r) { return r.rating > 0; });
        /* v10.0 · quantas avaliações sustentam a nota. Mostrar "4,9"
           sem a base é um número que ninguém consegue julgar — e o
           brief é explícito: nenhum número sem explicação. */
        var avaliados = comAvaliacao.length;
        var avgScore = comAvaliacao.length
          ? (comAvaliacao.reduce(function (s, r) { return s + r.rating; }, 0) / comAvaliacao.length).toFixed(1)
          : null;
        var nichos = {};
        rows.forEach(function (r) {
          var n = r.niche || r.category_key || '';
          if (n) nichos[n] = (nichos[n] || 0) + 1;
        });
        var nichoTop = Object.keys(nichos).sort(function (a, b) { return nichos[b] - nichos[a]; })[0] || null;

        /* ── v5.3: métricas financeiras ────────────────────────────
           Só possíveis agora que reports.valor existe. Antes o painel
           não conseguia responder "quanto tenho a receber?" porque o
           dado nunca era gravado. */
        var aReceber = 0, qtdReceber = 0, recebidoMes = 0, qtdPagoMes = 0;
        rows.forEach(function (r) {
          var v = parseFloat(r.valor);
          if (!isFinite(v) || v <= 0) return;
          if (r.payment_status === 'pendente') { aReceber += v; qtdReceber++; return; }
          if (r.payment_status === 'pago' && r.paid_at) {
            var p = new Date(r.paid_at);
            if (p.getMonth() === now.getMonth() && p.getFullYear() === now.getFullYear()) {
              recebidoMes += v; qtdPagoMes++;
            }
          }
        });
        /* Arredonda ao centavo: somar float acumula erro (0.1+0.2). */
        var r2 = function (n) { return Math.round(n * 100) / 100; };

        return {
          total: total, avaliados: avaliados,
          publicos: publicos, mes: mes, avgScore: avgScore, nichoTop: nichoTop,
          aReceber:    r2(aReceber),
          qtdReceber:  qtdReceber,
          recebidoMes: r2(recebidoMes),
          qtdPagoMes:  qtdPagoMes,
        };
      });
    },

    /* Verifica se o profissional pode criar um novo relatório (limite do plano) */
    canCreate: function () {
      return Promise.all([
        Professionals.me(),
        Reports.stats(),
      ]).then(function (results) {
        var prof  = results[0] || {};
        var stats = results[1];
        var planKey = prof.plan || 'free';
        var limit = (PLAN_LIMITS[planKey] || PLAN_LIMITS.free).reportsPerMonth;
        return {
          allowed:    stats.mes < limit,
          used:       stats.mes,
          limit:      limit,
          plan:       planKey,
          remaining:  Math.max(0, limit - stats.mes),
        };
      });
    },
  };

  /* ════════════════════════════════════════════════════════════
     OBRAS EM ANDAMENTO  (v12.16)

     Uma obra é só cliente, o que é a obra e o valor total. Cada
     relatório lançado nela tem um valor, e o valor desconta do total.

     O saldo é SEMPRE a soma dos relatórios da obra, nunca um número
     guardado: corrigir, apagar ou subir um relatório feito sem internet
     acerta o saldo sozinho, e o "quanto resta" nunca diverge do
     histórico que o cliente vê. A mesma conta existe no servidor
     (RPC obra_resumo) para o relatório do cliente.

     Criar obra pede conexão. Lançar relatório numa obra que já existe
     funciona sem internet, como qualquer relatório: o obra_id vai junto.
  ════════════════════════════════════════════════════════════ */
  var Obras = (function () {
    var CACHE = 'fieldo_obras_cache';
    var r2 = function (n) { return Math.round((Number(n) || 0) * 100) / 100; };

    function _lerCache() {
      try { return JSON.parse(localStorage.getItem(CACHE) || '[]') || []; } catch (e) { return []; }
    }
    function _gravarCache(rows) {
      try { localStorage.setItem(CACHE, JSON.stringify(rows || [])); } catch (e) {}
    }

    function list() {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      return _get('/obras?professional_id=eq.' + id + '&order=created_at.desc&limit=200')
        .then(function (rows) { _gravarCache(rows); return rows || []; })
        .catch(function (err) {
          if (_semResposta(err)) return _lerCache();
          throw err;
        });
    }

    function get(obraId) {
      return list().then(function (rows) {
        return rows.filter(function (o) { return o.id === obraId; })[0] || null;
      });
    }

    function _validar(d, parcial) {
      var out = {};
      if (!parcial || 'cliente' in d) {
        var c = String(d.cliente || '').trim();
        if (!c) throw new Error('Informe o nome do cliente');
        out.cliente = c.slice(0, 120);
      }
      if ('titulo' in d) out.titulo = String(d.titulo || '').trim().slice(0, 120) || null;
      if ('cidade' in d) out.cidade = String(d.cidade || '').trim().slice(0, 80) || null;
      if (!parcial || 'valor_total' in d) {
        var v = r2(d.valor_total);
        if (!(v > 0)) throw new Error('Informe o valor total da obra');
        out.valor_total = v;
      }
      return out;
    }

    function create(d) {
      var id = Auth.getId();
      if (!id) return Promise.reject(new Error('Não autenticado'));
      var dados;
      try { dados = _validar(d || {}, false); } catch (e) { return Promise.reject(e); }
      dados.professional_id = id;
      return _post('/obras', dados).then(function (rows) {
        var o = Array.isArray(rows) ? rows[0] : rows;
        _gravarCache([o].concat(_lerCache().filter(function (x) { return x.id !== o.id; })));
        return o;
      });
    }

    function update(obraId, d) {
      var dados;
      try { dados = _validar(d || {}, true); } catch (e) { return Promise.reject(e); }
      if ('status' in d) {
        dados.status = d.status === 'concluida' ? 'concluida' : 'andamento';
        dados.concluida_em = dados.status === 'concluida' ? new Date().toISOString() : null;
      }
      return _patch('/obras?id=eq.' + encodeURIComponent(obraId), dados)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    }

    function remover(obraId) {
      return _del('/obras?id=eq.' + encodeURIComponent(obraId)).then(function () {
        _gravarCache(_lerCache().filter(function (x) { return x.id !== obraId; }));
      });
    }

    /* A conta. `reports` é a lista que o app já tem (inclui os ainda não
       enviados), então o saldo no aparelho já conta o relatório feito
       sem internet. */
    function saldo(obra, reports) {
      var etapas = (reports || []).filter(function (r) { return obra && r.obra_id === obra.id; })
        .sort(function (a, b) {
          return String(a.service_date || a.created_at || '').localeCompare(String(b.service_date || b.created_at || ''));
        });
      var lancado = 0, pago = 0;
      etapas.forEach(function (r) {
        var v = r2(r.valor);
        lancado += v;
        if (r.payment_status === 'pago') pago += v;
      });
      var total = r2(obra && obra.valor_total);
      lancado = r2(lancado); pago = r2(pago);
      return {
        total: total, lancado: lancado, pago: pago,
        restante: r2(total - lancado),
        aReceber: r2(lancado - pago),
        pct: total > 0 ? Math.min(100, Math.round(lancado / total * 100)) : 0,
        etapas: etapas,
      };
    }

    function comSaldo() {
      return Promise.all([list(), Reports.list().catch(function () { return []; })])
        .then(function (res) {
          return res[0].map(function (o) { return Object.assign({}, o, { saldo: saldo(o, res[1]) }); });
        });
    }

    /* Para o relatório: cliente pelo token, profissional pelo id. */
    function resumo(opts) {
      opts = opts || {};
      var args = opts.token ? { p_token: opts.token } : { p_report_id: opts.reportId };
      return _rpc('obra_resumo', args, { anon: !!opts.token })
        .then(function (res) { var d = Array.isArray(res) ? res[0] : res; return (d && d.valor_total != null) ? d : null; })
        .catch(function () { return null; });
    }

    return { list: list, get: get, create: create, update: update, remover: remover,
             saldo: saldo, comSaldo: comSaldo, resumo: resumo };
  })();

  /* ════════════════════════════════════════════════════════════
     AVALIAÇÕES — submit ATÔMICO com rollback
  ════════════════════════════════════════════════════════════ */
  var Avaliacoes = {

    /* v5.0: uma única RPC transacional no Postgres.

       A v4 fazia PATCH no report e depois INSERT na avaliação, com
       rollback manual se o segundo falhasse. Se o cliente fechasse
       o navegador entre os dois, o relatório ficava marcado como
       avaliado sem avaliação nenhuma — irreversível pelo usuário.

       Além disso a RLS não permite mais escrita anônima direta:
       o rating_token (96 bits) é validado dentro da função. */
    submit: function (token, nota, comentario, nomeAvaliador) {
      return _rpc('submit_rating', {
        p_token:      token,
        p_nota:       nota,
        p_comentario: comentario || null,
        p_nome:       nomeAvaliador || null,
      }, { anon: true }).then(function (res) {
        var r = Array.isArray(res) ? res[0] : res;
        if (r && r.ok) return r;
        var msgs = {
          nao_encontrado: 'Relatório não encontrado',
          ja_avaliado:    'Esta avaliação já foi enviada',
          nota_invalida:  'Nota inválida',
        };
        throw new Error(msgs[r && r.error] || 'Não foi possível enviar');
      });
    },

    list: function () {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      return _get('/avaliacoes?professional_id=eq.' + id + '&order=created_at.desc');
    },

    /* v6.3: direito de resposta.
       O profissional NÃO pode alterar nota nem comentário — só
       acrescentar a versão dele. Garantido por privilégio de coluna no
       banco, não por confiança no cliente. */
    responder: function (avaliacaoId, texto) {
      var t = String(texto || '').trim();
      if (t.length > 600) return Promise.reject(new Error('Resposta muito longa (máx. 600)'));
      return _patch('/avaliacoes?id=eq.' + encodeURIComponent(avaliacaoId),
                    { resposta: t || null })
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },
  };

  /* ════════════════════════════════════════════════════════════
     PAGAMENTO — aviso do cliente  (v5.4)

     "Já paguei" NÃO marca o serviço como pago. Pix estático não
     notifica recebimento; aceitar a palavra do cliente como verdade
     contábil faria o painel financeiro mentir.

     Fica registrado como AVISO. O profissional confirma no app, e só
     então payment_status vira 'pago'.
  ════════════════════════════════════════════════════════════ */
  var Pagamento = {
    claim: function (ratingToken) {
      return _rpc('claim_payment', { p_token: ratingToken }, { anon: true })
        .then(function (res) {
          var r = Array.isArray(res) ? res[0] : res;
          if (r && r.ok) return r;
          var e = new Error('Não foi possível registrar o aviso');
          e.code = r && r.error;
          throw e;
        });
    },

    /* Confirmação do profissional — esta sim muda o status. */
    confirmar: function (reportId) {
      return Reports.update(reportId, {
        payment_status: 'pago',
        paid_at: new Date().toISOString(),
      });
    },
  };

  /* ════════════════════════════════════════════════════════════
     DOCUMENT HASHES
  ════════════════════════════════════════════════════════════ */
  var Hashes = {

    register: function (hash, tipo, refId, resumo) {
      var id = Auth.getId();
      if (!id) return Promise.reject(new Error('Não autenticado'));
      return _post('/document_hashes', {
        professional_id: id,
        hash:            hash,
        tipo:            tipo,
        ref_id:          refId,
        conteudo_resumo: resumo || null,
      }).then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    /* v11.0 · via RPC. A leitura direta exigia que o anon pudesse ler
       hash, ref_id e conteudo_resumo da tabela inteira — e o resumo leva
       o nome completo do cliente. Quem tem o hash (o documento na mão)
       continua conferindo tudo; listar deixou de ser possível. */
    verify: function (hash) {
      return _rpc('verificar_hash', { p_hash: hash }, { anon: true })
        .then(function (res) {
          var d = Array.isArray(res) ? res[0] : res;
          return (d && d.hash) ? d : null;
        });
    },

    /* Busca o selo de um documento pelo id dele. Devolve só hash, tipo e
       data — nunca o resumo. */
    getByRef: function (refId) {
      return _rpc('selo_por_ref', { p_ref_id: refId }, { anon: true })
        .then(function (res) {
          var d = Array.isArray(res) ? res[0] : res;
          return (d && d.hash) ? d : null;
        });
    },

    /* v5.7.2: sem .catch, esta chamada derrubava o Promise.all do
       painel inteiro quando offline. Hash é informativo — nunca deve
       impedir o resto da tela de aparecer. */
    list: function (limit) {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      return _get('/document_hashes?professional_id=eq.' + id +
                  '&order=created_at.desc&limit=' + (limit || 10))
        .catch(function () { return []; });
    },

    /* SHA-256 DETERMINÍSTICO (sem timestamp) */
    sha256: function (obj) {
      var keys = Object.keys(obj).sort();
      var str  = JSON.stringify(obj, keys);
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
        .then(function (buf) {
          return Array.from(new Uint8Array(buf))
            .map(function (b) { return b.toString(16).padStart(2, '0'); })
            .join('');
        });
    },
  };

  /* ════════════════════════════════════════════════════════════
     BUDGETS
  ════════════════════════════════════════════════════════════ */
  var Budgets = {

    /* v8.0: o 2º parâmetro opts existe desde sempre do lado do CHAMADOR
       (index.html passava {arquivados}), mas nunca foi declarado aqui —
       a opção era silenciosamente descartada. */
    list: function (limit, opts) {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      opts = opts || {};
      var qs = '/budgets?professional_id=eq.' + id +
               _filtroArquivo(opts.arquivados) +
               '&order=created_at.desc&limit=' + (limit || 50);
      return _listaComCache('budgets', function () { return _get(qs); })
        .then(function (remote) {
          /* Mescla pendentes locais */
          return LocalDB.list('budgets', { status: 'pending', limit: 100 })
            .then(function (pending) {
              var localOnly = pending
                .filter(function (b) { return !b._serverId; })
                .map(_normalizarLocal)
                .filter(Boolean);
              return _mesclarPendentes(remote, localOnly);
            })
            .catch(function () { return remote; });
        });
    },

    /* v5.4: leitura pelo token de aprovação. O cliente recebe o link e
       não conhece o id; o token é o segredo que autoriza a decisão. */
    /* v6.1: via RPC, mesmo motivo do relatório — approval_token legível
       permitia aprovar ou RECUSAR orçamento de qualquer profissional. */
    getByApprovalToken: function (token) {
      return _rpc('orcamento_por_token', { p_token: token }, { anon: true })
        .then(function (res) {
          var b = Array.isArray(res) ? res[0] : res;
          return (b && b.id) ? b : null;
        });
    },

    /* Decisão do cliente. Espelha Avaliacoes.submit: RPC transacional,
       sem escrita anônima direta na tabela. */
    decide: function (token, decisao, nota, assinatura) {
      return _rpc('decide_budget', {
        p_token:      token,
        p_decisao:    decisao,
        p_nota:       nota || null,
        p_assinatura: assinatura || null,
      }, { anon: true }).then(function (res) {
        var r = Array.isArray(res) ? res[0] : res;
        if (r && r.ok) return r;
        var msgs = {
          nao_encontrado:   'Orçamento não encontrado',
          ja_decidido:      'Este orçamento já foi respondido',
          decisao_invalida: 'Resposta inválida',
        };
        var e = new Error(msgs[r && r.error] || 'Não foi possível registrar');
        e.code = r && r.error;
        e.status = r && r.status;
        throw e;
      });
    },

    /* v11.0 · dono primeiro, link depois.
       Antes: leitura pública direta da tabela — que também deixava
       qualquer visitante LISTAR todos os orçamentos de todo mundo.
       Agora:
         1. Logado → leitura com o JWT. A RLS só devolve se for o dono,
            e o dono recebe tudo (inclusive client_phone, que servico.html
            e assistente.html usam).
         2. Sem linha (visitante, cliente ou outro profissional) → RPC
            orcamento_publico(id): um orçamento por vez, pelo id exato
            do link, sem telefone e sem token. */
    getById: function (id) {
      function publico() {
        return _rpc('orcamento_publico', { p_id: id }, { anon: true })
          .then(function (res) {
            var b = Array.isArray(res) ? res[0] : res;
            return (b && b.id) ? b : null;
          });
      }
      if (!Auth.getId()) return publico();
      return _get('/budgets?id=eq.' + encodeURIComponent(id) + '&limit=1')
        .then(function (rows) { return (rows && rows[0]) || publico(); })
        .catch(function () { return publico(); });
    },

    /* Local-first: salva em IndexedDB + tenta REST + enfileira fallback */
    create: function (data) {
      var profId = Auth.getId();
      if (!profId) return Promise.reject(new Error('Não autenticado'));
      data.professional_id = profId;

      return LocalDB.put('budgets', { data: data })
        .catch(function () { return null; })
        .then(function (localRecord) {
          var localId = localRecord && localRecord._localId;

          /* v12.30 · origem do cliente: antes do SQL da fase 5 a coluna
             não existe (400 citando origem) → manda de novo sem ela. O
             orçamento nunca deixa de sair por causa da pergunta. */
          var postar = function (d) {
            return _post('/budgets', d).catch(function (err) {
              if (d.origem !== undefined && Number(err && err.status) === 400 && /origem/.test(String(err.message || ''))) {
                var sem = {}; Object.keys(d).forEach(function (k) { if (k !== 'origem') sem[k] = d[k]; });
                return _post('/budgets', sem);
              }
              throw err;
            });
          };
          return postar(data)
            .then(function (rows) {
              var serverRow = Array.isArray(rows) ? rows[0] : rows;
              if (localId && serverRow && serverRow.id) {
                LocalDB.update('budgets', localId, {
                  _serverId:   serverRow.id,
                  _syncStatus: 'synced',
                  data:        serverRow,
                }).catch(function () {});
              }
              return serverRow;
            })
            .catch(function (err) {
              if (localId) {
                LocalDB.queueOp({
                  type:    'create',
                  table:   'budgets',
                  localId: localId,
                  payload: data,
                }).catch(function () {});
              }
              if (localRecord) {
                return Object.assign({}, data, {
                  id:           localId,
                  _pendingSync: true,
                  _localId:     localId,
                });
              }
              throw err;
            });
        });
    },

    update: function (id, data) {
      return _patch('/budgets?id=eq.' + id, data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    delete: function (id) {
      return _del('/budgets?id=eq.' + id);
    },

    buildNumber: function (existingCount) {
      var year = new Date().getFullYear();
      var num  = String((existingCount || 0) + 1).padStart(4, '0');
      return year + '-' + num;
    },
  };

  /* ════════════════════════════════════════════════════════════
     EMPREITEIROS / EMPREITADAS / WORK ENTRIES
  ════════════════════════════════════════════════════════════ */
  var Contratos = {
    listEmpreiteiros: function () {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      return _get('/empreiteiros?professional_id=eq.' + id + '&order=nome.asc');
    },
    createEmpreiteiro: function (data) {
      data.professional_id = Auth.getId();
      return _post('/empreiteiros', data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },
    deleteEmpreiteiro: function (id) {
      return _del('/empreiteiros?id=eq.' + id);
    },

    listEmpreitadas: function (empreteiroId) {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      var qs = '/empreitadas?professional_id=eq.' + id;
      if (empreteiroId) qs += '&empreiteiro_id=eq.' + empreteiroId;
      return _get(qs + '&order=created_at.desc');
    },
    createEmpreitada: function (data) {
      data.professional_id = Auth.getId();
      return _post('/empreitadas', data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },
    updateEmpreitada: function (id, data) {
      return _patch('/empreitadas?id=eq.' + id, data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    listEntries: function (empreitadaId) {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      var qs = '/work_entries?professional_id=eq.' + id;
      if (empreitadaId) qs += '&empreitada_id=eq.' + empreitadaId;
      return _get(qs + '&order=created_at.desc');
    },
    createEntry: function (data) {
      data.professional_id = Auth.getId();
      return _post('/work_entries', data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },
    updateEntry: function (id, data) {
      return _patch('/work_entries?id=eq.' + id, data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    /* ── Cotas v8.6 ──────────────────────────────────────────────
       Mesmo formato de Reports.canCreate, de propósito: a tela já sabe
       ler { allowed, used, limit, plan, remaining } e a UpgradeUI já
       sabe mostrar. Formato novo seria só mais uma coisa pra divergir.

       Conta o que EXISTE, não um contador guardado à parte: contador
       paralelo dessincroniza (apagou um e o número não voltou) e vira
       limite fantasma que ninguém entende. */
    _cota: function (qual, lista) {
      return Promise.all([Professionals.me(), lista()]).then(function (r) {
        var planKey = (r[0] || {}).plan || 'free';
        var limit   = (PLAN_LIMITS[planKey] || PLAN_LIMITS.free)[qual];
        var used    = (r[1] || []).length;
        return {
          allowed:   used < limit,
          used:      used,
          limit:     limit,
          plan:      planKey,
          remaining: Math.max(0, limit - used),
        };
      });
    },
    canCreateEmpreiteiro: function () {
      return Contratos._cota('empreiteiros', Contratos.listEmpreiteiros);
    },
    canCreateEmpreitada: function () {
      return Contratos._cota('empreitadas', function () {
        return Contratos.listEmpreitadas();
      });
    },
  };

  /* ════════════════════════════════════════════════════════════
     MARKETPLACE
  ════════════════════════════════════════════════════════════ */
  var Marketplace = {
    list: function (order, limit) {
      order = order || 'media_geral.desc.nullslast';
      limit = limit || 40;
      /* v12.30 · "Recomendados" ordena por tem_whatsapp, que só existe
         depois do SQL da fase 5: sem ela (400), a mesma ordem sem essa
         chave — a que explorar-seo.ts usa no mesmo caso (ORDEM_SEM_WA). */
      return _getPublic('/professional_stats?order=' + order + '&limit=' + limit).catch(function (err) {
        if (/tem_whatsapp/.test(order) && Number((err && err.status) || err) === 400) {
          return _getPublic('/professional_stats?order=' + order.replace('tem_whatsapp.desc,', '') + '&limit=' + limit);
        }
        throw err;
      });
    },

    search: function (query, order) {
      order = order || 'media_geral.desc.nullslast';
      var encoded = encodeURIComponent('%' + query + '%');
      return _getPublic(
        '/professional_stats?or=(name.ilike.' + encoded +
        ',profissao.ilike.' + encoded +
        ',city.ilike.' + encoded + ')&order=' + order
      );
    },
  };

  /* ════════════════════════════════════════════════════════════
     UI HELPERS — incluindo HTML escape automático
  ════════════════════════════════════════════════════════════ */
  var UI = {

    toast: function (msg, duration) {
      var el = document.getElementById('fieldo-toast') || document.getElementById('pack-toast');
      if (!el) return;
      el.textContent = msg;
      el.classList.add('show');
      setTimeout(function () { el.classList.remove('show'); }, duration || 2800);
    },

    /* ════════════════════════════════════════════════════════════
       ERRO QUE CHEGA A QUEM PODE CONSERTAR — v9.15
       ─────────────────────────────────────────────────────────────
       O dono disse "criar relatórios em contratos está dando erro" e
       não conseguiu dizer mais nada. Não era falta de atenção dele: a
       tela tinha CINCO chamadas de rede terminando em

           .catch(function () { UI.toast('Erro ao cadastrar'); })

       sem parâmetro. O Error que o _req levanta carrega o corpo
       inteiro da resposta do PostgREST em .message e o HTTP em
       .status — a causa exata estava ali, e o catch jogava fora.

       Aqui a mensagem ao usuário continua humana (ele não quer ler
       PGRST204), mas SEPARA os dois casos que pedem reação oposta:

         · sem rede     → "tente de novo"  (o dado dele não se perdeu)
         · servidor 4xx → "não conseguimos" (tentar de novo não resolve)

       E o motivo técnico vai pro console, que é onde ele é útil.  */
    erro: function (e, oQueFalhou) {
      var acao = oQueFalhou || 'salvar';
      var offline = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
                    !e || !e.status;
      if (e) {
        try { console.error('[fieldo] falha ao ' + acao,
              e.status ? 'HTTP ' + e.status : '(sem resposta)', e.message || e); }
        catch (_) {}
      }
      UI.toast(offline
        ? 'Sem conexão pra ' + acao + '. Seus dados continuam aqui — tente de novo.'
        : 'Não conseguimos ' + acao + ' agora. Tentar de novo não resolve — me avise.',
        4200);
      return e;
    },

    stars: function (n) {
      n = Math.round(parseFloat(n) || 0);
      return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
    },

    /* ════════════════════════════════════════════════════════════
       SUBTÍTULO DO PROFISSIONAL — v8.8
       ─────────────────────────────────────────────────────────────
       A linha abaixo do nome, no cabeçalho de orçamento, relatório,
       avaliação e prévia.

       Existia como `esc(prof.profissao) + (prof.city ? ' · ' + esc(prof.city) : '')`
       repetida em OITO lugares, em 7 arquivos. Concatenação crua, sem
       olhar o que já estava escrito. Um orçamento real saiu assim:

         Marcelo Ferreira Rodrigues
         Marcelo Ferreira Rodrigues — Eletricista em Caraguatatuba, SP · Caraguatatuba

       O nome duas vezes e a cidade duas vezes, na página que o CLIENTE
       recebe. A causa está no cadastro (que até a v8.8 não pedia o nome
       e obrigava a pessoa a se virar), mas o dado ruim já existe e vai
       continuar existindo: gente escreve "Eletricista em Caraguatatuba"
       no campo Especialidade porque é assim que se apresenta.

       A regra aqui é conservadora de propósito — só remove o que é
       comprovadamente repetição, comparando sem acento e sem caixa:
         · tira o nome quando a especialidade COMEÇA com ele;
         · omite a cidade quando a especialidade já a menciona.
       Na dúvida, mostra. Repetir é feio; esconder informação é pior.
    ════════════════════════════════════════════════════════════ */
    subtitulo: function (prof, opts) {
      prof = prof || {};
      opts = opts || {};
      /* O separador muda por contexto: ' · ' no cabeçalho, ' em ' na
         description do SEO ("Eletricista em Caraguatatuba"). A REGRA de
         não repetir é a mesma — por isso um parâmetro e não uma segunda
         função que sairia do compasso com esta na primeira mudança. */
      var sep  = opts.separador || ' · ';
      var esp  = String(prof.profissao || '').trim();
      var cid  = String(prof.city || '').trim();
      var nome = String(prof.name || '').trim();

      function normaliza(s) {
        return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
          .toLowerCase().replace(/\s+/g, ' ').trim();
      }

      /* 1. "Marcelo Ferreira — Eletricista" logo abaixo de "Marcelo
         Ferreira" vira só "Eletricista". Só quando COMEÇA com o nome:
         um nome no meio da frase pode ser intencional. */
      if (nome && esp && normaliza(esp).indexOf(normaliza(nome)) === 0) {
        esp = esp.slice(nome.length).replace(/^[\s–—\-·,:|]+/, '').trim();
      }
      /* v12.26b · pontuação solta no fim ("Empreiteiro construtor.")
         virava "Empreiteiro construtor. em Caraguatatuba" no título do
         Google (auditoria SEO/GEO, P8). Mesma limpeza em perfil-seo.ts. */
      esp = esp.replace(/[\s.,;:·|\-–—]+$/, '').trim();

      /* 2. Cidade só entra se a especialidade ainda não a mencionou.
         Compara pelo primeiro pedaço ("Caraguatatuba-SP" → "Caraguatatuba")
         e exige 4+ caracteres: com 2 ou 3 o risco de casar por acaso
         dentro de outra palavra é maior que o ganho. */
      var mostrarCidade = !!cid;
      if (cid && esp) {
        var base = cid.split(/[,–—\-]/)[0].trim();
        if (base.length >= 4 && normaliza(esp).indexOf(normaliza(base)) !== -1) {
          mostrarCidade = false;
        }
      }

      if (!esp) return cid;
      return mostrarCidade ? esp + sep + cid : esp;
    },

    /* Escape HTML — uso obrigatório em todo innerHTML com dado dinâmico */
    esc: function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    /* Tagged template para construir HTML com escape automático.
       Uso: UI.html`<div>${nomeDoUsuario}</div>` */
    html: function (strings) {
      if (Array.isArray(strings) || (strings && strings.raw)) {
        var out = strings[0];
        for (var i = 1; i < arguments.length; i++) {
          var v = arguments[i];
          out += (v && v.__raw__) ? v.value : UI.esc(v);
          out += strings[i];
        }
        return out;
      }
      return UI.esc(strings);
    },

    /* Marca uma string como HTML seguro (não escapa). Use com cuidado. */
    raw: function (html) {
      return { __raw__: true, value: String(html || '') };
    },

    fmtDate: function (iso) {
      if (!iso) return '—';
      try {
        return new Date(iso).toLocaleDateString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
        });
      } catch(e) { return iso; }
    },

    fmtDateLong: function (iso) {
      if (!iso) return '—';
      try {
        return new Date(iso).toLocaleDateString('pt-BR', {
          day: '2-digit', month: 'long', year: 'numeric',
        });
      } catch(e) { return iso; }
    },

    /* ── WhatsApp (v5.5.2) ─────────────────────────────────────
       Havia QUATRO implementações diferentes espalhadas pelas páginas,
       e três estavam erradas de formas distintas: regex `/\\D/g` que
       não limpava nada, prefixo '55' cego que duplicava o DDI, e
       fallback para o número do próprio profissional (abria chat
       consigo mesmo).

       Sintoma comum de todas: o WhatsApp abre em branco. URL inválida
       não gera erro — o app simplesmente ignora. */
    waNumero: function (bruto) {
      var d = String(bruto == null ? '' : bruto).replace(/\D/g, '');
      if (!d) return '';
      d = d.replace(/^0+/, '');            /* 0 de operadora */
      if (d.length === 10 || d.length === 11) d = '55' + d;   /* DDD + número */
      if (d.length === 12 || d.length === 13) {
        if (d.slice(0, 2) !== '55') return '';                /* DDI estrangeiro */
        return d;
      }
      return '';                           /* curto/longo demais → inválido */
    },

    /* Devolve o link ou ''. Vazio significa: NÃO mostre o botão.
       Melhor botão ausente que botão que abre em branco. */
    waLink: function (numero, texto) {
      var n = UI.waNumero(numero);
      var t = '?text=' + encodeURIComponent(texto || '');
      return n ? 'https://wa.me/' + n + t : '';
    },

    /* v12.30 · botão "Ligar": o mesmo número do WhatsApp, já com o +55.
       '' = número que não serve (mesma regra do waNumero). */
    telLink: function (numero) {
      var n = UI.waNumero(numero);
      return n ? 'tel:+' + n : '';
    },

    /* Seletor de contatos: usado quando não se sabe o número do
       destinatário. Sempre funciona. */
    waPicker: function (texto) {
      return 'https://wa.me/?text=' + encodeURIComponent(texto || '');
    },

    brl: function (val) {
      return 'R$ ' + Number(val || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      });
    },

    skel: function (lines) {
      return Array(lines || 3).fill(
        '<div class="skel" style="height:14px;margin-bottom:8px;border-radius:4px"></div>'
      ).join('');
    },

    /* Handler centralizado de erros */
    handleError: function (err) {
      console.error('[Fieldo]', err);
      var msg = 'Algo deu errado. Tente novamente.';
      if (err && err.message) {
        var m = String(err.message);
        if (m.indexOf('Failed to fetch') !== -1 || m.indexOf('NetworkError') !== -1) {
          msg = 'Sem conexão. Verifique sua internet.';
        } else if (m.indexOf('42501') !== -1 || m.indexOf('permission denied') !== -1) {
          msg = 'Você não tem permissão para essa ação.';
        } else if (m.indexOf('23505') !== -1 || m.indexOf('duplicate') !== -1) {
          msg = 'Esse registro já existe.';
        } else if (m.indexOf('Não autenticado') !== -1) {
          msg = 'Sessão expirada. Faça login novamente.';
          setTimeout(function () { window.location.href = '/entrar.html'; }, 1500);
        } else if (m.indexOf('rating_used') !== -1 || m.indexOf('já foi enviada') !== -1) {
          msg = 'Esta avaliação já foi registrada.';
        } else if (m.length < 120 && err.status !== 500) {
          msg = m;
        }
      }
      UI.toast(msg, 3500);
    },
  };

  /* ════════════════════════════════════════════════════════════
     LOCAL DB (NOVO em v4.2) — IndexedDB wrapper
     ─────────────────────────────────────────────────────────────
     Stores:
       drafts       → rascunhos auto-salvos (key = formId, autoinc=false)
       reports      → relatórios pendentes/sincronizados
       budgets      → orçamentos pendentes/sincronizados
       syncQueue    → fila de operações pendentes para REST/Function
       photos       → fotos em base64 antes do upload (resize-on-add)

     Cada record carrega:
       _localId    UUID gerado client-side (estável após sync)
       _syncStatus 'pending' | 'syncing' | 'synced' | 'error'
       _updatedAt  timestamp ms
       _serverId?  id retornado pelo servidor após sync (preenchido)

     API resumida:
       DB.put('reports', { client_name, ... })  → Promise<localId>
       DB.get('reports', localId)               → Promise<record|null>
       DB.list('reports', { status, limit })    → Promise<record[]>
       DB.update('reports', localId, patch)     → Promise<record>
       DB.delete('reports', localId)            → Promise<void>
       DB.queueOp({ type, table, payload })     → Promise<opId>
       DB.dequeueOps(limit)                     → Promise<op[]>
       DB.markOp(opId, status, serverId?)       → Promise<void>
  ════════════════════════════════════════════════════════════ */
  var LocalDB = (function () {

    var DB_NAME = 'fieldo';
    var DB_VERSION = 1;
    var STORES = ['drafts', 'reports', 'budgets', 'syncQueue', 'photos'];

    var _dbPromise = null;
    var _supported = (typeof indexedDB !== 'undefined');

    function _uuid() {
      /* RFC4122 v4 simplificado, suficiente para localId */
      if (crypto && crypto.randomUUID) return crypto.randomUUID();
      var s = '';
      for (var i = 0; i < 32; i++) {
        s += Math.floor(Math.random() * 16).toString(16);
        if (i === 7 || i === 11 || i === 15 || i === 19) s += '-';
      }
      return s;
    }

    function _open() {
      if (!_supported) {
        return Promise.reject(new Error('IndexedDB indisponível'));
      }
      if (_dbPromise) return _dbPromise;

      _dbPromise = new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = function () { reject(req.error || new Error('IDB open error')); };
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          STORES.forEach(function (name) {
            if (!db.objectStoreNames.contains(name)) {
              if (name === 'syncQueue') {
                db.createObjectStore(name, { keyPath: '_opId' });
              } else if (name === 'drafts') {
                /* drafts: keyPath = formId (string fixa por form) */
                db.createObjectStore(name, { keyPath: 'formId' });
              } else {
                var store = db.createObjectStore(name, { keyPath: '_localId' });
                store.createIndex('syncStatus', '_syncStatus', { unique: false });
                store.createIndex('updatedAt',  '_updatedAt',  { unique: false });
              }
            }
          });
        };
        req.onsuccess = function () { resolve(req.result); };
      });

      return _dbPromise;
    }

    function _tx(storeName, mode) {
      return _open().then(function (db) {
        var tx = db.transaction([storeName], mode);
        return tx.objectStore(storeName);
      });
    }

    function _wrap(req) {
      return new Promise(function (resolve, reject) {
        req.onsuccess = function () { resolve(req.result); };
        req.onerror   = function () { reject(req.error); };
      });
    }

    /* ── PUT (insert ou update) ──────────────────────────── */
    function put(storeName, data) {
      var record = Object.assign({}, data);
      if (storeName === 'drafts') {
        if (!record.formId) return Promise.reject(new Error('drafts requer formId'));
        record._updatedAt = Date.now();
      } else if (storeName !== 'syncQueue') {
        if (!record._localId)    record._localId    = _uuid();
        if (!record._syncStatus) record._syncStatus = 'pending';
        record._updatedAt = Date.now();
      }
      return _tx(storeName, 'readwrite').then(function (store) {
        return _wrap(store.put(record));
      }).then(function () {
        return record;
      });
    }

    function get(storeName, key) {
      return _tx(storeName, 'readonly').then(function (store) {
        return _wrap(store.get(key));
      });
    }

    function list(storeName, opts) {
      opts = opts || {};
      return _tx(storeName, 'readonly').then(function (store) {
        return new Promise(function (resolve, reject) {
          var results = [];
          var limit = opts.limit || 1000;
          var req = store.openCursor(null, opts.reverse ? 'prev' : 'next');
          req.onsuccess = function (e) {
            var cursor = e.target.result;
            if (!cursor || results.length >= limit) return resolve(results);
            var v = cursor.value;
            if (!opts.status || v._syncStatus === opts.status) {
              results.push(v);
            }
            cursor.continue();
          };
          req.onerror = function () { reject(req.error); };
        });
      });
    }

    function update(storeName, key, patch) {
      return _tx(storeName, 'readwrite').then(function (store) {
        return _wrap(store.get(key)).then(function (existing) {
          if (!existing) throw new Error('Record não encontrado: ' + key);
          var updated = Object.assign({}, existing, patch, { _updatedAt: Date.now() });
          return _wrap(store.put(updated)).then(function () { return updated; });
        });
      });
    }

    function del(storeName, key) {
      return _tx(storeName, 'readwrite').then(function (store) {
        return _wrap(store.delete(key));
      });
    }

    function clear(storeName) {
      return _tx(storeName, 'readwrite').then(function (store) {
        return _wrap(store.clear());
      });
    }

    /* ── Sync Queue helpers ──────────────────────────────── */
    function queueOp(op) {
      var record = {
        _opId:       _uuid(),
        type:        op.type,         /* 'create' | 'update' | 'delete' */
        table:       op.table,        /* 'reports' | 'budgets' */
        localId:     op.localId,      /* referência ao record */
        payload:     op.payload,      /* dados a enviar */
        attempts:    0,
        status:      'pending',       /* 'pending' | 'syncing' | 'done' | 'error' */
        lastError:   null,
        createdAt:   Date.now(),
      };
      return _tx('syncQueue', 'readwrite').then(function (store) {
        return _wrap(store.put(record)).then(function () { return record._opId; });
      });
    }

    function dequeueOps(limit) {
      return list('syncQueue', { limit: limit || 20 })
        .then(function (ops) {
          return ops.filter(function (o) { return o.status === 'pending'; });
        });
    }

    function markOp(opId, status, extra) {
      return _tx('syncQueue', 'readwrite').then(function (store) {
        return _wrap(store.get(opId)).then(function (op) {
          if (!op) return;
          op.status = status;
          if (extra) Object.assign(op, extra);
          if (status === 'syncing') op.attempts = (op.attempts || 0) + 1;
          return _wrap(store.put(op));
        });
      });
    }

    function deleteOp(opId) {
      return del('syncQueue', opId);
    }

    /* ── Counters / stats ─────────────────────────────────── */
    function pendingCount(storeName) {
      return list(storeName, { status: 'pending' }).then(function (rows) {
        return rows.length;
      });
    }

    function isSupported() { return _supported; }

    /* Limpa TODOS os stores locais. Usado no logout: sem isso, os
       dados do profissional anterior ficariam visíveis para quem
       usasse o mesmo aparelho depois. */
    function wipe() {
      var stores = ['reports', 'budgets', 'professionals', 'drafts', 'ops'];
      return Promise.all(stores.map(function (s) {
        return clear(s).catch(function () { return null; });
      }));
    }

    return {
      put:           put,
      wipe:          wipe,
      get:           get,
      list:          list,
      update:        update,
      delete:        del,
      clear:         clear,
      queueOp:       queueOp,
      dequeueOps:    dequeueOps,
      markOp:        markOp,
      deleteOp:      deleteOp,
      pendingCount:  pendingCount,
      isSupported:   isSupported,
      _uuid:         _uuid,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     DRAFT (NOVO em v4.2) — auto-save de formulários
     ─────────────────────────────────────────────────────────────
     Salva o estado de um form a cada 600ms. Recupera ao reabrir.

     Uso:
       FIELDO.Draft.attach('servico', form, {
         debounce: 600,
         exclude: ['photo']  // campos que não fazem sentido salvar
       });
       FIELDO.Draft.restore('servico', form); // ao abrir página
       FIELDO.Draft.clear('servico');         // ao submeter com sucesso
  ════════════════════════════════════════════════════════════ */
  var Draft = (function () {

    var _timers = {};

    /* Coleta inputs/textareas/selects dentro do container.
       Aceita tanto <form> quanto qualquer elemento com inputs dentro. */
    function _inputsOf(container) {
      if (!container) return [];
      if (container.elements) {
        /* HTMLFormElement */
        return Array.prototype.filter.call(container.elements, function (el) {
          return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
        });
      }
      return Array.prototype.slice.call(
        container.querySelectorAll('input, textarea, select')
      );
    }

    function _serialize(container, exclude) {
      exclude = exclude || [];
      var data = {};
      _inputsOf(container).forEach(function (el) {
        var key = el.name || el.id;
        if (!key || exclude.indexOf(key) > -1) return;
        if (el.type === 'file' || el.type === 'submit' || el.type === 'button') return;
        if (el.type === 'checkbox' || el.type === 'radio') {
          if (el.checked) data[key] = el.value;
        } else {
          data[key] = el.value;
        }
      });
      return data;
    }

    function _apply(container, data) {
      if (!data) return 0;
      var count = 0;
      _inputsOf(container).forEach(function (el) {
        var key = el.name || el.id;
        if (!key || !(key in data)) return;
        if (el.type === 'checkbox' || el.type === 'radio') {
          el.checked = (el.value === data[key]);
        } else {
          el.value = data[key];
        }
        count++;
      });
      return count;
    }

    function attach(formId, container, opts) {
      opts = opts || {};
      var debounce = opts.debounce || 600;
      var exclude  = opts.exclude  || [];

      function save() {
        clearTimeout(_timers[formId]);
        _timers[formId] = setTimeout(function () {
          var data = _serialize(container, exclude);
          LocalDB.put('drafts', { formId: formId, data: data }).catch(function () {});
        }, debounce);
      }

      container.addEventListener('input',  save);
      container.addEventListener('change', save);
      return save;
    }

    function restore(formId, container) {
      return LocalDB.get('drafts', formId).then(function (rec) {
        if (!rec || !rec.data) return 0;
        return _apply(container, rec.data);
      }).catch(function () { return 0; });
    }

    function clear(formId) {
      clearTimeout(_timers[formId]);
      delete _timers[formId];
      return LocalDB.delete('drafts', formId).catch(function () {});
    }

    function exists(formId) {
      return LocalDB.get('drafts', formId).then(function (rec) {
        return !!(rec && rec.data && Object.keys(rec.data).length);
      }).catch(function () { return false; });
    }

    return {
      attach:  attach,
      restore: restore,
      clear:   clear,
      exists:  exists,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     SYNC ENGINE (NOVO em v4.2) — fila persistente + retry
     ─────────────────────────────────────────────────────────────
     Processa LocalDB.syncQueue enviando ops pra REST/Function.

     Comportamento:
       - Roda automático em intervalos (30s) e em eventos online/focus
       - Retry exponencial com backoff (até 5 tentativas)
       - Op 'create' → POST /rest/v1/{table}, salva _serverId no record
       - Op 'update' → PATCH /rest/v1/{table}?id=eq.{serverId}
       - Op 'delete' → DELETE /rest/v1/{table}?id=eq.{serverId}

     Em produção (com Netlify Function /api/sync) pode trocar
     o endpoint pra um único POST /api/sync com batch + deviceHash.
  ════════════════════════════════════════════════════════════ */
  var SyncEngine = (function () {

    var POLL_INTERVAL_MS = 30 * 1000; /* 30s */
    var MAX_ATTEMPTS = 5;
    var BACKOFF_BASE_MS = 5000;

    var _started  = false;
    var _running  = false;
    var _timer    = null;
    var _listeners = [];

    function _fire(event, data) {
      _listeners.forEach(function (fn) {
        try { fn(event, data); } catch (e) {}
      });
    }

    function on(callback) {
      _listeners.push(callback);
      return function () {
        var i = _listeners.indexOf(callback);
        if (i > -1) _listeners.splice(i, 1);
      };
    }

    function _isOnline() {
      return typeof navigator === 'undefined' || navigator.onLine !== false;
    }

    /* Executa uma op individual */
    function _runOp(op) {
      var url, method, body;
      if (op.type === 'create') {
        url = '/' + op.table;
        method = 'POST';
        body = op.payload;
      } else if (op.type === 'update') {
        if (!op.serverId) throw new Error('update requer serverId');
        url = '/' + op.table + '?id=eq.' + encodeURIComponent(op.serverId);
        method = 'PATCH';
        body = op.payload;
      } else if (op.type === 'delete') {
        if (!op.serverId) throw new Error('delete requer serverId');
        url = '/' + op.table + '?id=eq.' + encodeURIComponent(op.serverId);
        method = 'DELETE';
        body = undefined;
      } else {
        throw new Error('Tipo de op desconhecido: ' + op.type);
      }

      return _req(method, url, body).then(function (resp) {
        return Array.isArray(resp) ? resp[0] : resp;
      });
    }

    /* Atualiza o record local com serverId após CREATE bem-sucedido */
    function _writeBackServerId(table, localId, serverRow) {
      if (!serverRow || !serverRow.id) return Promise.resolve();
      return LocalDB.update(table, localId, {
        _serverId:   serverRow.id,
        _syncStatus: 'synced',
      }).catch(function () {});
    }

    /* Processa fila uma vez */
    function flush() {
      if (_running) return Promise.resolve({ skipped: true });
      if (!LocalDB.isSupported()) return Promise.resolve({ unsupported: true });
      if (!_isOnline()) {
        _fire('offline');
        return Promise.resolve({ offline: true });
      }
      _running = true;
      _fire('start');

      return LocalDB.dequeueOps(20).then(function (ops) {
        if (!ops.length) {
          _fire('idle');
          return { processed: 0 };
        }

        var processed = 0, failed = 0;

        function next(i) {
          if (i >= ops.length) return { processed: processed, failed: failed };
          var op = ops[i];

          if (op.attempts >= MAX_ATTEMPTS) {
            return LocalDB.markOp(op._opId, 'error', { lastError: 'max attempts' })
              .then(function () { failed++; return next(i + 1); });
          }

          /* Backoff exponencial: se já tentou N vezes, só roda se passou
             N * BASE * 2^(N-1) ms desde createdAt */
          var minWait = BACKOFF_BASE_MS * Math.pow(2, op.attempts - 1);
          if (op.attempts > 0 && (Date.now() - op.createdAt < minWait)) {
            return next(i + 1); /* espera próximo flush */
          }

          return LocalDB.markOp(op._opId, 'syncing').then(function () {
            return _runOp(op).then(function (serverRow) {
              processed++;
              _fire('opSuccess', { op: op, serverRow: serverRow });
              return _writeBackServerId(op.table, op.localId, serverRow);
            }).then(function () {
              return LocalDB.deleteOp(op._opId);
            }).catch(function (err) {
              failed++;
              _fire('opError', { op: op, error: err });
              return LocalDB.markOp(op._opId, 'pending', {
                lastError: String(err && err.message || err).slice(0, 200),
              });
            });
          }).then(function () { return next(i + 1); });
        }

        return next(0);
      }).then(function (result) {
        _running = false;
        _fire('end', result);
        return result;
      }).catch(function (err) {
        _running = false;
        _fire('error', err);
        throw err;
      });
    }

    /* Inicia loop automático */
    function start() {
      if (_started) return;
      _started = true;

      /* Primeiro flush imediato */
      setTimeout(function () { flush().catch(function () {}); }, 1000);

      /* Loop */
      _timer = setInterval(function () {
        flush().catch(function () {});
      }, POLL_INTERVAL_MS);

      /* Eventos */
      if (typeof window !== 'undefined') {
        window.addEventListener('online', function () { flush().catch(function () {}); });
        window.addEventListener('focus',  function () { flush().catch(function () {}); });
      }
    }

    function stop() {
      _started = false;
      if (_timer) { clearInterval(_timer); _timer = null; }
    }

    /* ── v6.6: diagnóstico e recuperação da fila ─────────────────
       Antes, uma operação que esgotava as tentativas virava erro
       permanente e ficava na fila para sempre. O usuário via
       "⚠ 1 falha no envio" indefinidamente, sem poder ver o que era,
       tentar de novo ou descartar.

       Alerta sem ação é ruído — e ensina o usuário a ignorar avisos,
       inclusive os importantes. */
    function errors() {
      if (!LocalDB.isSupported()) return Promise.resolve([]);
      return LocalDB.list('syncQueue', { limit: 1000 })
        .then(function (ops) {
          return ops.filter(function (o) { return o.status === 'error'; })
            .map(function (o) {
              return {
                id:         o._opId,
                tipo:       o.type || o.method || '?',
                tabela:     o.table || '?',
                motivo:     o.lastError || 'desconhecido',
                tentativas: o.attempts || 0,
                quando:     o.createdAt ? new Date(o.createdAt).toISOString() : null,
                /* resumo do que se perderia ao descartar */
                resumo:     (o.payload && (o.payload.client_name || o.payload.nome ||
                              o.payload.titulo)) || null,
              };
            });
        }).catch(function () { return []; });
    }

    /* Devolve as falhas para a fila. Serve quando a causa era
       temporária (rede caiu, servidor fora) ou já foi corrigida. */
    function retryErrors() {
      return errors().then(function (lista) {
        return Promise.all(lista.map(function (e) {
          return LocalDB.markOp(e.id, 'pending', { attempts: 0, lastError: null })
            .catch(function () { return null; });
        })).then(function () { return lista.length; });
      });
    }

    /* Descarta em definitivo. Só faz sentido quando a operação não é
       mais válida — por exemplo, um registro já recriado à mão. */
    function discardErrors() {
      return errors().then(function (lista) {
        return Promise.all(lista.map(function (e) {
          return LocalDB.deleteOp(e.id).catch(function () { return null; });
        })).then(function () { return lista.length; });
      });
    }


    function status() {
      if (!LocalDB.isSupported()) {
        return Promise.resolve({ online: _isOnline(), pending: 0, errors: 0, running: false, supported: false });
      }
      return Promise.all([
        LocalDB.list('syncQueue', { limit: 1000 }),
      ]).then(function (results) {
        var ops = results[0] || [];
        var pending = ops.filter(function (o) { return o.status === 'pending'; });
        var error   = ops.filter(function (o) { return o.status === 'error'; });
        return {
          online:    _isOnline(),
          pending:   pending.length,
          errors:    error.length,
          running:   _running,
          supported: true,
        };
      }).catch(function () {
        return { online: _isOnline(), pending: 0, errors: 0, running: false, supported: false };
      });
    }

    return {
      start:  start,
      stop:   stop,
      flush:  flush,
      status: status,
      on:     on,
      /* v6.6: diagnóstico e recuperação de falhas */
      errors:        errors,
      retryErrors:   retryErrors,
      discardErrors: discardErrors,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     RATE LIMIT (NOVO em v4.1)
     ─────────────────────────────────────────────────────────────
     Limita tentativas dentro de janela de tempo, persistido em
     sessionStorage para sobreviver a reload mas zerar com aba
     fechada. Inspirado em FR.Security.AntiTamper.

     Uso típico:
       var allowed = FIELDO.RateLimit.check('activation');
       if (!allowed.ok) return alert(allowed.message);
       // ...tenta operação...
       FIELDO.RateLimit.record('activation');

     Configuração por chave (default: 5 / 10 min):
       FIELDO.RateLimit.config('activation', { max: 3, windowMs: 60000 });
  ════════════════════════════════════════════════════════════ */
  var RateLimit = (function () {

    var DEFAULTS = { max: 5, windowMs: 10 * 60 * 1000 };
    var _configs = {}; /* key → {max, windowMs} */
    var _SS_PREFIX = '_fieldo_rl_';

    function _conf(key) {
      return _configs[key] || DEFAULTS;
    }

    function _load(key) {
      try {
        var raw = sessionStorage.getItem(_SS_PREFIX + key);
        return raw ? JSON.parse(raw) : { count: 0, windowStart: Date.now() };
      } catch (e) {
        return { count: 0, windowStart: Date.now() };
      }
    }

    function _save(key, state) {
      try { sessionStorage.setItem(_SS_PREFIX + key, JSON.stringify(state)); }
      catch (e) {}
    }

    function _formatWait(ms) {
      var min = Math.ceil(ms / 60000);
      return min <= 1 ? '1 minuto' : (min + ' minutos');
    }

    /* Configura limites para uma chave. Chamar uma vez no boot. */
    function config(key, opts) {
      _configs[key] = {
        max:       (opts && typeof opts.max === 'number')      ? opts.max      : DEFAULTS.max,
        windowMs:  (opts && typeof opts.windowMs === 'number') ? opts.windowMs : DEFAULTS.windowMs,
      };
    }

    /* Verifica se ainda há tentativas disponíveis.
       Retorna { ok, remaining, retryInMs?, message? } */
    function check(key) {
      var c = _conf(key);
      var state = _load(key);
      var now = Date.now();

      /* Janela expirou — reset */
      if (now - state.windowStart > c.windowMs) {
        state = { count: 0, windowStart: now };
        _save(key, state);
      }

      if (state.count >= c.max) {
        var retryInMs = (state.windowStart + c.windowMs) - now;
        return {
          ok:        false,
          remaining: 0,
          retryInMs: retryInMs,
          message:   'Muitas tentativas. Aguarde ' + _formatWait(retryInMs) + ' e tente novamente.',
        };
      }

      return {
        ok:        true,
        remaining: c.max - state.count,
      };
    }

    /* Registra uma tentativa. Chamar APÓS a operação (sucesso ou falha). */
    function record(key) {
      var state = _load(key);
      var c = _conf(key);
      var now = Date.now();

      if (now - state.windowStart > c.windowMs) {
        state = { count: 0, windowStart: now };
      }

      state.count++;
      _save(key, state);
      return state.count;
    }

    /* Reset manual (após sucesso, para zerar contador) */
    function reset(key) {
      try { sessionStorage.removeItem(_SS_PREFIX + key); } catch (e) {}
    }

    return {
      config: config,
      check:  check,
      record: record,
      reset:  reset,
    };
  })();

  /* Pré-configura limite de ativação Pro: 5 tentativas / 10 min */
  RateLimit.config('activation', { max: 5, windowMs: 10 * 60 * 1000 });

  /* ════════════════════════════════════════════════════════════
     LICENSE — validação Pro via token HMAC client-side
     v4.0 — modelo FadReview: token assinado pelo admin, validado offline.

     Fluxo:
       1. Admin gera token via Edge Function license-issue (x-admin-key)
       2. Token = base64(payload) + "." + HMAC-SHA256(payload).slice(0,20)
       3. Admin manda pro cliente via WhatsApp
       4. Cliente cola em ativar.html → verifySignature → saveActivation
       5. Pro liberado offline até a data exp do payload
  ════════════════════════════════════════════════════════════ */
  var License = (function () {

    /* ── v5.0: NÃO existe mais segredo aqui. ──────────────────
       A v4 remontava o HMAC em runtime a partir de chunks Base64.
       Ofuscação não é criptografia: o segredo estava publicado.

       Agora o token vai para a Edge Function /license, que valida
       com o segredo do servidor e grava plan='pro' no banco. O que
       fica no cliente é só um CACHE de UX — se alguém adulterar,
       o app pinta um badge dourado e mais nada: as policies de
       Contratos consultam is_pro() no Postgres. */

    var STORAGE_KEY = _lsKey('license_cache');

    function _cache()      { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return null; } }
    function _saveCache(o) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(o)); } catch (e) {} }
    function clearActivation() { try { localStorage.removeItem(STORAGE_KEY); } catch (e) {} }

    function daysLeft(exp) {
      if (!exp) return null;
      return Math.ceil((new Date(exp + 'T23:59:59') - new Date()) / 86400000);
    }

    /* Status offline-first: responde do perfil em cache (que veio do
       servidor), sem exigir rede. */
    function getStatus() {
      var prof = LS.get('session_data');
      var c    = _cache();
      var plan = (prof && prof.plan) || (c && c.plan) || 'free';
      var exp  = (prof && prof.plan_expires_at ? String(prof.plan_expires_at).slice(0, 10) : null)
                 || (c && c.expires) || null;

      if (plan !== 'pro') return Promise.resolve({ active: false, reason: 'no_token' });

      var dl = daysLeft(exp);
      if (exp && dl <= 0) return Promise.resolve({ active: false, reason: 'expired', daysLeft: dl });
      return Promise.resolve({ active: true, daysLeft: dl, payload: { p: 'pro', exp: exp } });
    }

    /* Ativação: sempre online. É uma operação rara e precisa do
       servidor — não faz sentido tentar resolver offline. */
    function activate(token) {
      if (!token || !String(token).trim()) {
        return Promise.resolve({ ok: false, error: 'empty_token' });
      }
      return Session.getAccessToken().then(function (jwt) {
        if (!jwt) return { ok: false, error: 'unauthenticated' };
        return fetch(EDGE_URL + '/license', {
          method: 'POST',
          headers: {
            'apikey':        ANON_KEY,
            'Authorization': 'Bearer ' + jwt,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ token: String(token).trim() }),
        }).then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (res) {
            if (!res.ok) return { ok: false, error: res.error || 'invalid' };
            /* v5.2: chave é de uso único por conta. 'ja_usada' significa que
               ela foi resgatada por OUTRA conta — normalmente repasse. */
            _saveCache({ plan: 'pro', expires: res.expires, at: Date.now() });
            /* v8.0: ANTES aqui era `_profData = null; LS.remove('session_data')`.
               Isso deslogava o usuário — Auth.isLoggedIn() usa session_data
               como prova de "perfil completo", então ativar o Pro mandava a
               pessoa para o onboarding com o perfil já existente no banco
               (e o create() seguinte batia em duplicate key, porque
               professionals.id é PK = auth.uid()).
               Agora recarrega do servidor: o cache é REESCRITO com o plano
               novo em vez de destruído.
               O .catch mantém a ativação como sucesso mesmo sem rede — ela
               JÁ aconteceu no servidor; o cache local se corrige sozinho na
               próxima leitura. Falhar aqui seria mentir para o usuário. */
            return Professionals.me(true)
              .catch(function () { return null; })
              .then(function () {
                return { ok: true, payload: { p: 'pro', exp: res.expires, u: res.name },
                         daysLeft: daysLeft(res.expires) };
              });
          });
      }).catch(function () {
        return { ok: false, error: 'network' };
      });
    }

    return {
      getStatus:         getStatus,
      activate:          activate,
      clearActivation:   clearActivation,
      /* compat v4 — sem segredo, decode é meramente informativo */
      decode: function (token) {
        try { return JSON.parse(atob(String(token).split('.')[0].replace(/-/g,'+').replace(/_/g,'/'))); }
        catch (e) { return null; }
      },
      daysLeft: daysLeft,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     VALIDATOR (NOVO em v4.1)
     ─────────────────────────────────────────────────────────────
     Estados tipados de licença com mensagens prontas para UI.
     Inspirado em FR.Security.Validator.

     Estados:
       VALID         — licença OK
       UNLICENSED    — sem token salvo
       EXPIRED       — token salvo mas exp passou
       INVALID       — token corrompido ou assinatura errada
       RATE_LIMITED  — muitas tentativas de ativação

     Uso:
       FIELDO.Validator.validate().then(function (r) {
         if (r.status === 'VALID') showPro(r.daysLeft);
         else if (r.status === 'EXPIRED') showRenew(r.message);
         else showActivate(r.message);
       });

       FIELDO.Validator.activate(token).then(function (r) {
         if (r.status === 'VALID') celebrate();
         else showError(r.message); // já vem traduzido
       });
  ════════════════════════════════════════════════════════════ */
  var Validator = (function () {

    var STATUS = {
      VALID:        'VALID',
      UNLICENSED:   'UNLICENSED',
      EXPIRED:      'EXPIRED',
      INVALID:      'INVALID',
      RATE_LIMITED: 'RATE_LIMITED',
    };

    var MESSAGES = {
      VALID:        null,
      UNLICENSED:   'Cole sua chave Pro para continuar.',
      EXPIRED:      'Sua licença expirou. Renove para continuar usando o Pro.',
      INVALID:      'Chave inválida. Verifique e tente novamente.',
      RATE_LIMITED: 'Muitas tentativas. Aguarde alguns minutos.',
    };

    function _result(status, payload, daysLeft, customMessage) {
      return {
        valid:    status === STATUS.VALID,
        status:   status,
        payload:  payload || null,
        daysLeft: (daysLeft === undefined ? null : daysLeft),
        message:  customMessage || MESSAGES[status],
      };
    }

    /* Valida o estado atual (sem tentar ativar nada) */
    function validate() {
      return License.getStatus().then(function (s) {
        if (s.active) return _result(STATUS.VALID, s.payload, s.daysLeft);
        if (s.reason === 'no_token')      return _result(STATUS.UNLICENSED);
        if (s.reason === 'expired')       return _result(STATUS.EXPIRED, s.payload, s.daysLeft);
        if (s.reason === 'unauthenticated') return _result(STATUS.INVALID);
        if (s.reason === 'network')         return _result(STATUS.INVALID, null, null,
          'Sem conexão. A ativação do Pro precisa de internet uma vez.');
        return _result(STATUS.INVALID);
      }).catch(function () {
        return _result(STATUS.INVALID);
      });
    }

    /* Ativa um token aplicando rate limit */
    function activate(token) {
      var rl = RateLimit.check('activation');
      if (!rl.ok) {
        return Promise.resolve(_result(STATUS.RATE_LIMITED, null, null, rl.message));
      }

      return License.activate(token).then(function (r) {
        RateLimit.record('activation');
        if (r.ok) {
          RateLimit.reset('activation'); /* sucesso zera contador */
          return _result(STATUS.VALID, r.payload, r.daysLeft);
        }
        if (r.error === 'ja_usada')    return _result(STATUS.INVALID, null, null,
          'Esta chave já foi ativada em outra conta. Cada chave vale para um profissional. Fale com quem vendeu.');
        if (r.error === 'expired')     return _result(STATUS.EXPIRED, r.payload, r.daysLeft);
        if (r.error === 'empty_token') return _result(STATUS.UNLICENSED);
        if (r.error === 'network')     return _result(STATUS.INVALID, null, null,
          'Sem conexão. A ativação do Pro precisa de internet uma vez.');
        return _result(STATUS.INVALID);
      }).catch(function () {
        RateLimit.record('activation');
        return _result(STATUS.INVALID);
      });
    }

    return {
      STATUS:   STATUS,
      MESSAGES: MESSAGES,
      validate: validate,
      activate: activate,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     PRO — wrapper de compat sobre License + Validator
     Mantém a mesma interface das versões anteriores para não quebrar
     páginas existentes (index.html, contratos.html, ativar.html).
  ════════════════════════════════════════════════════════════ */
  var Pro = (function () {
    var _cache = null;

    function check(force) {
      if (!force && _cache && (Date.now() - _cache.checked_at < 60000)) {
        return Promise.resolve(_cache.active);
      }
      return License.getStatus().then(function (status) {
        _cache = {
          active:     status.active,
          payload:    status.payload,
          daysLeft:   status.daysLeft,
          checked_at: Date.now(),
        };
        return status.active;
      });
    }

    function activate(code) {
      return License.activate(code).then(function (result) {
        if (result.ok) {
          _cache = {
            active:     true,
            payload:    result.payload,
            daysLeft:   result.daysLeft,
            checked_at: Date.now(),
          };
          return {
            ok:             true,
            already_active: false,
            expires_at:     result.payload && result.payload.exp,
          };
        }
        /* Mapeia erros de License para o formato esperado pela ativar.html */
        var errMap = {
          empty_token:    'empty_code',
          invalid_format: 'invalid_code',
          bad_signature:  'invalid_code',
          expired:        'expired_code',
        };
        return { ok: false, error: errMap[result.error] || 'invalid_code' };
      });
    }

    function details() {
      return License.getStatus().then(function (status) {
        if (!status.active) return null;
        return {
          activated_at: null, /* v5.0: data de ativação vive no servidor */
          expires_at:   status.payload && status.payload.exp,
          plan:         status.payload && status.payload.p,
          user_name:    status.payload && status.payload.u,
          days_left:    status.daysLeft,
        };
      });
    }

    function clearCache() { _cache = null; }

    /* Admin: stubs vazios. O painel admin agora é standalone (não usa RPCs).
       codes.html foi removido na v5.0: continha o segredo HMAC no cliente. */
    var Admin = {
      generateCode:   function () { return Promise.reject(new Error('Emissao movida para a Edge Function license-issue')); },
      listCodes:      function () { return Promise.resolve([]); },
      listProUsers:   function () { return Promise.resolve([]); },
      revokeAccess:   function () { return Promise.reject(new Error('Revogação não suportada no modelo HMAC v4')); },
      deactivateCode: function () { return Promise.reject(new Error('Desativação não suportada no modelo HMAC v4')); },
    };

    return {
      check:      check,
      activate:   activate,
      details:    details,
      clearCache: clearCache,
      Admin:      Admin,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     AUTH EMAIL — DEPRECATED em v4.0
     OTP por email exigia configuração no Supabase Dashboard que se mostrou
     frágil (templates, redirect URLs, rate limits). Mantido como stub para
     páginas que ainda referenciam — todos os métodos retornam falso/null.
     Login agora é apenas por OTP de WhatsApp (FIELDO.Auth).
  ════════════════════════════════════════════════════════════ */
  var AuthEmail = {
    isLoggedIn:         function () { return false; },
    sendOtp:            function () { return Promise.reject(new Error('Email auth desativado em v4.0')); },
    verifyOtp:          function () { return Promise.reject(new Error('Email auth desativado em v4.0')); },
    sendMagicLink:      function () { return Promise.reject(new Error('Email auth desativado em v4.0')); },
    handleAuthCallback: function () { return Promise.resolve(null); },
    getUser:            function () { return Promise.resolve(null); },
    refreshSession:     function () { return Promise.resolve(null); },
    logout:             function () { return Promise.resolve(); },
    _getAccessToken:    function () { return null; },
    _getSession:        function () { return null; },
  };

  /* ════════════════════════════════════════════════════════════
     HAMBURGER MENU
  ════════════════════════════════════════════════════════════ */
  var HBG = (function () {
    var _open = false;

    function _els() {
      return {
        btn:     document.getElementById('menuBtn'),
        drawer:  document.getElementById('menuDrawer'),
        overlay: document.getElementById('menuOverlay'),
      };
    }

    function open() {
      _open = true;
      var e = _els();
      if (e.btn)     { e.btn.classList.add('is-open'); e.btn.setAttribute('aria-expanded', 'true'); }
      if (e.drawer)  { e.drawer.classList.add('is-open'); e.drawer.setAttribute('aria-hidden', 'false'); }
      if (e.overlay) e.overlay.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      /* v12.8 · o balão de dica (fg-sus, z-index 9997) ficava POR CIMA
         do menu aberto, tapando "Orçamento" e "Fiel". Abriu o menu, a
         dica sai — ela já cumpriu o papel. */
      Array.prototype.forEach.call(document.querySelectorAll('.fg-sus'), function (s) { s.style.display = 'none'; });
    }

    function close() {
      _open = false;
      var e = _els();
      if (e.btn)     { e.btn.classList.remove('is-open'); e.btn.setAttribute('aria-expanded', 'false'); }
      if (e.drawer)  { e.drawer.classList.remove('is-open'); e.drawer.setAttribute('aria-hidden', 'true'); }
      if (e.overlay) e.overlay.classList.remove('is-open');
      document.body.style.overflow = '';
    }

    function toggle() { _open ? close() : open(); }

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && _open) close();
    });

    return { open: open, close: close, toggle: toggle, isOpen: function(){ return _open; } };
  })();

  /* ════════════════════════════════════════════════════════════
     NAV — menu compartilhado em todas as páginas autenticadas
  ════════════════════════════════════════════════════════════ */
  var Nav = {
    mount: function (activeKey) {
      activeKey = activeKey || '';
      if (document.getElementById('menuDrawer')) return;

      var items = [
        { key: 'dashboard', href: '/painel.html',     label: 'Dashboard',    icon: 'dashboard' },
        { key: 'servico',   href: '/servico.html',   label: 'Novo serviço', icon: 'bolt' },
        { key: 'obras',     href: '/obra.html',      label: 'Obras',        icon: 'dashboard' },
        { key: 'orcamento', href: '/orcamento.html', label: 'Orçamentos',   icon: 'doc' },
        /* v8.6: saiu o requiresPro. Escondido do menu, o módulo era
           invisível: quem não é Pro nunca soube que existia — o banco
           tinha 1 empreiteiro no total. A cota agora está na criação
           do segundo, não na existência do item de menu. */
        { key: 'contratos', href: '/contratos.html', label: 'Contratos',    icon: 'check' },
        { key: 'busca',     href: '/busca.html',     label: 'Pesquisa',     icon: 'search' },
        { key: 'explorar',  href: '/explorar.html',  label: 'Explorar',     icon: 'compass' },
        /* v8.1: entra para TODO mundo, não só para quem já é Pro. Quem é
           Pro precisa de um lugar para ver vencimento e fatura em aberto;
           quem não é precisa achar o plano sem bater no limite primeiro. */
        /* v8.3: cotação de material. Entra pra todo mundo — montar e
           exportar lista é gratuito; o que fica no Pro é a estimativa
           de preço (Fase 5). Ver DECISAO-materiais-pro.md. */
        { key: 'materiais', href: '/materiais.html', label: 'Material',     icon: 'caixa' },
        { key: 'planos',    href: '/planos.html',    label: 'Meu plano',    icon: 'star' },
      ];

      var icons = {
        dashboard: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
        bolt:      '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
        doc:       '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>',
        check:     '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>',
        search:    '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
        compass:   '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
        caixa:     '<path d="M21 8v11a2 2 0 01-2 2H5a2 2 0 01-2-2V8"/><rect x="2" y="3" width="20" height="5" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/>',
        star:      '<polygon points="12 2.5 15 9 22 9.8 17 14.6 18.3 21.5 12 18.2 5.7 21.5 7 14.6 2 9.8 9 9"/>',
        user:      '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
        logout:    '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
      };

      function svgFor(name) {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' + (icons[name] || '') + '</svg>';
      }

      /* Filtra itens Pro de acordo com o entitlement do usuário.
         Como Pro.check é assíncrono e retorna cache, não bloqueamos o render:
         monta primeiro sem itens-Pro, depois injeta se aplicável. */
      function buildItemsHtml(includePro) {
        return items
          .filter(function (it) { return !it.requiresPro || includePro; })
          .map(function (it) {
            var active = it.key === activeKey ? ' active' : '';
            var aria   = it.key === activeKey ? ' aria-current="page"' : '';
            return '<a href="' + it.href + '" class="menu-nav-item' + active + '"' + aria + '>' +
                     '<span class="menu-nav-icon">' + svgFor(it.icon) + '</span>' +
                     '<span class="menu-nav-label">' + it.label + '</span>' +
                   '</a>';
          }).join('');
      }

      /* Render inicial: assume sem Pro (mais conservador). Atualiza depois. */
      var navItems = buildItemsHtml(false);

      var html =
        '<div class="menu-overlay" id="menuOverlay" onclick="FIELDO.HBG.close()" aria-hidden="true"></div>' +
        '<aside class="menu-drawer" id="menuDrawer" aria-hidden="true" aria-label="Menu de navegação">' +
          '<div class="menu-section-lbl">Navegação</div>' +
          '<nav class="menu-nav" aria-label="Navegação principal">' +
            navItems +
            '<button class="menu-nav-item" onclick="FIELDO.HBG.close();if(window.abrirPerfil)abrirPerfil();else window.location.href=\'/painel.html\'" aria-label="Abrir perfil">' +
              '<span class="menu-nav-icon">' + svgFor('user') + '</span>' +
              '<span class="menu-nav-label">Perfil</span>' +
            '</button>' +
            '<button class="menu-nav-item" onclick="FIELDO.Nav.confirmLogout()" aria-label="Sair da conta">' +
              '<span class="menu-nav-icon">' + svgFor('logout') + '</span>' +
              '<span class="menu-nav-label">Sair</span>' +
            '</button>' +
          '</nav>' +
        '</aside>';

      var container = document.createElement('div');
      container.innerHTML = html;
      while (container.firstChild) document.body.appendChild(container.firstChild);

      /* Após mount, checa Pro e re-renderiza se necessário.

         v9.0: a condição era `AuthEmail && AuthEmail.isLoggedIn()`.
         AuthEmail virou STUB na v4.0 e isLoggedIn() devolve `false`
         fixo — então este bloco NUNCA rodou. Quem paga jamais viu um
         item `requiresPro` no menu.

         Hoje isso não aparece porque nenhum item é requiresPro (o de
         Contratos saiu na v8.6). É armadilha, não bug ativo: no dia em
         que alguém marcar um item como Pro, ele some para quem pagou —
         e o revendedor leva a culpa por vender o que "não apareceu".

         Agora usa Auth.isLoggedIn(), que é o login de verdade. */
      if (Pro && Auth.isLoggedIn()) {
        Pro.check().then(function (isPro) {
          if (!isPro) return;
          var nav = document.querySelector('#menuDrawer .menu-nav');
          if (!nav) return;
          var newNavItems = buildItemsHtml(true);
          /* Substitui os links de navegação preservando os botões finais (perfil/logout) */
          var firstButton = nav.querySelector('button');
          if (firstButton) {
            /* remove os <a> antigos */
            Array.from(nav.querySelectorAll('a.menu-nav-item')).forEach(function (a) { nav.removeChild(a); });
            /* insere os novos antes do primeiro botão */
            var tmp = document.createElement('div');
            tmp.innerHTML = newNavItems;
            while (tmp.firstChild) nav.insertBefore(tmp.firstChild, firstButton);
          }
        });
      }
    },

    confirmLogout: function () {
      if (window.confirm('Deseja sair da sua conta?')) {
        /* Faz logout em ambas as camadas (telefone + email) */
        if (AuthEmail && AuthEmail.isLoggedIn()) {
          AuthEmail.logout();
        }
        Auth.logout();
        if (Pro) Pro.clearCache();
        window.location.href = '/entrar.html';
      }
    },
  };

  /* ════════════════════════════════════════════════════════════
     NICHES (NOVO em v4.3) — categorias de serviço (default + custom)
     ─────────────────────────────────────────────────────────────
     8 nichos default sempre presentes.
     Pro pode adicionar até MAX_CUSTOM nichos customizados:
       { key: 'jardinagem', label: 'Jardinagem', emoji: '🌱' }
     Persistido em localStorage (não exige column no banco).

     Free  → list() retorna apenas defaults
     Pro   → list() retorna defaults + customizados
     emoji() / label() funcionam pra qualquer key (default ou custom)
  ════════════════════════════════════════════════════════════ */
  /* ════════════════════════════════════════════════════════════
     ÍCONES — v10.0
     ─────────────────────────────────────────────────────────────
     As categorias de serviço e os filtros do Explorar usavam EMOJI
     do sistema operacional: ⚡ 🔧 🎨 ❄️ 🧱 💻 🔩 ⚙️ 🔍 ⭐ 💬 🆕.

     Emoji renderiza diferente em cada aparelho — Apple Color Emoji no
     iPhone, Noto no Android — e nenhum dos dois combina com o
     Fraunces serifado. É o que mais destoava da identidade que o dono
     quer manter: premium, técnica, profissional.

     Um traço só: 24×24, stroke 1.8, pontas arredondadas, sem
     preenchimento. Herdam currentColor, então servem no papel claro e
     no herói escuro sem duplicata.

     Nicho CUSTOM (Pro) continua com o emoji que o profissional
     escolheu — aquilo é dado dele, não cromo da interface. Trocar
     seria inventar em cima do que ele decidiu.
     ════════════════════════════════════════════════════════════ */
  var Icones = (function () {
    var P = { /* miolo de cada ícone */
      /* navegação */
      casa:      '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M9.5 20v-6h5v6"/>',
      /* v12.31 · o Fiel na barra de baixo */
      conversa:  '<path d="M20 14.5a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/><path d="M8.5 9.5h7M8.5 12.5h4.5"/>',
      lista:     '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1.2"/><circle cx="3.5" cy="12" r="1.2"/><circle cx="3.5" cy="18" r="1.2"/>',
      mais:      '<path d="M12 5v14M5 12h14"/>',
      lupa:      '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/>',
      pessoa:    '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
      /* categorias */
      eletrica:        '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
      /* gota. A chave inglesa dizia "ferramenta", que serve pra todo
         nicho — não distinguia hidráulica de nada. */
      hidraulica:      '<path d="M12 2.7c0 0 6.5 7 6.5 11.1a6.5 6.5 0 0 1-13 0C5.5 9.7 12 2.7 12 2.7z"/>',
      pintura:         '<path d="M4 4h13v6H4z"/><path d="M17 7h2.5a1.5 1.5 0 0 1 1.5 1.5V12a2 2 0 0 1-2 2h-6"/><path d="M11 14h3v3.5a1.5 1.5 0 0 1-1.5 1.5h0a1.5 1.5 0 0 1-1.5-1.5V14z"/><path d="M12.5 19v3"/>',
      /* floco de 3 eixos. O de 6 pontas com farpas ficava denso
         demais ao lado dos outros — mesmo tamanho, peso visual maior. */
      "ar-condicionado":'<path d="M12 2.5v19M3.7 7.2l16.6 9.6M20.3 7.2 3.7 16.8"/><path d="M12 6.6 9.4 4.6M12 6.6l2.6-2M12 17.4l-2.6 2M12 17.4l2.6 2"/>',
      alvenaria:       '<path d="M3 6h18v4H3zM3 10h18v4H3zM3 14h18v4H3z"/><path d="M9 6v4M15 10v4M9 14v4"/>',
      informatica:     '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M2 20h20"/>',
      /* v10.1 · prédio + casa. NÃO reaproveita o ícone 'casa', que já é
         o Início da navegação — mesmo desenho em dois papéis confunde. */
      imoveis:         '<path d="M3 21V9l6-4v16"/><path d="M9 21V11l6-4v14"/><path d="M15 21V13l6-3v11"/><path d="M2 21h20"/><path d="M6 12.5v.01M6 16v.01M12 14v.01M12 17.5v.01M18 15v.01M18 18v.01"/>',
      /* porca sextavada. A primeira versão eram raios em volta de um
         círculo e renderizou como SOL — só vi renderizando a folha. */
      serralheria:     '<path d="M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5z"/><circle cx="12" cy="12" r="3.4"/>',
      outro:           '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
      /* interface */
      olho:      '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
      compartilhar:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
      estrela:   '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3z"/>',
      seta:      '<path d="M5 12h14M13 6l6 6-6 6"/>',
      volta:     '<path d="M19 12H5M11 18l-6-6 6-6"/>',
      alerta:    '<path d="M12 3 1.8 20.5h20.4L12 3z"/><path d="M12 10v4M12 17.5v.01"/>',
      check:     '<path d="m20 6-11 11-5-5"/>',
      relogio:   '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
      documento: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
      semRede:   '<path d="M2 3l19 19"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 13a10 10 0 0 1 3.2-2.1M19 13a10 10 0 0 0-4-2.6"/><path d="M1.8 9.5A15 15 0 0 1 7 6.3M22.2 9.5a15 15 0 0 0-8.6-3.4"/><path d="M12 20v.01"/>',
      recarregar:'<path d="M20 11A8 8 0 0 0 6.3 6.3L3 9.5"/><path d="M3 4.5v5h5"/><path d="M4 13a8 8 0 0 0 13.7 4.7L21 14.5"/><path d="M21 19.5v-5h-5"/>',
      filtro:    '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/>',
      x:         '<path d="M18 6 6 18M6 6l12 12"/>',
      raio:      '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
      pasta:     '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
      menu:      '<path d="M4 7h16M4 12h16M4 17h16"/>',
      selo:      '<circle cx="12" cy="9" r="6"/><path d="m8.5 14.5-1.5 7 5-2.5 5 2.5-1.5-7"/>',
      grafico:   '<path d="M3 21h18"/><path d="M6 21V11M11 21V6M16 21v-7M21 21v-11"/>',
    };

    /* Um SVG, sem duplicar atributo em 40 lugares. */
    function get(nome, tamanho) {
      var d = P[nome];
      if (!d) return '';
      var t = tamanho || 20;
      return '<svg width="' + t + '" height="' + t + '" viewBox="0 0 24 24" ' +
        'fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        d + '</svg>';
    }
    function tem(nome) { return !!P[nome]; }
    return { get: get, tem: tem, _nomes: Object.keys(P) };
  })();

  /* ════════════════════════════════════════════════════════════
     NAVEGAÇÃO INFERIOR — v10.0
     ─────────────────────────────────────────────────────────────
     Um componente, montado por JS, em vez de 19 cópias de markup que
     divergem na primeira edição. Cada página chama:

         FIELDO.Nav.montar('inicio');

     Contratos, Orçamentos, Reputação, Configurações e Suporte ficam
     no menu secundário (a gaveta) — são menos frequentes, e Contratos
     ainda é Pro.
     ════════════════════════════════════════════════════════════ */
  /* ════════════════════════════════════════════════════════════
     PROGRESSO E PRÓXIMO PASSO — v10.0
     ─────────────────────────────────────────────────────────────
     O brief pede que nenhuma tela importante termine em "e agora?".
     Isso não se resolve com layout — se resolve tendo, em algum lugar,
     UMA função que olha o estado real e responde qual é a próxima
     coisa a fazer. Sem ela, cada tela chuta e as telas divergem.

     Duas regras que estas funções seguem:

     1. O que falta é dito com o MOTIVO. "Falta a cidade" não move
        ninguém; "sem a cidade você não aparece em quem busca por
        Caraguatatuba" move.

     2. A ordem é por BLOQUEIO, não por percentual. Quem não tem nome,
        profissão e cidade está travado pelo gatilho do banco — não
        adianta sugerir foto.
     ════════════════════════════════════════════════════════════ */
  var Perfil = (function () {

    /* Só campos que EXISTEM na tabela professionals. Conferido no
       schema — inventar campo aqui daria uma barra de progresso que
       nunca chega a 100%. */
    var CAMPOS = [
      { campo: 'name',      rotulo: 'Seu nome',      trava: true,
        porque: 'É o que o cliente vê primeiro.' },
      { campo: 'profissao', rotulo: 'Sua profissão', trava: true,
        porque: 'É por ela que você aparece na busca.' },
      { campo: 'city',      rotulo: 'Sua cidade',    trava: true,
        porque: 'Quase toda busca é "eletricista em <cidade>".' },
      { campo: 'logo_url',  rotulo: 'Sua foto',      trava: false,
        porque: 'Perfil com foto passa mais confiança que um contorno.' },
      /* v12.19e · trava: true. O gatilho do banco não exige, mas a
         faixa do painel já tratava WhatsApp como bloqueio e este cartão
         não — a mesma tela dizia "falta seu WhatsApp" e, logo abaixo,
         "registre o primeiro serviço e seu perfil abre na hora". Sem
         WhatsApp o perfil abre sem botão de contato: não serve. */
      { campo: 'whatsapp',  rotulo: 'Seu WhatsApp',  trava: true,
        porque: 'É o botão de contato do seu perfil público.' },
      { campo: 'bio',       rotulo: 'Uma descrição', trava: false,
        porque: 'Duas linhas sobre o que você faz.' },
    ];

    function preenchido(prof, campo) {
      return !!String((prof || {})[campo] || '').trim();
    }

    function progresso(prof) {
      var feitos = [], faltam = [];
      CAMPOS.forEach(function (c) {
        (preenchido(prof, c.campo) ? feitos : faltam).push(c);
      });
      return {
        pct:    Math.round((feitos.length / CAMPOS.length) * 100),
        feitos: feitos,
        faltam: faltam,
        /* trava = o gatilho do banco não liga o perfil público sem */
        travando: faltam.filter(function (c) { return c.trava; }),
        completo: faltam.length === 0,
      };
    }

    /* Uma resposta só, para Início e Meu Perfil não discordarem.
       stats = { total, publicos, mes, avgScore } de Reports.stats() */
    function proximoPasso(prof, stats) {
      prof  = prof  || {};
      stats = stats || {};
      var pr = progresso(prof);
      var publicos = Number(stats.publicos || 0);
      var MIN = 3;

      if (pr.travando.length) {
        var nomes = pr.travando.map(function (c) { return _minusc(c.rotulo); });
        var soZap = pr.travando.length === 1 && pr.travando[0].campo === 'whatsapp';
        return {
          id: 'completar-cadastro',
          titulo: 'Complete seu perfil',
          texto: 'Falta ' + _lista(nomes) + '. ' + (soZap
                 ? 'Sem ele, quem abrir seu perfil não tem como te chamar.'
                 : 'Sem isso o Fieldo não consegue te mostrar pra quem procura.'),
          cta: { rotulo: 'Completar agora', href: '/meu-perfil.html#editar' },
        };
      }

      if (publicos === 0) {
        return {
          id: 'primeiro-servico',
          titulo: 'Registre seu primeiro serviço',
          texto: 'Um trabalho que você já fez, com foto e data. Sai um ' +
                 'documento pro cliente — e seu perfil público abre na hora.',
          cta: { rotulo: 'Registrar serviço', href: '/servico.html' },
        };
      }

      if (publicos < MIN) {
        var faltam = MIN - publicos;
        return {
          id: 'entrar-na-busca',
          titulo: 'Seu perfil já abre — falta entrar na busca',
          texto: 'Você pode mandar seu link agora. Com mais ' + faltam +
                 ' serviço' + (faltam > 1 ? 's' : '') + ' você também passa a ' +
                 'aparecer no Google e no Explorar.',
          cta: { rotulo: 'Registrar serviço', href: '/servico.html' },
        };
      }

      if (!pr.completo) {
        var c = pr.faltam[0];
        return {
          id: 'melhorar-perfil',
          titulo: 'Falta ' + _minusc(c.rotulo),
          texto: c.porque,
          cta: { rotulo: 'Completar perfil', href: '/meu-perfil.html#editar' },
        };
      }

      return {
        id: 'compartilhar',
        titulo: 'Seu perfil está pronto',
        texto: 'Cole o link na bio do Instagram e no recado do WhatsApp. ' +
               'Quem te procurar já vê seu trabalho e suas avaliações.',
        cta: { rotulo: 'Compartilhar', href: '#compartilhar', acao: 'compartilhar' },
      };
    }

    /* "Seu WhatsApp" → "seu WhatsApp" (toLowerCase dava "seu whatsapp") */
    function _minusc(t) { t = String(t || ''); return t.charAt(0).toLowerCase() + t.slice(1); }

    function _lista(itens) {
      if (itens.length === 1) return itens[0];
      if (itens.length === 2) return itens[0] + ' e ' + itens[1];
      return itens.slice(0, -1).join(', ') + ' e ' + itens[itens.length - 1];
    }

    return { CAMPOS: CAMPOS, progresso: progresso, proximoPasso: proximoPasso };
  })();

  var NavInf = (function () {
    /* v10.25 · MVP: "Explorar" saiu da barra — a página continua no ar
       (link direto funciona normal), só não é mais um dos 4 destinos
       fixos enquanto o foco é o loop cadastro → serviço → perfil
       publicado → contato. Ver MVP-fieldo.md. */
    /* v12.31 · auditoria de UX/UI (04/11): com três destinos e o "+",
       o botão de criar ficava fora do centro (Início, Serviços, +,
       Perfil) — a barra parecia torta. Volta a ter dois de cada lado,
       e o quarto é o Fiel, que já estava no menu de todas as telas e
       não tinha atalho. */
    var DESTINOS = [
      { id: 'inicio',   href: '/painel.html',      icone: 'casa',     rotulo: 'Início'   },
      { id: 'servicos', href: '/servicos.html',   icone: 'lista',    rotulo: 'Serviços' },
      { id: '+' },
      { id: 'fiel',     href: '/assistente.html', icone: 'conversa', rotulo: 'Fiel'     },
      { id: 'perfil',   href: '/meu-perfil.html', icone: 'pessoa',   rotulo: 'Perfil'   },
    ];

    /* O "+" abre uma folha em vez de ir direto pro serviço: existem
       DUAS coisas que se cria (serviço e orçamento), e escolher por
       alguém é como o dashboard antigo enterrava o orçamento. */
    var CRIAR = [
      { href: '/servico.html',   icone: 'raio',      nome: 'Novo serviço',
        sub: 'Registre um trabalho e ele entra no seu perfil público' },
      { href: '/orcamento.html', icone: 'documento', nome: 'Novo orçamento',
        sub: 'Monte uma proposta pra mandar pro cliente' },
      /* v12.16 · serviço de vários dias: cada relatório desconta do total */
      { href: '/obra.html?nova=1', icone: 'casa', nome: 'Nova obra',
        sub: 'Serviço de vários dias: cada relatório desconta do valor total' },
    ];

    function montar(atual) {
      if (typeof document === 'undefined') return;
      if (document.getElementById('navInf')) return;   /* já montado */

      var html = '<nav class="nav-inf" id="navInf" aria-label="Navegação principal">';
      DESTINOS.forEach(function (d) {
        if (d.id === '+') {
          html += '<div class="nav-novo">' +
            '<button type="button" class="nav-novo-btn" onclick="FIELDO.NavInf.abrirCriar()" ' +
            'aria-label="Criar">' + Icones.get('mais', 24) + '</button></div>';
          return;
        }
        var aqui = d.id === atual;
        html += '<a class="nav-item" href="' + d.href + '"' +
          (aqui ? ' aria-current="page"' : '') + '>' +
          Icones.get(d.icone, 22) + '<span>' + d.rotulo + '</span></a>';
      });
      html += '</nav>';

      html += '<div class="nav-sheet" id="navSheet" onclick="FIELDO.NavInf.fecharCriar(event)">' +
        '<div class="nav-sheet-box" role="dialog" aria-modal="true" aria-label="Criar">' +
        '<div class="nav-sheet-alca" aria-hidden="true"></div>' +
        '<div class="nav-sheet-tit">O que você quer criar?</div>';
      CRIAR.forEach(function (c) {
        html += '<a class="ds-action" href="' + c.href + '" style="margin-bottom:8px">' +
          '<span class="ds-action-ico">' + Icones.get(c.icone, 20) + '</span>' +
          '<span class="ds-action-txt"><span class="ds-action-nome">' + c.nome + '</span>' +
          '<span class="ds-action-sub">' + c.sub + '</span></span>' +
          '<span class="ds-action-seta">' + Icones.get('seta', 18) + '</span></a>';
      });
      html += '</div></div>';

      var wrap = document.createElement('div');
      wrap.innerHTML = html;
      while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
      document.body.classList.add('tem-nav-inf');
    }

    function abrirCriar() {
      var el = document.getElementById('navSheet');
      if (el) el.classList.add('aberta');
    }
    /* Fecha ao tocar no fundo, não ao tocar na folha. */
    function fecharCriar(ev) {
      var el = document.getElementById('navSheet');
      if (!el) return;
      if (ev && ev.target !== el) return;
      el.classList.remove('aberta');
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') fecharCriar();
      });
    }

    return { montar: montar, abrirCriar: abrirCriar, fecharCriar: fecharCriar,
             DESTINOS: DESTINOS, CRIAR: CRIAR };
  })();

  /* ════════════════════════════════════════════════════════════
     v12.9 · PROFISSÕES — a lista única de ofícios do Fieldo
     ─────────────────────────────────────────────────────────────
     Antes eram 8 categorias com emoji numa grade, e tudo que não
     cabia nelas virava "Outro": no banco, 19 dos 55 relatórios e 4
     perfis estão em "outro" — jardineiro, artesão, higienização,
     locação. O ofício da pessoa sumia da busca.

     Agora: 70 profissões pré-configuradas, sem ícone, num campo onde
     o profissional DIGITA ou ESCOLHE. O que não está na lista vira
     categoria própria com o nome que a pessoa escreveu — nunca mais
     "Outro".

     [chave, nome, plural, sinônimos]
     · as 8 chaves antigas (eletrica, hidraulica…) ficam IGUAIS: são o
       que está gravado no banco e o que as páginas /eletricista-em-…
       usam. Só o nome mostrado passou a ser a profissão.
     · sinônimos = o jeito que a pessoa escreve ("elétrica",
       "bombeiro hidráulico", "faxina"), sem acento e minúsculo.
     · a mesma lista está em netlify/edge-functions/lista-local.ts
       (NICHO_POR_TERMO) — mudou aqui, muda lá; há teste conferindo. */
  var Profissoes = (function () {
    var LISTA = [
      ['eletrica', 'Eletricista', 'Eletricistas', ['eletrica', 'eletrico', 'eletricidade', 'eletricista predial', 'eletricista residencial', 'automacao residencial', 'quadro de luz']],
      ['hidraulica', 'Encanador', 'Encanadores', ['hidraulica', 'bombeiro hidraulico', 'encanamento', 'encanacao', 'caca vazamento', 'vazamento']],
      ['pintura', 'Pintor', 'Pintores', ['pintura', 'pintor residencial', 'textura', 'grafiato', 'marmorato']],
      ['alvenaria', 'Pedreiro', 'Pedreiros', ['alvenaria', 'obra', 'obras', 'reforma', 'reformas', 'reformas em geral', 'construcao', 'acabamento']],
      ['serralheria', 'Serralheiro', 'Serralheiros', ['serralheria', 'portao', 'portoes', 'instalador de portoes', 'grade', 'grades']],
      ['ar-condicionado', 'Técnico de ar-condicionado', 'Técnicos de ar-condicionado', ['ar condicionado', 'ar-condicionado', 'refrigeracao', 'tecnico em refrigeracao', 'climatizacao', 'split', 'instalador de split']],
      ['informatica', 'Técnico de informática', 'Técnicos de informática', ['informatica', 'computador', 'notebook', 'formatacao']],
      ['imoveis', 'Corretor de imóveis', 'Corretores de imóveis', ['imoveis', 'corretor', 'imobiliaria']],
      ['construtor', 'Empreiteiro', 'Empreiteiros', ['construtor', 'empreiteira', 'mestre de obras', 'construtora']],
      ['azulejista', 'Azulejista', 'Azulejistas', ['porcelanato', 'aplicador de porcelanato', 'assentador de piso', 'piso', 'revestimento']],
      ['gesseiro', 'Gesseiro', 'Gesseiros', ['gesso', 'drywall', 'forro', 'sanca']],
      ['telhadista', 'Telhadista', 'Telhadistas', ['telhado', 'calheiro', 'calha', 'calhas', 'cobertura']],
      ['impermeabilizacao', 'Impermeabilizador', 'Impermeabilizadores', ['impermeabilizacao', 'infiltracao', 'manta asfaltica']],
      ['marceneiro', 'Marceneiro', 'Marceneiros', ['marcenaria', 'moveis planejados', 'moveis sob medida']],
      ['carpinteiro', 'Carpinteiro', 'Carpinteiros', ['carpintaria', 'madeira', 'deck', 'pergolado']],
      ['vidraceiro', 'Vidraceiro', 'Vidraceiros', ['vidracaria', 'vidro', 'box de banheiro', 'espelho']],
      ['soldador', 'Soldador', 'Soldadores', ['solda', 'soldagem']],
      ['montador-de-moveis', 'Montador de móveis', 'Montadores de móveis', ['montagem de moveis', 'montador']],
      ['marido-de-aluguel', 'Marido de aluguel', 'Maridos de aluguel', ['faz tudo', 'reparos', 'pequenos reparos', 'manutencao residencial', 'servicos gerais', 'zelador']],
      ['desentupidor', 'Desentupidor', 'Desentupidores', ['desentupidora', 'desentupimento', 'esgoto', 'fossa', 'limpa fossa']],
      ['energia-solar', 'Instalador de energia solar', 'Instaladores de energia solar', ['energia solar', 'fotovoltaico', 'fotovoltaica', 'placa solar', 'placas solares', 'aquecedor solar']],
      ['cameras-e-alarmes', 'Instalador de câmeras e alarmes', 'Instaladores de câmeras e alarmes', ['camera', 'cameras', 'cftv', 'instalador de cameras', 'alarme', 'seguranca eletronica', 'cerca eletrica', 'interfone', 'portao eletronico']],
      ['redes-e-internet', 'Técnico de redes e internet', 'Técnicos de redes e internet', ['redes', 'instalador de redes', 'wi-fi', 'wifi', 'internet', 'cabeamento']],
      ['antenista', 'Antenista', 'Antenistas', ['antena', 'antenas', 'tv a cabo', 'parabolica']],
      ['eletrodomesticos', 'Técnico de eletrodomésticos', 'Técnicos de eletrodomésticos', ['eletrodomesticos', 'geladeira', 'maquina de lavar', 'lava e seca', 'fogao', 'micro-ondas']],
      ['tecnico-de-celular', 'Técnico de celular', 'Técnicos de celular', ['celular', 'conserto de celular', 'assistencia tecnica']],
      ['chaveiro', 'Chaveiro', 'Chaveiros', ['chave', 'chaves', 'fechadura', 'fechaduras']],
      ['jardineiro', 'Jardineiro', 'Jardineiros', ['jardim', 'jardinagem', 'paisagista', 'paisagismo', 'poda', 'corte de grama', 'rocada']],
      ['piscineiro', 'Piscineiro', 'Piscineiros', ['piscina', 'piscinas', 'limpeza de piscina', 'manutencao de piscina']],
      ['diarista', 'Diarista', 'Diaristas', ['faxina', 'faxineira', 'faxineiro', 'limpeza residencial', 'passadeira']],
      ['limpeza-pos-obra', 'Limpeza pós-obra', 'Limpeza pós-obra', ['pos obra', 'pos-obra', 'limpeza de obra']],
      ['higienizacao-de-estofados', 'Higienização de estofados', 'Higienização de estofados', ['higienizacao', 'estofados', 'limpeza de sofa', 'sofa', 'colchao', 'tapetes', 'limpeza e higienizacao']],
      ['dedetizacao', 'Dedetizador', 'Dedetizadores', ['dedetizacao', 'dedetizadora', 'controle de pragas', 'cupim', 'descupinizacao']],
      ['limpeza-de-caixa-dagua', "Limpeza de caixa d'água", "Limpeza de caixa d'água", ['caixa d agua', 'caixa dagua', 'reservatorio']],
      ['tapeceiro', 'Tapeceiro', 'Tapeceiros', ['tapecaria', 'reforma de estofados', 'estofador']],
      ['costureira', 'Costureira', 'Costureiras', ['costura', 'costureiro', 'ajustes de roupa', 'consertos de roupa']],
      ['fretes-e-mudancas', 'Fretes e mudanças', 'Fretes e mudanças', ['frete', 'fretes', 'mudanca', 'mudancas', 'carreto', 'carretos']],
      ['locacao-de-equipamentos', 'Locação de equipamentos', 'Locação de equipamentos', ['locacao', 'locador', 'aluguel de equipamentos', 'aluguel', 'cacamba', 'andaimes', 'betoneira']],
      ['mecanico', 'Mecânico', 'Mecânicos', ['mecanica', 'mecanico automotivo', 'oficina']],
      ['eletricista-automotivo', 'Eletricista automotivo', 'Eletricistas automotivos', ['auto eletrica', 'eletrica automotiva']],
      ['funilaria', 'Funileiro', 'Funileiros', ['funilaria', 'lanternagem', 'pintura automotiva', 'martelinho de ouro']],
      ['estetica-automotiva', 'Estética automotiva', 'Estética automotiva', ['lavagem', 'lava rapido', 'lava jato', 'polimento', 'higienizacao automotiva', 'vitrificacao']],
      ['borracheiro', 'Borracheiro', 'Borracheiros', ['borracharia', 'pneu', 'pneus']],
      ['guincho', 'Guincho', 'Guinchos', ['reboque', 'auto socorro']],
      ['cabeleireiro', 'Cabeleireiro', 'Cabeleireiros', ['cabeleireira', 'salao', 'salao de beleza', 'cabelo']],
      ['barbeiro', 'Barbeiro', 'Barbeiros', ['barbearia', 'barba']],
      ['manicure', 'Manicure', 'Manicures', ['pedicure', 'unhas', 'nail designer', 'alongamento de unhas']],
      ['maquiador', 'Maquiador', 'Maquiadores', ['maquiadora', 'maquiagem', 'make']],
      ['esteticista', 'Esteticista', 'Esteticistas', ['estetica', 'depilacao', 'limpeza de pele', 'designer de sobrancelhas', 'sobrancelha', 'cilios']],
      ['massoterapeuta', 'Massoterapeuta', 'Massoterapeutas', ['massagem', 'massagista', 'drenagem']],
      ['personal-trainer', 'Personal trainer', 'Personal trainers', ['personal', 'treino', 'educador fisico']],
      ['professor-particular', 'Professor particular', 'Professores particulares', ['professora', 'aulas particulares', 'aula particular', 'reforco escolar', 'professor de ingles']],
      ['professor-de-musica', 'Professor de música', 'Professores de música', ['aula de violao', 'aula de musica', 'musica']],
      ['fotografo', 'Fotógrafo', 'Fotógrafos', ['fotografa', 'fotografia', 'ensaio fotografico']],
      ['videomaker', 'Videomaker', 'Videomakers', ['filmagem', 'video', 'edicao de video', 'drone']],
      ['designer-grafico', 'Designer gráfico', 'Designers gráficos', ['design', 'designer', 'logotipo', 'logo', 'identidade visual', 'social media']],
      ['buffet', 'Buffet e eventos', 'Buffets e eventos', ['buffet', 'eventos', 'festas', 'churrasqueiro', 'garcom', 'garcons']],
      ['confeiteiro', 'Confeiteiro', 'Confeiteiros', ['confeiteira', 'bolos', 'doces', 'confeitaria', 'salgados']],
      ['cozinheiro', 'Cozinheiro', 'Cozinheiros', ['cozinheira', 'marmitas', 'chef', 'personal chef']],
      ['cuidador-de-idosos', 'Cuidador de idosos', 'Cuidadores de idosos', ['cuidadora', 'cuidador', 'acompanhante de idosos']],
      ['baba', 'Babá', 'Babás', ['baba', 'cuidadora de criancas']],
      ['adestrador', 'Adestrador', 'Adestradores', ['adestramento', 'cachorro', 'caes']],
      ['banho-e-tosa', 'Banho e tosa', 'Banho e tosa', ['pet shop', 'tosa', 'tosador', 'dog walker', 'passeador de caes', 'pet sitter']],
      ['arquiteto', 'Arquiteto', 'Arquitetos', ['arquiteta', 'arquitetura', 'projeto arquitetonico', 'design de interiores', 'decorador']],
      ['engenheiro-civil', 'Engenheiro civil', 'Engenheiros civis', ['engenheiro', 'engenharia', 'laudo', 'art']],
      ['topografo', 'Topógrafo', 'Topógrafos', ['topografia', 'levantamento topografico']],
      ['contador', 'Contador', 'Contadores', ['contadora', 'contabilidade', 'mei', 'imposto de renda']],
      ['despachante', 'Despachante', 'Despachantes', ['documentacao de veiculos', 'licenciamento']],
      ['artesao', 'Artesão', 'Artesãos', ['artesa', 'artesanato', 'artesao caicara']],
    ];
    /* Chaves antigas que não são mais oferecidas, só lidas. */
    var LEGADO = { outro: 'Outro' };

    function normal(t) {
      return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    }
    function slug(t) {
      return normal(t).replace(/ /g, '-').slice(0, 40).replace(/-+$/, '');
    }
    var _porChave = {};
    LISTA.forEach(function (p) { _porChave[p[0]] = p; });

    function lista() {
      return LISTA.map(function (p) { return { key: p[0], label: p[1], plural: p[2] }; })
        .sort(function (a, b) { return a.label.localeCompare(b.label, 'pt-BR'); });
    }

    /* O texto que a pessoa escreveu → a chave. Ordem: igual ao nome ou
       a um sinônimo; depois o termo MAIS LONGO contido no texto, palavra
       inteira ("Eletricista automotivo" acha o automotivo, não o
       eletricista); depois um nome que comece com o que foi digitado.
       Nada disso → a chave nasce do próprio texto. Nunca "outro". */
    function nicho(texto) {
      var t = normal(texto);
      if (!t) return null;
      var melhor = null, tam = 0, i, j, termos;
      for (i = 0; i < LISTA.length; i++) {
        termos = [LISTA[i][1], LISTA[i][2]].concat(LISTA[i][3]);
        for (j = 0; j < termos.length; j++) {
          var n = normal(termos[j]);
          if (n === t) return LISTA[i][0];
          if (n.length > tam && (' ' + t + ' ').indexOf(' ' + n + ' ') !== -1) { melhor = LISTA[i][0]; tam = n.length; }
        }
      }
      if (melhor) return melhor;
      if (t.length >= 3) {
        for (i = 0; i < LISTA.length; i++) if (normal(LISTA[i][1]).indexOf(t) === 0) return LISTA[i][0];
      }
      return _porChave[slug(texto)] ? slug(texto) : (slug(texto) || null);
    }

    /* Nome para mostrar de uma chave. Chave criada a partir de texto
       livre ("artesao-caicara") volta legível ("Artesao caicara") —
       quem tem o texto original (category_label) deve preferir ele. */
    function rotulo(key) {
      if (!key) return '';
      if (_porChave[key]) return _porChave[key][1];
      if (LEGADO[key]) return LEGADO[key];
      var s = String(key).replace(/-/g, ' ');
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    function plural(key) { return _porChave[key] ? _porChave[key][2] : rotulo(key); }
    function conhecida(key) { return !!_porChave[key]; }

    /* Escolha completa a partir do texto: {key, label}. Se o texto bate
       com uma profissão da lista, o rótulo é o nome dela; senão, é o
       texto da pessoa, limpo. */
    function resolver(texto) {
      var bruto = String(texto || '').replace(/\s+/g, ' ').trim();
      if (!bruto) return null;
      var k = nicho(bruto);
      /* reconhecida → o nome da lista (o mesmo para todo mundo, e é o
         que agrupa no Explorar); fora da lista → o texto da pessoa */
      if (_porChave[k]) return { key: k, label: _porChave[k][1] };
      if (bruto.length > 40) bruto = bruto.slice(0, 40).replace(/\s+\S*$/, '');
      return { key: k, label: bruto.charAt(0).toUpperCase() + bruto.slice(1) };
    }

    function buscar(termo, max) {
      var t = normal(termo);
      if (t.length < 1) return [];
      var res = [];
      LISTA.forEach(function (p) {
        var nome = normal(p[1]), pos = nome.indexOf(t), pontos = -1;
        if (pos === 0) pontos = 0; else if (pos > 0) pontos = 1;
        else if (p[3].some(function (s) { return normal(s).indexOf(t) === 0; })) pontos = 2;
        else if (p[3].some(function (s) { return normal(s).indexOf(t) !== -1; })) pontos = 3;
        if (pontos >= 0) res.push({ key: p[0], label: p[1], pontos: pontos });
      });
      res.sort(function (a, b) { return a.pontos - b.pontos || a.label.length - b.label.length; });
      return res.slice(0, max || 6);
    }

    function _esc(t) {
      return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /* Liga um <input> a uma lista de sugestões (<ul>). onEscolha({key,
       label}) roda ao escolher uma sugestão, ao sair do campo e a cada
       digitação (com o texto como está). Teclado: setas, Enter, Esc. */
    function ligar(input, ul, onEscolha) {
      if (!input || !ul) return;
      var ativa = -1;
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-expanded', 'false');
      input.setAttribute('autocomplete', 'off');
      if (!ul.id) ul.id = input.id + 'Sug';
      input.setAttribute('aria-controls', ul.id);
      ul.setAttribute('role', 'listbox');
      function fechar() { ul.classList.remove('aberta'); ul.innerHTML = ''; ativa = -1; input.setAttribute('aria-expanded', 'false'); }
      function avisar() { if (onEscolha) onEscolha(resolver(input.value)); }
      function escolher(label) { input.value = label; fechar(); avisar(); }
      function abrir() {
        var t = input.value, achados = buscar(t, 7);
        var temIgual = achados.some(function (a) { return normal(a.label) === normal(t); });
        if (!achados.length && normal(t).length < 3) return fechar();
        var html = achados.map(function (a) {
          return '<li class="sug-item" role="option" aria-selected="false" data-nome="' + _esc(a.label) + '"><span>' + _esc(a.label) + '</span></li>';
        }).join('');
        if (!temIgual && normal(t).length >= 3) {
          html += '<li class="sug-item sug-item--livre" role="option" aria-selected="false" data-nome="' + _esc(t.trim()) + '"><span>Usar “' + _esc(t.trim()) + '”</span></li>';
        }
        ul.innerHTML = html; ul.classList.add('aberta'); input.setAttribute('aria-expanded', 'true'); ativa = -1;
      }
      input.addEventListener('input', function () { abrir(); avisar(); });
      input.addEventListener('focus', function () { if (input.value) abrir(); });
      input.addEventListener('keydown', function (ev) {
        var itens = ul.querySelectorAll('.sug-item');
        if (ev.key === 'Escape') return fechar();
        if (!itens.length) return;
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          ativa += ev.key === 'ArrowDown' ? 1 : -1;
          if (ativa < 0) ativa = itens.length - 1; if (ativa >= itens.length) ativa = 0;
          Array.prototype.forEach.call(itens, function (el, i) { el.classList.toggle('ativo', i === ativa); el.setAttribute('aria-selected', i === ativa ? 'true' : 'false'); });
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          escolher((itens[ativa >= 0 ? ativa : 0]).getAttribute('data-nome'));
        }
      });
      input.addEventListener('blur', function () { setTimeout(function () {
        /* digitou só o começo ("pi") e saiu: completa com o nome que vai
           ser salvo, para a tela não mostrar uma coisa e gravar outra */
        var r = resolver(input.value), t = normal(input.value);
        if (r && _porChave[r.key] && t && normal(r.label).indexOf(t) === 0) input.value = r.label;
        fechar(); avisar();
      }, 160); });
      ul.addEventListener('mousedown', function (ev) {
        var li = ev.target.closest ? ev.target.closest('.sug-item') : null;
        if (!li) return; ev.preventDefault(); escolher(li.getAttribute('data-nome'));
      });
    }

    /* v12.9 · título de um serviço a partir da descrição (mesma régua
       de perfil.html e perfil-seo.ts): a primeira frase que diz o que
       foi feito, sem valores nem saudação. */
    var _RE_DINHEIRO = /(r\$|\$\s*\d|\breais\b|\bvalor|\bempreitada|\bsaldo|\bcobran[cç]a|\bpagamento|\bpagar\b|\bpendente|\btotal\b|\bor[cç]amento|\bdesconto|\bpix\b|\bacerto\b)/i;
    var _RE_GENERICO = /^(servi[cç]os?( realizados?| executados?)?|finaliza[cç][aã]o( dos servi[cç]os)?|descri[cç][aã]o( t[eé]cnica)?( dos servi[cç]os)?( el[eé]tricos)?|resumo|relat[oó]rio|ol[aá]|bom dia|boa tarde|boa noite|condi[cç][oõ]es comerciais|observa[cç][oõ]es)[\s:.!,-]*$/i;
    function tituloServico(desc, categoria) {
      /* frases, não só linhas: um relatório escrito num parágrafo único
         ("Troca do quadro… Valor parcial de R$ 1.000…") ainda rende o
         começo, sem o valor. */
      var linhas = [];
      String(desc || '').split(/\r?\n/).slice(0, 8).forEach(function (ln) {
        ln.split(/(?<=[.!?])\s+/).forEach(function (f) { linhas.push(f); });
      });
      for (var i = 0; i < linhas.length && i < 12; i++) {
        var l = linhas[i]
          .replace(/^[\s#>*\-–—•·]+/, '')          /* marcadores de lista/markdown */
          .replace(/^\d+\s*\\?[.)]\s*/, '')        /* "1\. " "2) " */
          .replace(/[*_`]+/g, '')
          .replace(/\(\s*\$?\s*[\d.,]+\s*\)/g, '')   /* "(40)" "( 79,00)" */
          .replace(/\s+/g, ' ').trim();
        if (l.length < 4) continue;
        if (_RE_DINHEIRO.test(l)) continue;
        if (_RE_GENERICO.test(l)) continue;
        if (/^(ol[aá]|oi|bom dia|boa tarde|boa noite|prezad[oa]s?|obrigad[oa]|obg)(?=[\s,.!;:]|$)/i.test(l)) continue;
        l = l.replace(/[\s:;,.]+$/, '');
        return l.charAt(0).toUpperCase() + l.slice(1);
      }
      return categoria ? 'Serviço de ' + categoria.toLowerCase() : 'Serviço realizado';
    }

    /* v12.25 · todas as profissões de um perfil, principal primeiro:
       [{rotulo, nicho}]. Perfil sem outras → só a principal. */
    function doPerfil(prof) {
      prof = prof || {};
      var out = [], vistos = {};
      var principal = String(prof.profissao || prof.specialty || '').trim();
      if (principal) { out.push({ rotulo: principal, nicho: prof.niche || null, principal: true }); if (prof.niche) vistos[prof.niche] = 1; }
      (Array.isArray(prof.outras_profissoes) ? prof.outras_profissoes : []).forEach(function (o) {
        if (!o || !o.rotulo || (o.nicho && vistos[o.nicho])) return;
        if (o.nicho) vistos[o.nicho] = 1;
        out.push({ rotulo: String(o.rotulo), nicho: o.nicho || null, principal: false });
      });
      return out;
    }

    return { tituloServico: tituloServico, LISTA: LISTA, lista: lista, nicho: nicho, rotulo: rotulo, plural: plural, conhecida: conhecida,
             resolver: resolver, buscar: buscar, ligar: ligar, normal: normal, slug: slug, doPerfil: doPerfil };
  })();

  /* ════════════════════════════════════════════════════════════
     v12.25 · OUTRAS PROFISSÕES
     ─────────────────────────────────────────────────────────────
     Pedido de quem se cadastrou (31/10): "não dá pra adicionar mais
     profissões?". O perfil tinha uma só; quem é eletricista e também
     instala ar-condicionado só aparecia numa busca.

     A principal continua em profissao + niche (título do Google,
     endereço do perfil). As outras, até 3, vão em outras_profissoes
     [{rotulo, nicho}] e o banco junta todas em `nichos`, que é por onde
     a busca e as páginas /pedreiro-em-cidade filtram.

     montar(el, opts) desenha a lista com ✕ e o campo de adicionar (as
     mesmas sugestões da profissão principal). Usado no cadastro
     (entrar.html) e no Editar perfil (meu-perfil.html).
       opts.valor      lista inicial [{rotulo, nicho}]
       opts.principal  função → chave da profissão principal (para não repetir)
       opts.classe     classe do <input> da página ('field-input', 'ds-input')
       opts.id         prefixo dos ids
       opts.aoMudar    função(lista) a cada mudança
     Devolve { valor(), definir(lista) }.
  ════════════════════════════════════════════════════════════ */
  /* v12.28 · auditoria SEO/GEO (04/11), Fase 3 · SEO local.
     As cidades do Litoral Norte, com o nome escrito certo. A mesma lista
     está em lista-local.ts (CIDADES_REGIAO), que as páginas por cidade,
     o sitemap e a página /litoral-norte usam. */
  var Regiao = (function () {
    var CIDADES = [
      { slug: 'caraguatatuba', nome: 'Caraguatatuba' },
      { slug: 'sao-sebastiao', nome: 'São Sebastião' },
      { slug: 'ilhabela',      nome: 'Ilhabela' },
      { slug: 'ubatuba',       nome: 'Ubatuba' },
    ];
    function slug(t) {
      return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/\s*[-–—,/]\s*(sp|sao paulo)\s*$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
    function nome(s) {
      for (var i = 0; i < CIDADES.length; i++) if (CIDADES[i].slug === s) return CIDADES[i].nome;
      return String(s || '').split('-').map(function (w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : w; }).join(' ');
    }
    /* "A", "A e B", "A, B e C" */
    function juntar(lista) {
      lista = (lista || []).filter(Boolean);
      if (lista.length < 2) return lista.join('');
      return lista.slice(0, -1).join(', ') + ' e ' + lista[lista.length - 1];
    }
    /* A linha "Também atende …" do perfil público. Igual a textoAtende()
       em perfil-seo.ts: as cidades marcadas e, depois, o texto livre. */
    function textoAtende(prof) {
      prof = prof || {};
      var nomes = (Array.isArray(prof.cidades_atendidas) ? prof.cidades_atendidas : []).map(nome);
      var partes = [juntar(nomes), String(prof.area_atendimento || '').trim()].filter(Boolean);
      return partes.length ? 'Também atende ' + partes.join(', ') : '';
    }
    /* O campo do Editar perfil: uma caixa por cidade, menos a própria. */
    function montar(el, opts) {
      opts = opts || {};
      var marcadas = {};
      (opts.valor || []).forEach(function (s) { marcadas[s] = 1; });
      el.className = 'ca';
      function desenhar() {
        var propria = slug(opts.cidade ? opts.cidade() : '');
        el.innerHTML = CIDADES.filter(function (c) { return c.slug !== propria; }).map(function (c) {
          var id = (opts.id || 'ca') + '-' + c.slug;
          return '<label class="ca-op" for="' + id + '"><input type="checkbox" id="' + id + '" value="' + c.slug + '"' +
            (marcadas[c.slug] ? ' checked' : '') + '/><span>' + c.nome + '</span></label>';
        }).join('');
        Array.prototype.forEach.call(el.querySelectorAll('input'), function (i) {
          i.addEventListener('change', function () { if (i.checked) marcadas[i.value] = 1; else delete marcadas[i.value]; });
        });
      }
      desenhar();
      return {
        valor: function () {
          var propria = slug(opts.cidade ? opts.cidade() : '');
          return CIDADES.map(function (c) { return c.slug; }).filter(function (s) { return marcadas[s] && s !== propria; });
        },
        redesenhar: desenhar,
      };
    }
    return { CIDADES: CIDADES, slug: slug, nome: nome, juntar: juntar, textoAtende: textoAtende, montar: montar };
  })();

  var OutrasProfissoes = (function () {
    var MAX = 3;
    function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function limpar(lista) {
      var out = [], vistos = {};
      (Array.isArray(lista) ? lista : []).forEach(function (o) {
        if (!o || !o.rotulo || !o.nicho || vistos[o.nicho] || out.length >= MAX) return;
        vistos[o.nicho] = 1;
        out.push({ rotulo: String(o.rotulo).trim().slice(0, 60), nicho: String(o.nicho) });
      });
      return out;
    }

    function montar(el, opts) {
      opts = opts || {};
      var id = opts.id || 'outrasProf';
      var lista = limpar(opts.valor);
      var principal = typeof opts.principal === 'function' ? opts.principal : function () { return null; };
      el.classList.add('op');
      el.innerHTML =
        '<ul class="op-lista" id="' + id + 'Lista" aria-label="Outras profissões"></ul>' +
        '<div class="op-add" id="' + id + 'Add">' +
          '<div class="busca-prof op-busca">' +
            '<input class="' + esc(opts.classe || 'field-input') + '" id="' + id + 'Input" type="text" placeholder="Ex.: Encanador" aria-label="Outra profissão"/>' +
            '<ul class="sug-lista" id="' + id + 'Sug" aria-label="Sugestões de profissão"></ul>' +
          '</div>' +
          '<button type="button" class="op-btn" id="' + id + 'Btn">Adicionar</button>' +
        '</div>' +
        '<div class="op-msg" id="' + id + 'Msg" aria-live="polite"></div>';
      var ul = el.querySelector('.op-lista'), add = el.querySelector('.op-add'),
          input = el.querySelector('#' + id + 'Input'), sug = el.querySelector('#' + id + 'Sug'),
          msg = el.querySelector('.op-msg');

      function aviso(t) { msg.textContent = t || ''; }
      function desenhar() {
        ul.innerHTML = lista.map(function (o, i) {
          return '<li class="op-chip"><span>' + esc(o.rotulo) + '</span>' +
            '<button type="button" data-tirar="' + i + '" aria-label="Tirar ' + esc(o.rotulo) + '">✕</button></li>';
        }).join('');
        ul.hidden = !lista.length;
        add.hidden = lista.length >= MAX;
        if (lista.length >= MAX) aviso('Pronto: ' + MAX + ' profissões além da principal é o máximo.');
      }
      function mudou() { desenhar(); if (opts.aoMudar) opts.aoMudar(lista.slice()); }

      function adicionar() {
        var r = Profissoes.resolver(input.value);
        if (!r || !r.key) { aviso('Escreva a profissão e toque em Adicionar.'); input.focus(); return; }
        if (r.key === principal()) { aviso('“' + r.label + '” já é a sua profissão principal.'); return; }
        if (lista.some(function (o) { return o.nicho === r.key; })) { aviso('“' + r.label + '” já está na lista.'); return; }
        if (lista.length >= MAX) return;
        lista.push({ rotulo: r.label, nicho: r.key });
        input.value = '';
        aviso('');
        mudou();
        if (lista.length < MAX) input.focus();
      }

      Profissoes.ligar(input, sug, null);
      /* escolher uma sugestão já adiciona: o ligar() põe o nome no campo
         primeiro (ele está registrado antes deste) */
      sug.addEventListener('mousedown', function (ev) {
        if (ev.target.closest && ev.target.closest('.sug-item')) setTimeout(adicionar, 0);
      });
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); setTimeout(adicionar, 0); }
      });
      input.addEventListener('input', function () { aviso(''); });
      el.querySelector('.op-btn').addEventListener('click', adicionar);
      ul.addEventListener('click', function (ev) {
        var b = ev.target.closest && ev.target.closest('[data-tirar]');
        if (!b) return;
        lista.splice(+b.getAttribute('data-tirar'), 1);
        aviso('');
        mudou();
        input.focus();
      });
      desenhar();
      return {
        valor: function () { return lista.slice(); },
        definir: function (l) { lista = limpar(l); aviso(''); desenhar(); },
      };
    }
    return { MAX: MAX, montar: montar, limpar: limpar };
  })();

  /* ════════════════════════════════════════════════════════════
     v12.13 · CREDENCIAIS — o que dá confiança ao cliente
     ─────────────────────────────────────────────────────────────
     Dois tipos, mostrados de jeitos diferentes, de propósito:
       · CONFERIDO: CNPJ ativo na Receita Federal. Só o servidor grava
         (Edge Function verificar-cnpj); o dono não tem UPDATE nessas
         colunas. Aparece com ✓.
       · DECLARADO: desde quando atua, garantia, pagamento, urgência e
         registros (NR-10, CREA…). O dono preenche; o perfil diz que é
         "informado pelo profissional".
     Um editor só (painel e Meu perfil usam o mesmo) e um desenho só
     (perfil.html; perfil-seo.ts replica o HTML no servidor). */
  var Credenciais = (function () {
    var PAGAMENTOS = [
      ['pix', 'Pix'], ['dinheiro', 'Dinheiro'], ['cartao_credito', 'Cartão de crédito'],
      ['cartao_debito', 'Cartão de débito'], ['boleto', 'Boleto'], ['transferencia', 'Transferência'],
    ];
    var ROTULO_PAG = {}; PAGAMENTOS.forEach(function (p) { ROTULO_PAG[p[0]] = p[1]; });

    function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }
    function fmtCnpj(c) {
      c = String(c || '').replace(/\D/g, '');
      return c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : c;
    }
    function cnpjValido(c) {
      c = String(c || '').replace(/\D/g, '');
      if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
      function dv(n) { var p = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2], s = 0;
        for (var i = 0; i < n; i++) s += Number(c[i]) * p[i]; var r = s % 11; return r < 2 ? 0 : 11 - r; }
      return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
    }
    function ano(iso) { return iso ? String(iso).slice(0, 4) : ''; }
    function pagamentosTexto(lista) {
      var n = (lista || []).map(function (k) { return ROTULO_PAG[k]; }).filter(Boolean);
      if (!n.length) return '';
      return n.length === 1 ? n[0] : n.slice(0, -1).join(', ') + ' e ' + n[n.length - 1];
    }

    /* Lista do que mostrar no perfil público. Vazio = bloco não aparece. */
    function itens(p) {
      p = p || {};
      var out = [], agora = new Date().getFullYear();
      if (p.cnpj && p.cnpj_situacao === 'ATIVA') {
        out.push({ conferido: true, titulo: 'Empresa ativa na Receita Federal',
          texto: (p.empresa_nome ? p.empresa_nome + ' · ' : '') + 'CNPJ ' + fmtCnpj(p.cnpj) +
                 (p.cnpj_abertura ? ' · aberta em ' + ano(p.cnpj_abertura) : '') });
      }
      if (p.atua_desde && p.atua_desde <= agora) {
        var anos = agora - p.atua_desde;
        out.push({ titulo: 'Atua desde ' + p.atua_desde, texto: anos >= 1 ? anos + (anos === 1 ? ' ano' : ' anos') + ' de experiência' : 'Começou este ano' });
      }
      if ((p.garantia || '').trim()) out.push({ titulo: 'Garantia: ' + p.garantia.trim(), texto: 'Nos serviços que realiza' });
      if (p.atende_urgencia) out.push({ titulo: 'Atende urgência', texto: 'Chamados fora do horário comercial' });
      var pg = pagamentosTexto(p.formas_pagamento);
      if (pg) out.push({ titulo: 'Formas de pagamento', texto: pg });
      if ((p.registros || '').trim()) out.push({ titulo: 'Registros e certificações', texto: p.registros.trim() });
      return out;
    }

    function html(p) {
      var it = itens(p);
      if (!it.length) return '';
      var temDeclarado = it.some(function (i) { return !i.conferido; }), temConferido = it.some(function (i) { return i.conferido; });
      return '<ul class="cred-lista">' + it.map(function (i) {
        return '<li class="cred-item' + (i.conferido ? ' cred-item--ok' : '') + '">' +
          '<span class="cred-ico" aria-hidden="true">' + (i.conferido ? '✓' : '•') + '</span>' +
          '<span><strong>' + esc(i.titulo) + '</strong><span class="cred-txt">' + esc(i.texto) + '</span></span></li>';
      }).join('') + '</ul>' +
      '<p class="cred-nota">' + [temConferido ? 'CNPJ conferido na Receita Federal pelo Fieldo.' : '', temDeclarado ? 'Os demais itens são informados pelo profissional.' : ''].filter(Boolean).join(' ') + '</p>';
    }

    function chamar(corpo) {
      return Session.getAccessToken().then(function (tok) {
        if (!tok) throw new Error('sem_sessao');
        return fetch(EDGE_URL + '/verificar-cnpj', {
          method: 'POST',
          headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
        });
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.code = j.error; e.situacao = j.situacao; throw e; }
          /* atualiza o perfil guardado no aparelho */
          try { var s = LS.get('session_data'); if (s) { Object.assign(s, j.removido ? { cnpj: null, empresa_nome: null, cnpj_situacao: null, cnpj_abertura: null, cnpj_verificado_em: null } : j); delete s.ok; LS.set('session_data', s); } } catch (x) {}
          return j;
        });
      });
    }

    function msgErro(e) {
      var c = e && e.code;
      return c === 'cnpj_invalido' ? 'Este CNPJ não é válido. Confira os números.'
        : c === 'cnpj_nao_encontrado' ? 'A Receita Federal não encontrou este CNPJ.'
        : c === 'cnpj_inativo' ? 'Este CNPJ não está ativo na Receita' + (e.situacao ? ' (situação: ' + e.situacao.toLowerCase() + ')' : '') + '.'
        : c === 'cnpj_em_uso' ? 'Este CNPJ já está em outro perfil do Fieldo.'
        : c === 'receita_indisponivel' ? 'A consulta à Receita está fora do ar agora. Tente de novo em alguns minutos.'
        : 'Não foi possível conferir agora. Tente de novo.';
    }

    /* ── Editor (painel e Meu perfil) ── */
    function editor(el, p) {
      if (!el) return;
      p = p || {};
      var agora = new Date().getFullYear(), anos = ['<option value="">—</option>'];
      for (var a = agora; a >= 1960; a--) anos.push('<option value="' + a + '"' + (Number(p.atua_desde) === a ? ' selected' : '') + '>' + a + '</option>');
      var pags = p.formas_pagamento || [];
      el.innerHTML =
        '<div class="cred-ed">' +
          '<div class="cred-ed-campo">' +
            '<label class="cred-ed-lbl" for="credCnpj">CNPJ da empresa <span class="cred-ed-opc">(opcional)</span></label>' +
            '<div id="credCnpjBox"></div>' +
            '<div class="cred-ed-dica">Conferimos na Receita Federal. Ativo, ele aparece no seu perfil como "Empresa ativa".</div>' +
          '</div>' +
          '<div class="cred-ed-campo"><label class="cred-ed-lbl" for="credAtua">Trabalha na área desde</label>' +
            '<select class="field-input ds-input" id="credAtua">' + anos.join('') + '</select></div>' +
          '<div class="cred-ed-campo"><label class="cred-ed-lbl" for="credGarantia">Garantia dos serviços</label>' +
            '<input class="field-input ds-input" id="credGarantia" type="text" maxlength="60" list="credGarantiaSug" placeholder="Ex.: 90 dias" value="' + esc(p.garantia || '') + '"/>' +
            '<datalist id="credGarantiaSug"><option value="30 dias"><option value="90 dias"><option value="6 meses"><option value="1 ano"></datalist></div>' +
          '<div class="cred-ed-campo"><span class="cred-ed-lbl">Formas de pagamento</span><div class="cred-ed-chips">' +
            PAGAMENTOS.map(function (pg) {
              return '<label class="cred-chip"><input type="checkbox" value="' + pg[0] + '"' + (pags.indexOf(pg[0]) > -1 ? ' checked' : '') + '/> ' + pg[1] + '</label>';
            }).join('') + '</div></div>' +
          '<label class="cred-chip cred-chip--linha"><input type="checkbox" id="credUrgencia"' + (p.atende_urgencia ? ' checked' : '') + '/> Atendo urgência (fora do horário comercial)</label>' +
          '<div class="cred-ed-campo"><label class="cred-ed-lbl" for="credRegistros">Registros e certificações</label>' +
            '<input class="field-input ds-input" id="credRegistros" type="text" maxlength="200" placeholder="Ex.: NR-10, NR-35, CREA-SP 123456" value="' + esc(p.registros || '') + '"/>' +
            '<div class="cred-ed-dica">Aparece como "informado pelo profissional".</div></div>' +
        '</div>';
      desenharCnpj(p);
    }

    function desenharCnpj(p) {
      var box = document.getElementById('credCnpjBox');
      if (!box) return;
      if (p.cnpj && p.cnpj_situacao === 'ATIVA') {
        box.innerHTML = '<div class="cred-cnpj-ok"><span>✓ <strong>' + esc(fmtCnpj(p.cnpj)) + '</strong>' +
          (p.empresa_nome ? '<br><span class="cred-txt">' + esc(p.empresa_nome) + ' · ativa na Receita</span>' : '') + '</span>' +
          '<button type="button" class="cred-link" id="credCnpjRemover">Remover</button></div>';
        document.getElementById('credCnpjRemover').onclick = function () {
          if (!window.confirm('Tirar o CNPJ do seu perfil?')) return;
          this.disabled = true;
          chamar({ remover: true }).then(function () { desenharCnpj({}); })
            .catch(function (e) { FIELDO.UI.toast(msgErro(e)); });
        };
        return;
      }
      box.innerHTML = '<div class="cred-cnpj-linha"><input class="field-input ds-input" id="credCnpj" type="text" inputmode="numeric" maxlength="18" placeholder="00.000.000/0000-00" autocomplete="off"/>' +
        '<button type="button" class="btn btn--ghost ds-btn" id="credCnpjBtn">Conferir</button></div><div class="cred-erro" id="credCnpjErro"></div>';
      var inp = document.getElementById('credCnpj'), btn = document.getElementById('credCnpjBtn'), err = document.getElementById('credCnpjErro');
      inp.addEventListener('input', function () {
        var d = this.value.replace(/\D/g, '').slice(0, 14);
        this.value = d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
        err.textContent = '';
      });
      btn.onclick = function () {
        var c = inp.value.replace(/\D/g, '');
        if (!cnpjValido(c)) { err.textContent = 'Este CNPJ não é válido. Confira os números.'; return; }
        btn.disabled = true; btn.textContent = 'Conferindo…'; err.textContent = '';
        chamar({ cnpj: c }).then(function (j) { desenharCnpj(j); FIELDO.UI.toast('CNPJ conferido: empresa ativa.'); })
          .catch(function (e) { btn.disabled = false; btn.textContent = 'Conferir'; err.textContent = msgErro(e); });
      };
    }

    /* Lê os campos declarados para juntar ao salvamento do perfil */
    function ler(el) {
      if (!el || !document.getElementById('credAtua')) return {};
      var pags = Array.prototype.map.call(el.querySelectorAll('.cred-ed-chips input:checked'), function (i) { return i.value; });
      var atua = Number(document.getElementById('credAtua').value) || null;
      return {
        atua_desde: atua,
        garantia: (document.getElementById('credGarantia').value || '').trim().slice(0, 60) || null,
        formas_pagamento: pags.length ? pags : null,
        atende_urgencia: !!document.getElementById('credUrgencia').checked,
        registros: (document.getElementById('credRegistros').value || '').trim().slice(0, 200) || null,
      };
    }

    return { PAGAMENTOS: PAGAMENTOS, fmtCnpj: fmtCnpj, cnpjValido: cnpjValido, itens: itens, html: html,
             pagamentosTexto: pagamentosTexto, editor: editor, ler: ler, verificar: function (c) { return chamar({ cnpj: c }); } };
  })();

  var Niches = (function () {
    var MAX_CUSTOM = 12;

    var DEFAULTS = [
      { key: 'eletrica',        label: 'Elétrica',    emoji: '⚡',  _default: true },
      { key: 'hidraulica',      label: 'Hidráulica',  emoji: '🔧', _default: true },
      { key: 'pintura',         label: 'Pintura',     emoji: '🎨', _default: true },
      { key: 'ar-condicionado', label: 'Ar-cond.',    emoji: '❄️', _default: true },
      { key: 'alvenaria',       label: 'Alvenaria',   emoji: '🧱', _default: true },
      { key: 'informatica',     label: 'Informática', emoji: '💻', _default: true },
      { key: 'serralheria',     label: 'Serralheria', emoji: '🔩', _default: true },
      /* v10.1 · corretor de imóveis. O produto JÁ funcionava pra eles —
         o slug do perfil vem do texto livre de `profissao`, então
         "corretor-de-imoveis-caraguatatuba-xxxx" sempre foi possível.
         O que faltava era a CATEGORIA: sem ela o corretor caía em
         "Outro" e sumia do filtro do Explorar, logo agora que a
         divulgação vai atrás desse público. */
      { key: 'imoveis',         label: 'Imóveis',     emoji: '🏢', _default: true },
      { key: 'outro',           label: 'Outro',       emoji: '⚙️', _default: true },
    ];

    function _readCustom() {
      var raw = LS.get('niches_custom');
      return Array.isArray(raw) ? raw : [];
    }
    function _writeCustom(list) { LS.set('niches_custom', list); }

    function _slug(label) {
      return String(label || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    /* Lista nichos: defaults + customizados (todos sempre visíveis pra
       não quebrar relatórios antigos; gating de criação fica no UsageGuard). */
    /* v12.9 · a lista vem de Profissoes (70, sem ícone). DEFAULTS
       continua exportado para quem lia as 8 antigas. */
    function list(opts) {
      opts = opts || {};
      var base = Profissoes.lista().map(function (p) { return { key: p.key, label: p.label, emoji: '', _default: true }; });
      if (opts.defaultsOnly) return base;
      return base.concat(_readCustom());
    }

    function find(key) {
      var all = list();
      for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i];
      if (key && !Profissoes.conhecida(key)) return { key: key, label: Profissoes.rotulo(key), emoji: '' };
      return null;
    }

    function emoji() { return ''; } /* v12.9 · sem ícones de categoria */

    function label(key) {
      var hit = find(key);
      return hit ? hit.label : (key || '');
    }

    /* v10.0 · ícone do nicho, em SVG.
       Para os 8 nichos padrão devolve o SVG do conjunto único. Para
       nicho CUSTOM (Pro) devolve o emoji que o profissional escolheu,
       dentro de um <span> — aquilo é dado dele, e trocar por um ícone
       genérico seria apagar a escolha que ele fez.

       Um chamador só, para as duas telas que mostram categoria
       (servico.html e explorar.html) não divergirem na primeira
       edição. */
    function icone() { return ''; } /* v12.9 · categorias sem ícone: o nome basta */

    /* Adiciona nicho custom. Retorna {ok, niche?, error?}.
       NOTA: gating Pro deve ser feito pelo chamador via UsageGuard. */
    function add(input) {
      var lbl = String(input && input.label || '').trim();
      if (!lbl)            return { ok: false, error: 'empty_label' };
      if (lbl.length > 22) return { ok: false, error: 'too_long' };

      var key = String(input && input.key || _slug(lbl));
      if (!key) return { ok: false, error: 'empty_label' };

      var emo = String(input && input.emoji || '🔧').slice(0, 4);

      var custom = _readCustom();
      var taken  = list().some(function (n) { return n.key === key; });
      if (taken)                       return { ok: false, error: 'duplicate' };
      if (custom.length >= MAX_CUSTOM) return { ok: false, error: 'limit' };

      var niche = { key: key, label: lbl, emoji: emo };
      custom.push(niche);
      _writeCustom(custom);
      return { ok: true, niche: niche };
    }

    function remove(key) {
      _writeCustom(_readCustom().filter(function (n) { return n.key !== key; }));
    }

    function isCustom(key) {
      return _readCustom().some(function (n) { return n.key === key; });
    }

    function reset() { LS.remove('niches_custom'); }

    return {
      DEFAULTS:   DEFAULTS,
      MAX_CUSTOM: MAX_CUSTOM,
      list:       list,
      find:       find,
      emoji:      emoji,
      icone:      icone,
      label:      label,
      add:        add,
      remove:     remove,
      isCustom:   isCustom,
      reset:      reset,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     THEMES (NOVO em v4.3) — paletas alternativas (Pro)
     ─────────────────────────────────────────────────────────────
     Aplica via attribute `data-theme="X"` no <html>.
     CSS define overrides por seletor `[data-theme="midnight"]`.

     Free → 'paper' (default)
     Pro  → todas

     Boot aplica o tema persistido ANTES do paint (auto-IIFE no
     fim do arquivo) pra evitar flash. Se o usuário perder Pro,
     o tema volta pra 'paper' silenciosamente na próxima leitura.
  ════════════════════════════════════════════════════════════ */
  var Themes = (function () {
    var THEMES = [
      { key: 'paper',    label: 'Pergaminho', swatch: '#f0ece3', proOnly: false },
      { key: 'midnight', label: 'Midnight',   swatch: '#0e0e14', proOnly: true  },
      { key: 'sage',     label: 'Sage',       swatch: '#dfe6dc', proOnly: true  },
      { key: 'ember',    label: 'Ember',      swatch: '#f4e2d0', proOnly: true  },
    ];

    function list() { return THEMES.slice(); }

    function meta(key) {
      for (var i = 0; i < THEMES.length; i++) if (THEMES[i].key === key) return THEMES[i];
      return null;
    }

    function current() {
      var v = LS.get('theme');
      return v && meta(v) ? v : 'paper';
    }

    /* Aplica visualmente (sem persistir, sem checar Pro).
       Retorna o key efetivamente aplicado. */
    function apply(key) {
      key = key || 'paper';
      if (typeof document === 'undefined') return key;
      var el = document.documentElement;
      if (key === 'paper') el.removeAttribute('data-theme');
      else                 el.setAttribute('data-theme', key);
      return key;
    }

    /* Define + persiste. Bloqueia themes proOnly se !pro.
       Retorna Promise<{ok, key?, error?}>. */
    function set(key) {
      var m = meta(key);
      if (!m) return Promise.resolve({ ok: false, error: 'unknown' });
      if (!m.proOnly) {
        LS.set('theme', key);
        apply(key);
        return Promise.resolve({ ok: true, key: key });
      }
      return Pro.check().then(function (isPro) {
        if (!isPro) return { ok: false, error: 'pro_required' };
        LS.set('theme', key);
        apply(key);
        return { ok: true, key: key };
      });
    }

    /* Boot — aplica o salvo antes do paint. Em caso de Pro perdido
       e tema proOnly salvo, volta pra paper sem aviso. */
    function boot() {
      var saved = LS.get('theme');
      if (!saved || !meta(saved)) return apply('paper');
      var m = meta(saved);
      if (!m.proOnly) return apply(saved);
      /* Aplica otimisticamente (evita flash) e revalida assíncrono. */
      apply(saved);
      Pro.check().then(function (isPro) {
        if (!isPro) { LS.remove('theme'); apply('paper'); }
      }).catch(function () {});
      return saved;
    }

    return {
      THEMES:  THEMES,
      list:    list,
      meta:    meta,
      current: current,
      apply:   apply,
      set:     set,
      boot:    boot,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     PHOTOS (NOVO em v4.3) — pipeline captura/resize/upload
     ─────────────────────────────────────────────────────────────
     Resize client-side (max 1600px lado maior, JPEG q .82) ANTES
     de qualquer upload — economiza banda e storage do Supabase.

     Uso típico em servico.html:
       FIELDO.Photos.add(file).then(function (p) {
         _fotos.push(p);     // p = { dataURL, blob, w, h, bytes }
         renderFotos();
       });

       // ao gerar relatório (com reportId já em mãos):
       FIELDO.Photos.upload(_fotos, { reportId: rep.id })
         .then(function (urls) { ... });

     add()    → resize, retorna {dataURL, blob, w, h, bytes}
     stage()  → opcional: persiste no IDB pra sobreviver fechar aba
     upload() → POST de cada blob pro storage; falha → IDB pra retry
     quota()  → { limit, plan } baseado em Pro
  ════════════════════════════════════════════════════════════ */
  var Photos = (function () {
    var MAX_DIM    = 1600;
    var JPEG_Q     = 0.82;
    var MAX_BYTES  = 8 * 1024 * 1024;
    /* v5.8.1: era 'reports' — bucket que NÃO existe. Os buckets criados
       na migração são 'avatars' e 'photos'. Todo upload retornaria 404,
       silenciosamente, porque ninguém chamava esta função. */
    var BUCKET     = 'photos';
    var FREE_LIMIT = 5;
    var PRO_LIMIT  = 20;

    function _readFile(file) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload  = function () { resolve(fr.result); };
        fr.onerror = function () { reject(fr.error || new Error('Falha ao ler arquivo')); };
        fr.readAsDataURL(file);
      });
    }

    function _loadImage(dataURL) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload  = function () { resolve(img); };
        img.onerror = function () { reject(new Error('Imagem inválida')); };
        img.src = dataURL;
      });
    }

    function _resize(img) {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      var scale = Math.min(1, MAX_DIM / Math.max(w, h));
      var tw = Math.round(w * scale);
      var th = Math.round(h * scale);
      var canvas = document.createElement('canvas');
      canvas.width  = tw;
      canvas.height = th;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, tw, th);
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) return reject(new Error('Resize falhou'));
          var reader = new FileReader();
          reader.onload  = function () {
            resolve({
              _localId: LocalDB._uuid(),
              dataURL:  reader.result,
              blob:     blob,
              w:        tw,
              h:        th,
              bytes:    blob.size,
            });
          };
          reader.onerror = function () { reject(reader.error); };
          reader.readAsDataURL(blob);
        }, 'image/jpeg', JPEG_Q);
      });
    }

    /* Pipeline completo: file → resized photo object */
    function add(file) {
      if (!file) return Promise.reject(new Error('Arquivo vazio'));
      if (!/^image\//.test(file.type || '')) return Promise.reject(new Error('Apenas imagens'));
      if (file.size > MAX_BYTES) return Promise.reject(new Error('Imagem maior que 8MB'));
      return _readFile(file).then(_loadImage).then(_resize);
    }

    /* Quanto pode subir? */
    function quota() {
      return Pro.check().then(function (isPro) {
        return {
          limit:    isPro ? PRO_LIMIT : FREE_LIMIT,
          plan:     isPro ? 'pro' : 'free',
          isPro:    isPro,
        };
      });
    }

    /* Path: {profId}/{reportId}/{idx}.jpg dentro do bucket */
    function _uploadOne(blob, profId, reportId, idx) {
      var path = profId + '/' + reportId + '/' + idx + '.jpg';
      return Session.getAccessToken().then(function (token) {
      return fetch(STORAGE_URL + '/' + BUCKET + '/' + path, {
        method:  'PUT',
        headers: {
          'apikey':        ANON_KEY,
          'Authorization': 'Bearer ' + (token || ANON_KEY),
          'Content-Type':  'image/jpeg',
          'x-upsert':      'true',
        },
        body: blob,
      }).then(function (r) {
        if (!r.ok) throw new Error('upload_failed_' + r.status);
        return SUPABASE_URL + '/storage/v1/object/public/' + BUCKET + '/' + path;
      });
      });
    }

    /* Sobe array de fotos. Retorna [url|null, ...] (null = pendente).
       Falhas são persistidas no IDB pra retry posterior pelo SyncEngine
       (até a v4.3 a engine só retoma rows tabelares — fotos ficam staged
       até a próxima sessão online quando o usuário re-tentar). */
    function upload(photos, opts) {
      opts = opts || {};
      var profId   = Auth.getId();
      var reportId = opts.reportId || 'temp';
      if (!profId) return Promise.reject(new Error('Não autenticado'));
      if (!photos || !photos.length) return Promise.resolve([]);

      var jobs = photos.map(function (p, i) {
        if (!p || !p.blob) return Promise.resolve(null);
        return _uploadOne(p.blob, profId, reportId, i)
          .then(function (url) {
            /* Sucesso — limpa do staging se estiver lá */
            if (LocalDB.isSupported() && p._localId) {
              LocalDB['delete']('photos', p._localId).catch(function () {});
            }
            return url;
          })
          .catch(function () {
            /* Stage pra retry posterior */
            if (LocalDB.isSupported() && p._localId) {
              LocalDB.put('photos', {
                _localId:  p._localId,
                reportId:  reportId,
                index:     i,
                dataURL:   p.dataURL,
              }).catch(function () {});
            }
            return null;
          });
      });
      return Promise.all(jobs);
    }

    /* Persiste fotos no IDB SEM tentar upload. Usado pelo Draft pra
       sobreviver a fechar a aba antes de gerar o relatório. */
    function stage(photos, reportLocalId) {
      if (!LocalDB.isSupported() || !photos) return Promise.resolve([]);
      var jobs = photos.map(function (p, i) {
        return LocalDB.put('photos', {
          _localId:      p._localId || LocalDB._uuid(),
          reportLocalId: reportLocalId,
          index:         i,
          dataURL:       p.dataURL,
        }).catch(function () { return null; });
      });
      return Promise.all(jobs);
    }

    return {
      MAX_DIM:    MAX_DIM,
      FREE_LIMIT: FREE_LIMIT,
      PRO_LIMIT:  PRO_LIMIT,
      add:        add,
      upload:     upload,
      stage:      stage,
      quota:      quota,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     UPGRADE UI (NOVO em v4.3) — modal de upgrade reutilizável
     ─────────────────────────────────────────────────────────────
     UpgradeUI.show({ reason, action, onClose })

       reason  → 'quota_exceeded' | 'pro_required' | 'expired'
       action  → 'create_report' | 'access_contratos' | 'use_themes'
                 | 'use_custom_niches' | 'photos_above_5' | 'generic'

     Renderiza overlay full-screen com hero, 3 features-chave do Pro,
     CTA primário (ativar.html) e CTA secundário (WhatsApp).

     Estilos são injetados sob demanda (uma vez) — não polui fieldo.css.
  ════════════════════════════════════════════════════════════ */
  var UpgradeUI = (function () {
    /* v7.0: número real do responsável pelo produto. Era um placeholder
       (5511999999999) — quem batesse no limite abriria uma conversa com
       um número inexistente e simplesmente desistiria. */
    var WPP = '5512988406425';

    var REASONS = {
      pro_required: {
        title: 'Recurso <em>Pro</em>',
        sub:   'Esse recurso faz parte do plano Pro do Fieldo.',
      },
      quota_exceeded: {
        title: 'Limite do plano <em>atingido</em>',
        sub:   'Você usou tudo do mês no plano grátis. Faça upgrade pra continuar.',
      },
      expired: {
        title: 'Sua licença <em>expirou</em>',
        sub:   'Renove para voltar a usar os recursos Pro.',
      },
      generic: {
        title: 'Desbloquear <em>Fieldo Pro</em>',
        sub:   'Mais relatórios, contratos, temas e nichos personalizados.',
      },
    };

    var ACTION_FEATURES = {
      create_report: [
        'Relatórios ilimitados (sem limite mensal)',
        'Até 20 fotos por relatório (vs 5)',
        'Contratos, diárias e empreitadas',
      ],
      access_contratos: [
        'Empreiteiros e empreitadas ilimitados',
        'Diárias, empreitadas e extras por obra',
        'Cálculo automático de saldo em tempo real',
      ],
      /* v8.6: o convite mudou de tom junto com o muro. Antes ele aparecia
         pra quem NUNCA viu a tela — argumento no vazio. Agora aparece pra
         quem já usou com uma obra e quer a segunda: dá pra falar do que
         ela já conhece em vez de prometer o desconhecido. */
      create_empreiteiro: [
        'Empreiteiros ilimitados (o grátis inclui 1)',
        'Várias obras por empreiteiro',
        'Saldo a pagar consolidado por pessoa',
      ],
      create_empreitada: [
        'Obras ilimitadas (o grátis inclui 1)',
        'Diárias, extras e adiantamentos por obra',
        'Cálculo automático de saldo em tempo real',
      ],
      use_themes: [
        'Temas alternativos (Midnight, Sage, Ember)',
        'Nichos personalizados (até 12)',
        'Identidade visual sob medida',
      ],
      use_custom_niches: [
        'Adicione até 12 nichos personalizados',
        'Emojis customizados por categoria',
        'Sem limite mensal de relatórios',
      ],
      photos_above_5: [
        'Até 20 fotos por relatório (vs 5)',
        'Relatórios ilimitados',
        'Resize automático e backup',
      ],
      generic: [
        'Relatórios ilimitados',
        'Módulo Contratos completo',
        'Temas e nichos personalizados',
      ],
    };

    function _styles() {
      return ''+
'.fd-upg-ov{position:fixed;inset:0;z-index:900;background:rgba(14,14,20,.78);'+
  'backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);'+
  'display:flex;align-items:flex-end;justify-content:center;padding:0;animation:fdUpgIn .25s ease}'+
'@media(min-width:560px){.fd-upg-ov{align-items:center;padding:1.25rem}}'+
'@keyframes fdUpgIn{from{opacity:0}to{opacity:1}}'+
'@keyframes fdUpgUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}'+
'.fd-upg-box{background:var(--paper);border:1px solid var(--border2);'+
  'border-radius:18px 18px 0 0;width:100%;max-width:460px;max-height:92dvh;overflow-y:auto;'+
  'animation:fdUpgUp .3s var(--ez);position:relative}'+
'@media(min-width:560px){.fd-upg-box{border-radius:18px}}'+
'.fd-upg-close{position:absolute;top:.65rem;right:.85rem;width:32px;height:32px;'+
  'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);border-radius:50%;'+
  'display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;'+
  'font-size:1.05rem;line-height:1;z-index:2;transition:background .2s;font-family:inherit}'+
'.fd-upg-close:hover{background:rgba(255,255,255,.14)}'+
'.fd-upg-hero{background:var(--ink);color:#fff;padding:2rem 1.75rem 1.5rem;'+
  'position:relative;overflow:hidden;border-radius:18px 18px 0 0}'+
'.fd-upg-hero::before{content:"";position:absolute;inset:0;'+
  'background:radial-gradient(ellipse at 100% 0%,rgba(196,154,48,.32) 0%,transparent 60%),'+
  'radial-gradient(ellipse at 0% 100%,rgba(154,114,24,.2) 0%,transparent 50%);pointer-events:none}'+
'.fd-upg-eye{position:relative;font-family:var(--mono);font-size:.6rem;letter-spacing:.22em;'+
  'text-transform:uppercase;color:var(--gold-l);display:flex;align-items:center;gap:.55rem;margin-bottom:.85rem}'+
'.fd-upg-eye::before{content:"";width:14px;height:1px;background:var(--gold-l)}'+
'.fd-upg-title{position:relative;font-family:var(--serif);font-size:clamp(1.5rem,5vw,1.9rem);'+
  'font-weight:300;line-height:1.15;color:rgba(255,255,255,.95);letter-spacing:-.02em;margin-bottom:.45rem}'+
'.fd-upg-title em{font-style:italic;color:var(--gold-l)}'+
'.fd-upg-sub{position:relative;font-size:.85rem;color:rgba(255,255,255,.7);line-height:1.6}'+
'.fd-upg-body{padding:1.25rem 1.75rem 1.5rem}'+
'.fd-upg-feats{list-style:none;padding:0;margin:0 0 1.25rem;display:flex;flex-direction:column;gap:.55rem}'+
'.fd-upg-feats li{font-size:.84rem;color:var(--text);display:flex;align-items:flex-start;gap:.55rem;line-height:1.5}'+
'.fd-upg-feats li::before{content:"✓";color:var(--gold);font-weight:600;flex-shrink:0;margin-top:.05rem}'+
'.fd-upg-cta{display:flex;flex-direction:column;gap:.5rem}'+
'.fd-upg-cta a,.fd-upg-cta button{display:flex;align-items:center;justify-content:center;gap:.5rem;'+
  'padding:.85rem 1rem;border-radius:12px;font-size:.9rem;font-weight:500;text-decoration:none;cursor:pointer;'+
  'border:none;font-family:inherit;transition:background .2s}'+
'.fd-upg-primary{background:var(--gold);color:#fff}.fd-upg-primary:hover{background:var(--gold-d)}'+
'.fd-upg-wa{background:#1d7a46;color:#fff}.fd-upg-wa:hover{background:#17663a}'+
'.fd-upg-ghost{background:transparent;border:1px solid var(--border2);color:var(--muted);font-size:.78rem}'+
'.fd-upg-ghost:hover{color:var(--text)}'+
'';
    }

    function _injectStylesOnce() {
      if (document.getElementById('fd-upg-style')) return;
      var s = document.createElement('style');
      s.id = 'fd-upg-style';
      s.textContent = _styles();
      document.head.appendChild(s);
    }

    function _waUrl() {
      var prof = _profData || {};
      var nm = prof.name ? ' (' + prof.name + ')' : '';
      /* Mensagem diz o CONTEXTO: quem atende precisa saber por que a
         pessoa chegou ali, e ela precisa saber que veio ao lugar certo. */
      var motivo = _ultimoMotivo === 'quota_exceeded'
        ? ' Atingi o limite de relatórios do plano gratuito.'
        : '';
      var msg = 'Olá! Sou usuário do Fieldo' + nm + '.' + motivo +
                ' Quero ativar o plano Pro.';
      return 'https://wa.me/' + WPP + '?text=' + encodeURIComponent(msg);
    }

    var _ultimoMotivo = null;

    function show(opts) {
      opts = opts || {};
      _ultimoMotivo = opts.reason || null;
      if (typeof document === 'undefined') return;
      _injectStylesOnce();

      var reasonKey = REASONS[opts.reason] ? opts.reason : 'generic';
      var actionKey = ACTION_FEATURES[opts.action] ? opts.action : 'generic';
      var meta  = REASONS[reasonKey];
      var feats = ACTION_FEATURES[actionKey];

      var ov = document.createElement('div');
      ov.className = 'fd-upg-ov';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.setAttribute('aria-labelledby', 'fdUpgTitle');

      var box = document.createElement('div');
      box.className = 'fd-upg-box';
      box.addEventListener('click', function (e) { e.stopPropagation(); });

      box.innerHTML =
        '<button class="fd-upg-close" aria-label="Fechar">✕</button>' +
        '<div class="fd-upg-hero">' +
          '<div class="fd-upg-eye">Fieldo · Pro</div>' +
          '<h2 class="fd-upg-title" id="fdUpgTitle">' + meta.title + '</h2>' +
          '<p class="fd-upg-sub">' + UI.esc(meta.sub) + '</p>' +
        '</div>' +
        '<div class="fd-upg-body">' +
          '<ul class="fd-upg-feats">' +
            feats.map(function (f) { return '<li>' + UI.esc(f) + '</li>'; }).join('') +
          '</ul>' +
          '<div class="fd-upg-cta">' +
            '<a href="/ativar.html" class="fd-upg-primary">Ativar Pro →</a>' +
            '<a href="' + _waUrl() + '" target="_blank" rel="noopener" class="fd-upg-wa">' +
              'Falar com a equipe Fieldo' +
            '</a>' +
            '<button type="button" class="fd-upg-ghost" data-fd-upg-dismiss>Agora não</button>' +
          '</div>' +
        '</div>';

      ov.appendChild(box);

      function close() {
        ov.remove();
        document.removeEventListener('keydown', onKey);
        document.body.style.overflow = '';
        if (typeof opts.onClose === 'function') opts.onClose();
      }
      function onKey(e) { if (e.key === 'Escape') close(); }

      box.querySelector('.fd-upg-close').addEventListener('click', close);
      box.querySelector('[data-fd-upg-dismiss]').addEventListener('click', close);
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
      document.body.appendChild(ov);
    }

    return { show: show };
  })();

  /* ════════════════════════════════════════════════════════════
     USAGE GUARD (NOVO em v4.3) — entitlement+quota multi-camada
     ─────────────────────────────────────────────────────────────
     Single source of truth pra "pode fazer X agora?".
     Combina Auth + Pro entitlement + plan quota + feature flag.

       guard(action, ctx)        → Promise<{allowed, reason, message, ...}>
       enforce(action, opts)     → guard + abre UpgradeUI se !allowed
       attach(el, action, opts)  → wrap rápido pra <a>/<button>

     Actions reconhecidas:
       'create_report'      → Reports.canCreate (free 5/mês)
       'create_budget'      → sempre permitido hoje (futuro: 10/mês free)
       'access_contratos'   → SEMPRE permitido desde a v8.6 (a tela abre
                              pra todo mundo; a cota está na criação)
       'create_empreiteiro' → free 1
       'create_empreitada'  → free 1
       'use_themes'         → ctx.theme === 'paper' OK; outros Pro
       'use_custom_niches'  → Pro
       'photos_above_5'     → ctx.count <= 5 OK; >5 Pro

     Ações desconhecidas → allowed=true (fail open por design,
     pra permitir adicionar features sem quebrar guards existentes).
  ════════════════════════════════════════════════════════════ */
  var UsageGuard = (function () {
    function _r(allowed, reason, message, extra) {
      var base = {
        allowed: !!allowed,
        reason:  reason || (allowed ? 'ok' : 'unknown'),
        message: message || '',
      };
      if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) base[k] = extra[k];
      return base;
    }

    function guard(action, ctx) {
      ctx = ctx || {};
      if (!Auth.isLoggedIn()) {
        return Promise.resolve(_r(false, 'auth_required', 'Faça login para continuar.'));
      }

      switch (action) {
        case 'create_report':
          return Reports.canCreate().then(function (q) {
            if (q.allowed) return _r(true, 'ok', null, { quota: q });
            return _r(false, 'quota_exceeded',
              'Limite mensal atingido (' + q.used + '/' + q.limit + ').',
              { quota: q });
          }).catch(function () {
            /* sem internet — RLS protege; libera otimisticamente */
            return _r(true, 'offline_optimistic');
          });

        /* v8.6: ABRIR a tela de contratos não é mais Pro. O muro saiu da
           porta e foi pro que realmente custa: criar o SEGUNDO empreiteiro
           e a SEGUNDA obra. Antes, o item sumia do menu e o clique batia
           num modal — resultado: ninguém descobria que o módulo existia,
           e ele tinha 1 empreiteiro cadastrado no banco inteiro.
           A action continua existindo (outros pontos a chamam) e agora
           responde sempre allowed — de propósito, não por engano. */
        case 'access_contratos':
          return Promise.resolve(_r(true, 'aberto_a_todos'));

        case 'create_empreiteiro':
          return Contratos.canCreateEmpreiteiro().then(function (q) {
            if (q.allowed) return _r(true, 'ok', null, { quota: q });
            return _r(false, 'quota_exceeded',
              'O plano grátis inclui ' + q.limit + ' empreiteiro' + (q.limit > 1 ? 's' : '') + '.',
              { quota: q });
          }).catch(function () { return _r(true, 'offline_optimistic'); });

        case 'create_empreitada':
          return Contratos.canCreateEmpreitada().then(function (q) {
            if (q.allowed) return _r(true, 'ok', null, { quota: q });
            return _r(false, 'quota_exceeded',
              'O plano grátis inclui ' + q.limit + ' obra' + (q.limit > 1 ? 's' : '') + '.',
              { quota: q });
          }).catch(function () { return _r(true, 'offline_optimistic'); });

        case 'use_custom_niches':
          return Pro.check().then(function (isPro) {
            return isPro
              ? _r(true)
              : _r(false, 'pro_required', 'Esse recurso é exclusivo do plano Pro.');
          });

        case 'use_themes':
          if (!ctx.theme || ctx.theme === 'paper') return Promise.resolve(_r(true));
          return Pro.check().then(function (isPro) {
            return isPro
              ? _r(true)
              : _r(false, 'pro_required', 'Temas alternativos requerem o plano Pro.');
          });

        case 'photos_above_5':
          if ((ctx.count || 0) <= 5) return Promise.resolve(_r(true));
          return Pro.check().then(function (isPro) {
            return isPro
              ? _r(true)
              : _r(false, 'pro_required', 'Mais de 5 fotos por relatório requer Pro.');
          });

        case 'create_budget':
          return Promise.resolve(_r(true));

        default:
          return Promise.resolve(_r(true, 'unknown_action'));
      }
    }

    /* Verifica + abre UpgradeUI quando bloqueado.
       Retorna Promise<bool> (true = pode prosseguir). */
    function enforce(action, opts) {
      opts = opts || {};
      return guard(action, opts.ctx).then(function (r) {
        if (r.allowed) return true;
        if (r.reason === 'auth_required') {
          window.location.href = '/entrar.html';
          return false;
        }
        var reasonKey = ({
          quota_exceeded: 'quota_exceeded',
          pro_required:   'pro_required',
        })[r.reason] || 'generic';
        UpgradeUI.show({
          reason:  reasonKey,
          action:  action,
          onClose: opts.onClose,
        });
        return false;
      });
    }

    /* Intercepta click de <a>/<button>. Se passar, segue navegação. */
    function attach(el, action, opts) {
      if (!el) return;
      el.addEventListener('click', function (e) {
        e.preventDefault();
        enforce(action, opts).then(function (ok) {
          if (ok && el.getAttribute('href')) {
            window.location.href = el.getAttribute('href');
          }
        });
      });
    }

    return { guard: guard, enforce: enforce, attach: attach };
  })();

  /* ══ ASSINATURA (v8.1) ══════════════════════════════════════

     Recorrência pelo Asaas. Convive com License (token) de propósito:
     o token continua servindo revenda.html e cortesia — matar um canal
     de venda para simplificar código seria trocar receita por elegância.

     Divisão de responsabilidade, que é o que mantém isto seguro:
       - criar()  só CRIA a cobrança. Nunca libera plano.
       - o webhook do Asaas é o único que escreve professionals.plan.
     Se criar() liberasse, bastava criar e não pagar.

     Aqui não há cache: plano é dinheiro, e mostrar "Pro" para quem
     deixou de pagar é pior que uma requisição a mais. */
  var Assinatura = {

    /* Estado atual, direto do servidor. Devolve null se não há
       assinatura — quem só usa token cai neste caso e continua Pro
       normalmente pelo professionals.plan. */
    status: function () {
      if (!Auth.getId()) return Promise.resolve(null);
      return _req('POST', '/rpc/minha_assinatura', {})
        .then(function (rows) { return (rows && rows[0]) || null; })
        .catch(function () { return null; });
    },

    /* plano: 'mensal' | 'anual'. O VALOR não vai daqui — quem define
       preço é a Edge Function. Mandar valor do cliente seria deixar o
       cliente escolher quanto paga.

       cpfCnpj: exigido pelo Asaas para emitir a cobrança. Passa direto,
       NÃO é gravado em professionals — não existe coluna para ele, de
       propósito. Guardar documento de cliente é responsabilidade (LGPD,
       vazamento, retenção) sem benefício nosso: quem precisa dele por
       lei é o Asaas, e é lá que ele fica. */
    criar: function (plano, cpfCnpj) {
      return Session.getAccessToken().then(function (jwt) {
        if (!jwt) return { ok: false, error: 'unauthenticated' };
        return fetch(EDGE_URL + '/assinatura', {
          method: 'POST',
          headers: {
            'apikey':        ANON_KEY,
            'Authorization': 'Bearer ' + jwt,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            plano:    String(plano || 'mensal'),
            cpf_cnpj: String(cpfCnpj || '').replace(/\D/g, ''),
          }),
        })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (res) {
            if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'falhou' };
            return res;
          });
      }).catch(function () {
        return { ok: false, error: 'network' };
      });
    },

    /* v10.9 · Patch 3 de supabase/PATCHES-asaas.md.
       /planos promete "Cancela quando quiser, sem multa" — até esta
       função existir, não havia nenhum jeito de cumprir a promessa.

       Cancela a recorrência no Asaas. NÃO revoga o Pro na hora: o plano
       continua valendo até plan_expires_at, que esta chamada não toca —
       é exatamente o que a página promete, e quem revoga na hora
       continua sendo só o asaas-webhook, num chargeback/estorno real. */
    cancelar: function () {
      return Session.getAccessToken().then(function (jwt) {
        if (!jwt) return { ok: false, error: 'unauthenticated' };
        return fetch(EDGE_URL + '/assinatura-cancelar', {
          method: 'POST',
          headers: {
            'apikey':        ANON_KEY,
            'Authorization': 'Bearer ' + jwt,
            'Content-Type':  'application/json',
          },
        })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (res) {
            if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'falhou' };
            return res;
          });
      }).catch(function () {
        return { ok: false, error: 'network' };
      });
    },

    /* Rótulo pronto para a tela. Fica aqui, e não em cada página, porque
       três telas já mostram estado de plano e divergir entre elas é como
       nasceu o esc() diferente de orcamento.html. */
    rotulo: function (a) {
      if (!a) return { texto: 'Plano gratuito', tom: 'neutro' };
      if (a.status === 'ativa')    return { texto: 'Pro ativo', tom: 'ok' };
      if (a.status === 'atrasada') return { texto: 'Pagamento atrasado', tom: 'alerta' };
      if (a.status === 'pendente') return { texto: 'Aguardando pagamento', tom: 'alerta' };
      if (a.plano === 'pro')       return { texto: 'Pro ativo', tom: 'ok' };
      return { texto: 'Plano gratuito', tom: 'neutro' };
    },
  };

  /* ══ MATERIAIS (v8.3) ═══════════════════════════════════════

     Cotação de material. Duas metades, de propósito:

     - CATÁLOGO: compartilhado, curado, ~76 linhas. Cabe inteiro no
       localStorage (~20 KB) e é buscado no cliente. Isso não é
       otimização: o lugar de uso é o balcão da loja e a obra, os dois
       piores sinais que existem. Busca que depende de rede ali não
       funciona.

       Fica em localStorage e NÃO no IndexedDB de propósito: o LocalDB
       tem DB_VERSION fixo, e subir versão para acrescentar uma store é
       migração — o tipo de mexida que a auditoria mostrou dar errado
       (bugs #9, #10, #11 no SyncEngine).

     - LISTA: documento jsonb, uma linha. Salvar é UM update, o mesmo
       caminho que budgets já percorre. Ver DECISAO-materiais.md. */
  var Materiais = (function () {

    var CACHE_KEY = 'materiais_catalogo';
    var CACHE_TTL = 7 * 24 * 3600 * 1000;   /* catálogo muda devagar */
    var _mem = null;

    /* Sem acento e sem caixa: quem digita na obra escreve "plafom",
       "bracadeira", "lampada". A busca tem que achar assim. */
    function _norm(s) {
      return String(s || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().trim();
    }

    function catalogo(force) {
      if (_mem && !force) return Promise.resolve(_mem);

      var cache = LS.get(CACHE_KEY);
      if (!force && cache && cache.em && (Date.now() - cache.em) < CACHE_TTL
          && cache.itens && cache.itens.length) {
        _mem = cache.itens;
        return Promise.resolve(_mem);
      }

      return _getPublic('/materiais?aprovada=is.true&order=categoria,ordem,nome')
        .then(function (rows) {
          _mem = rows || [];
          /* Índice de busca montado UMA vez, não a cada tecla. */
          _mem.forEach(function (m) {
            m._busca = _norm([m.nome, m.nome_curto, m.categoria,
                              (m.sinonimos || []).join(' ')].join(' '));
          });
          LS.set(CACHE_KEY, { em: Date.now(), itens: _mem });
          return _mem;
        })
        .catch(function (e) {
          /* Falhou a rede: usa o cache velho, mesmo vencido. Catálogo
             desatualizado é melhor que tela vazia no balcão da loja. */
          if (cache && cache.itens && cache.itens.length) {
            _mem = cache.itens;
            return _mem;
          }
          throw e;
        });
    }

    function buscar(termo, limite) {
      return catalogo().then(function (todos) {
        var q = _norm(termo);
        if (!q) return todos.slice(0, limite || 40);
        var termos = q.split(/\s+/);
        return todos.filter(function (m) {
          var alvo = m._busca || _norm(m.nome);
          for (var i = 0; i < termos.length; i++) {
            if (alvo.indexOf(termos[i]) === -1) return false;
          }
          return true;
        }).slice(0, limite || 40);
      });
    }

    /* ── LISTAS ───────────────────────────────────────────── */
    var COLS = 'id,titulo,local,status,observacoes,itens,budget_id,' +
               'estimada_em,created_at,updated_at';

    var Listas = {

      list: function (limite) {
        var id = Auth.getId();
        if (!id) return Promise.resolve([]);
        return _get('/material_listas?professional_id=eq.' + id +
                    '&select=' + COLS + '&order=updated_at.desc&limit=' + (limite || 50));
      },

      get: function (listaId) {
        return _get('/material_listas?id=eq.' + encodeURIComponent(listaId) +
                    '&select=' + COLS + '&limit=1')
          .then(function (r) { return (r && r[0]) || null; });
      },

      create: function (dados) {
        return Session.ensure().then(function (s) {
          return _post('/material_listas', {
            professional_id: s.user_id,
            titulo:          dados.titulo,
            local:           dados.local || null,
            itens:           dados.itens || [],
          });
        }).then(function (r) { return Array.isArray(r) ? r[0] : r; });
      },

      /* Salva a lista INTEIRA. É um update só — por isso a lista é
         jsonb. Quem chama deve debounce: 80 itens ≈ 16 KB por gravação,
         e ninguém precisa disso a cada tecla. */
      salvar: function (listaId, campos) {
        return _patch('/material_listas?id=eq.' + encodeURIComponent(listaId), campos)
          .then(function (r) { return Array.isArray(r) ? r[0] : r; });
      },

      excluir: function (listaId) {
        return _del('/material_listas?id=eq.' + encodeURIComponent(listaId));
      },
    };

    /* ── EXPORTAÇÃO ───────────────────────────────────────────
       O profissional monta por AMBIENTE; a loja busca por PRODUTO.
       Esta função é a tradução — e é o que hoje é trabalho manual dos
       dois lados. Some quantidades do mesmo item em ambientes
       diferentes e devolve na ordem do catálogo. */
    function agruparPorProduto(itens, catalogoIdx) {
      var mapa = {};
      (itens || []).forEach(function (it) {
        var chave = it.material_id || ('livre:' + _norm(it.nome_livre));
        if (!chave || chave === 'livre:') return;
        if (!mapa[chave]) {
          var m = it.material_id && catalogoIdx ? catalogoIdx[it.material_id] : null;
          mapa[chave] = {
            material_id: it.material_id || null,
            nome:        m ? m.nome : (it.nome_livre || 'Item'),
            unidade:     m ? m.unidade : (it.unidade || 'un'),
            categoria:   m ? m.categoria : 'zz-outros',
            quantidade:  0,
            ambientes:   [],
          };
        }
        mapa[chave].quantidade += Number(it.quantidade) || 0;
        var amb = (it.ambiente || '').trim();
        if (amb && mapa[chave].ambientes.indexOf(amb) === -1) {
          mapa[chave].ambientes.push(amb);
        }
      });

      return Object.keys(mapa).map(function (k) { return mapa[k]; })
        .sort(function (a, b) {
          if (a.categoria !== b.categoria) return a.categoria < b.categoria ? -1 : 1;
          return a.nome < b.nome ? -1 : 1;
        });
    }

    /* Texto pronto para o WhatsApp da loja. Sem markdown: WhatsApp não
       renderiza, e o que sobra é ruído — foi assim que um link virou
       "/](https://..." no analytics. */
    function textoCotacao(lista, itens, catalogoIdx) {
      var linhas = ['*Lista de material*'];
      if (lista && lista.titulo) linhas.push(lista.titulo);
      if (lista && lista.local)  linhas.push(lista.local);
      linhas.push('');

      var grupos = agruparPorProduto(itens, catalogoIdx);
      grupos.forEach(function (g) {
        var qtd = (g.quantidade % 1 === 0) ? String(g.quantidade)
                                           : String(g.quantidade).replace('.', ',');
        linhas.push('• ' + qtd + ' ' + g.unidade + ' — ' + g.nome);
      });

      if (lista && lista.observacoes) {
        linhas.push('', 'Obs: ' + lista.observacoes);
      }
      linhas.push('', 'Pode me passar o preço de cada item?');
      return linhas.join('\n');
    }

    return {
      catalogo: catalogo,
      buscar: buscar,
      Listas: Listas,
      agruparPorProduto: agruparPorProduto,
      textoCotacao: textoCotacao,
      _norm: _norm,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     GUIA — balões de primeira vez  (v9.10)

     O dono pediu: "balões de guia que aparecem uma vez para guiar e
     ajudar a entender o app".

     TRÊS REGRAS QUE EU IMPUS, e o motivo de cada uma:

     1. UM BALÃO EXPLICA PAYOFF, NÃO MECÂNICA. "Este botão registra um
        serviço" é legenda de botão — se o botão precisa disso, o botão
        está mal escrito. O balão só se justifica se disser o que a
        pessoa GANHA, que é o que o botão não cabe dizer.

     2. NO MÁXIMO UM POR TELA, E POUCOS NO TOTAL. Três seguidos viram
        aquele carrossel de boas-vindas que todo mundo fecha no
        automático — e aí some junto o único que importava.

     3. SE O ALVO NÃO EXISTE, NÃO MARCA COMO VISTO. Senão o balão
        "queima" numa tela onde o elemento ainda não carregou, e a
        pessoa nunca vê. Esse é o jeito silencioso de um sistema de
        onboarding não funcionar e ninguém perceber.

     Honestidade sobre o alcance: balão não cria motivo. O único
     usuário externo (Genis) parou em zero serviços, e nenhum balão
     resolve "eu não tenho um trabalho pronto pra registrar agora".
     Isto ajuda quem TEM o serviço e não entendeu o caminho.
  ════════════════════════════════════════════════════════════ */
  var Guia = (function () {
    var KEY = 'guia_vistos';
    var _fila = [], _ativo = null, _els = {};

    function _vistos() { return LS.get(KEY) || {}; }
    function _marcar(id) { var v = _vistos(); v[id] = Date.now(); LS.set(KEY, v); }

    function jaViu(id) { return !!_vistos()[id]; }

    function _css() {
      if (document.getElementById('fieldo-guia-css')) return;
      var s = document.createElement('style');
      s.id = 'fieldo-guia-css';
      s.textContent =
        '.fg-backdrop{position:fixed;inset:0;background:rgba(14,14,20,.55);z-index:9998;' +
          'opacity:0;transition:opacity .2s}' +
        '.fg-backdrop.on{opacity:1}' +
        '.fg-holo{position:absolute;border-radius:12px;box-shadow:0 0 0 9999px rgba(14,14,20,.55),' +
          '0 0 0 3px var(--gold,#9a7218);transition:.2s;pointer-events:none}' +
        '.fg-balao{position:fixed;z-index:9999;max-width:min(320px,calc(100vw - 32px));' +
          'background:var(--paper,#f5f2ec);border:1px solid var(--border2,rgba(14,14,20,.16));' +
          'border-radius:14px;padding:1rem 1.1rem;box-shadow:0 12px 40px rgba(14,14,20,.28);' +
          'opacity:0;transform:translateY(6px);transition:.22s}' +
        '.fg-balao.on{opacity:1;transform:none}' +
        '.fg-t{font-family:var(--serif,Georgia),serif;font-size:1.02rem;color:var(--ink,#0e0e14);' +
          'margin-bottom:.35rem;line-height:1.25}' +
        '.fg-t em{font-style:italic;color:var(--gold,#9a7218)}' +
        '.fg-x{font-size:.83rem;color:var(--text2,#4a4855);line-height:1.55}' +
        '.fg-b{display:flex;justify-content:flex-end;gap:.5rem;margin-top:.9rem}' +
        '.fg-ok{font-family:inherit;font-size:.8rem;font-weight:500;padding:.5rem .95rem;' +
          'border-radius:9px;border:none;background:var(--gold,#9a7218);color:#fff;cursor:pointer}' +
        /* SUSSURRO: sem fundo escuro, sem botão, some sozinho. Não
           interrompe — é um bilhete, não um pedágio. */
        '.fg-sus{position:fixed;z-index:9997;max-width:min(300px,calc(100vw - 28px));' +
          'background:var(--ink,#0e0e14);color:rgba(255,255,255,.88);' +
          'border-left:2px solid var(--gold,#9a7218);border-radius:10px;' +
          'padding:.7rem .85rem;font-size:.8rem;line-height:1.5;cursor:pointer;' +
          'box-shadow:0 8px 28px rgba(14,14,20,.3);' +
          'opacity:0;transform:translateY(8px);transition:opacity .5s ease,transform .5s ease}' +
        '.fg-sus.on{opacity:1;transform:none}';
      document.head.appendChild(s);
    }

    function _fechar() {
      if (!_ativo) return;
      var el = _ativo;
      _ativo = null;
      /* Usa as REFERÊNCIAS guardadas na criação, não getElementById.
         Eu tinha escrito buscando de volta pelo id — indireção
         desnecessária, já que acabei de criar os elementos. E era
         frágil: qualquer coisa que mexesse no id (ou um segundo balão
         em corrida) deixava o antigo preso na tela pra sempre. */
      function _tira(el) {
        if (!el) return;
        el.classList.remove('on');
        setTimeout(function () {
          if (el.remove) el.remove();
          else if (el.parentNode) el.parentNode.removeChild(el);
        }, 220);
      }
      _tira(_els.balao); _tira(_els.fundo);
      _els = {};
      _marcar(el.id);
      setTimeout(_proximo, 260);
    }

    function _proximo() {
      if (_ativo || !_fila.length) return;
      var g = _fila.shift();
      var alvo = typeof g.alvo === 'string' ? document.getElementById(g.alvo) : g.alvo;
      /* Regra 3: alvo ausente NÃO queima o balão — devolve pra fila
         de outra sessão em vez de marcar como visto. */
      if (!alvo || !alvo.getBoundingClientRect) return _proximo();

      var r = alvo.getBoundingClientRect();
      if (!r.width && !r.height) return _proximo();   /* invisível */

      _ativo = g;
      _css();

      var fundo = document.createElement('div');
      fundo.className = 'fg-backdrop';
      fundo.id = 'fieldo-guia-fundo';
      var holo = document.createElement('div');
      holo.className = 'fg-holo';
      holo.style.left   = (r.left + window.scrollX - 6) + 'px';
      holo.style.top    = (r.top + window.scrollY - 6) + 'px';
      holo.style.width  = (r.width + 12) + 'px';
      holo.style.height = (r.height + 12) + 'px';
      fundo.appendChild(holo);
      fundo.addEventListener('click', _fechar);
      document.body.appendChild(fundo);
      _els.fundo = fundo;

      var balao = document.createElement('div');
      balao.className = 'fg-balao';
      balao.id = 'fieldo-guia-balao';
      balao.setAttribute('role', 'dialog');
      balao.innerHTML =
        '<div class="fg-t">' + (g.titulo || '') + '</div>' +
        '<div class="fg-x">' + (g.texto || '') + '</div>' +
        '<div class="fg-b"><button type="button" class="fg-ok">' +
          (g.botao || 'Entendi') + '</button></div>';
      document.body.appendChild(balao);
      _els.balao = balao;

      /* Abaixo do alvo se couber; senão acima. Em tela de celular o
         alvo costuma estar no topo, então "abaixo" é o caso comum. */
      var bh = balao.offsetHeight || 150;
      var abaixo = r.bottom + 14;
      var cabe = (abaixo + bh) < (window.innerHeight - 12);
      balao.style.top  = (cabe ? abaixo : Math.max(12, r.top - bh - 14)) + 'px';
      balao.style.left = Math.max(12,
        Math.min(r.left, (window.innerWidth || 360) - (balao.offsetWidth || 300) - 12)) + 'px';

      balao.querySelector('.fg-ok').addEventListener('click', _fechar);
      setTimeout(function () { fundo.classList.add('on'); balao.classList.add('on'); }, 10);
    }

    /* ── SUSSURRO ────────────────────────────────────────────────
       Variante deliberadamente diferente do balão: sem fundo escuro,
       sem botão, some sozinho depois de alguns segundos.

       Por que uma variante e não o mesmo componente com uma flag: as
       duas coisas têm CONTRATOS opostos. O balão interrompe e exige um
       toque — é para o que a pessoa precisa entender agora. O sussurro
       é um bilhete que ela pode ignorar sem custo. Misturar os dois num
       componente só acaba com o balão perdendo o "Entendi" ou o
       sussurro ganhando fundo preto.

       NUNCA aparece junto com um balão. Se há algo mais importante na
       fila ou na tela, o sussurro desiste desta sessão — sem marcar
       como visto, então volta na próxima. */
    function _sussurrar(g) {
      if (_ativo || _fila.length) return;          /* algo mais importante manda */
      var alvo = typeof g.alvo === 'string' ? document.getElementById(g.alvo) : g.alvo;
      if (!alvo || !alvo.getBoundingClientRect) return;
      var r = alvo.getBoundingClientRect();
      if (!r.width && !r.height) return;

      _css();
      var s = document.createElement('div');
      s.className = 'fg-sus';
      s.id = 'fieldo-guia-sussurro';
      s.setAttribute('role', 'status');
      s.innerHTML = g.texto || '';
      document.body.appendChild(s);

      var h = s.offsetHeight || 70;
      var abaixo = r.bottom + 10;
      s.style.top  = ((abaixo + h) < (window.innerHeight - 10)
                        ? abaixo : Math.max(10, r.top - h - 10)) + 'px';
      s.style.left = Math.max(14,
        Math.min(r.left, (window.innerWidth || 360) - (s.offsetWidth || 280) - 14)) + 'px';

      var fim = null;
      function sumir() {
        if (!s) return;
        clearTimeout(fim);
        s.classList.remove('on');
        var alvoEl = s; s = null;
        setTimeout(function () {
          if (alvoEl.remove) alvoEl.remove();
          else if (alvoEl.parentNode) alvoEl.parentNode.removeChild(alvoEl);
        }, 520);
      }
      s.addEventListener('click', sumir);
      setTimeout(function () { if (s) s.classList.add('on'); }, 10);
      /* 8 segundos: dá pra ler ~20 palavras sem pressa no celular, e é
         curto o bastante pra não virar parte da tela. */
      fim = setTimeout(sumir, (g.segundos || 8) * 1000);

      /* Marca como visto porque ele APARECEU. A regra 3 protege o caso
         de não aparecer — e todos os retornos acima saem antes daqui. */
      _marcar(g.id);
    }

    return {
      /* Um bilhete discreto: sem fundo, sem botão, some sozinho. */
      sussurrar: function (g) {
        if (typeof document === 'undefined' || !g || !g.id) return;
        if (jaViu(g.id)) return;
        setTimeout(function () { _sussurrar(g); }, g.atraso || 1200);
      },

      /* Enfileira um balão. Não mostra de novo se já foi visto. */
      mostrar: function (g) {
        if (typeof document === 'undefined' || !g || !g.id) return;
        if (jaViu(g.id)) return;
        if (_fila.some(function (x) { return x.id === g.id; })) return;
        _fila.push(g);
        /* Espera o layout assentar: em tela montada por innerHTML o
           alvo pode não ter medida no mesmo tick. */
        setTimeout(_proximo, 400);
      },
      jaViu:   jaViu,
      fechar:  _fechar,
      /* Para testar de novo sem limpar o app inteiro. */
      resetar: function (id) {
        if (!id) return LS.remove(KEY);
        var v = _vistos(); delete v[id]; LS.set(KEY, v);
      },
    };
  })();

  /* ════════════════════════════════════════════════════════════
     MCP — chaves de conexão para agentes de IA (Claude e outros)
     Fase 3 do plano em MCP-fieldo-auditoria.md. Só isto: gerar,
     listar e revogar uma chave. A chave em texto puro só existe no
     instante em que generateKey() resolve — depois disso o banco só
     guarda o hash (ver supabase/migrations/2026-09-09_mcp_api_keys.sql),
     então não existe "recuperar chave perdida", só gerar outra.

     Sem local-first de propósito: isto é configuração de conta, não
     dado de trabalho de campo — não faz sentido funcionar offline nem
     guardar rascunho. Segue o mesmo padrão de Professionals.update:
     manda pro servidor, espera confirmar.

     mcp_api_keys tem RLS (professional_id = auth.uid()) — _get/_del
     aqui só listam/apagam as chaves de quem está logado, nunca de
     outra pessoa, mesmo que o id seja adivinhado. */
  var Mcp = {
    /* Devolve { id, name, raw_key, created_at }. raw_key só vem
       preenchido NESTA resposta — mostre pro profissional imediatamente
       e avise que não vai aparecer de novo. */
    generateKey: function (name) {
      return _rpc('mcp_generate_key', { p_name: (name || 'Chave MCP').trim() || 'Chave MCP' })
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    /* Nunca inclui key_hash nem raw_key — só o que dá pra reconhecer
       qual chave é qual (nome, quando foi criada, quando foi usada
       pela última vez). */
    listKeys: function () {
      return _get('/mcp_api_keys?select=id,name,created_at,last_used_at,revoked_at&order=created_at.desc');
    },

    /* Revogar = apagar a linha (a própria migration documenta essa
       decisão). Sem soft-delete: uma chave revogada não precisa
       continuar ocupando espaço nem aparecendo em nenhuma lista. */
    revokeKey: function (id) {
      return _del('/mcp_api_keys?id=eq.' + encodeURIComponent(id));
    },
  };


  /* ═══════════════════════════════════════════════════
     ACEITE — v12.36 (LGPD)
     Registra no banco que a conta aceitou Termos e Política, em qual
     versão e quando. O banco guarda também o navegador e o IP que
     fizeram o pedido (função registrar_aceite). Se a rede cair no meio,
     o pedido fica guardado neste aparelho e é reenviado na próxima
     página com sessão. Aceite nunca pode se perder em silêncio.
  ═══════════════════════════════════════════════════ */
  var Aceite = (function () {
    var PEND = 'aceites_pendentes';
    function _ua() { try { return String(navigator.userAgent || '').slice(0, 300); } catch (e) { return null; } }
    function _um(d) {
      return _rpc('registrar_aceite', {
        p_documento:  d.documento,
        p_versao:     d.versao,
        p_aceito:     d.aceito !== false,
        p_origem:     d.origem || null,
        p_user_agent: _ua(),
      });
    }
    function _chave(vt, vp) { return 'aceite_ok_' + vt + '_' + vp; }
    function marcarLocal(vt, vp) { LS.set(_chave(vt, vp), 1); }
    function jaLocal(vt, vp) { return LS.get(_chave(vt, vp)) === 1; }
    function registrar(docs) {
      var lista = (docs || []).slice();
      /* Quem acabou de aceitar não deve ver o aviso de aceite no painel
         enquanto o envio ainda corre (ou fica pendente para reenvio). */
      var vt = null, vp = null;
      lista.forEach(function (d) {
        if (d.documento === 'termos' && d.aceito !== false) vt = d.versao;
        if (d.documento === 'privacidade' && d.aceito !== false) vp = d.versao;
      });
      if (vt && vp) marcarLocal(vt, vp);
      return Promise.all(lista.map(_um)).then(function () { return true; })
        .catch(function (err) {
          console.error('[aceite] não registrado agora, fica pendente:', err);
          var atuais = LS.get(PEND) || [];
          LS.set(PEND, atuais.concat(lista));
          return false;
        });
    }
    function reenviarPendentes() {
      var pend = LS.get(PEND);
      if (!pend || !pend.length) return Promise.resolve(true);
      return Promise.all(pend.map(_um)).then(function () { LS.remove(PEND); return true; })
        .catch(function () { return false; });
    }
    return { registrar: registrar, reenviarPendentes: reenviarPendentes, marcarLocal: marcarLocal, jaLocal: jaLocal };
  })();

  /* ═══════════════════════════════════════════════════
     TITULAR — v12.36 (LGPD, art. 18)
     meusDados(): tudo o que a conta tem, num JSON só (função meus_dados
     no banco, que tira tokens e hashes de acesso antes de devolver).
     pedir(): registra um pedido de correção, exclusão etc. com prazo
     de resposta de 15 dias, e devolve o número do pedido.
  ═══════════════════════════════════════════════════ */
  var Titular = {
    meusDados: function () { return _rpc('meus_dados', {}, { timeout: 30000 }); },
    pedir: function (tipo, contato, detalhe) {
      return _rpc('registrar_pedido_titular', {
        p_tipo: tipo, p_contato: contato || null, p_detalhe: detalhe || null,
      });
    },
  };

  /* ═══════════════════════════════════════════════════
     ACESSO — v12.36 (Marco Civil da Internet, art. 15)
     Registro de acesso à aplicação (conta, data e hora, IP), guardado
     por 6 meses. No máximo um registro por hora por aparelho.
  ═══════════════════════════════════════════════════ */
  var Acesso = {
    registrar: function () {
      try {
        var ult = LS.get('acesso_registrado_em');
        if (ult && (Date.now() - ult) < 3600000) return Promise.resolve(false);
        return _rpc('registrar_acesso', {}).then(function () {
          LS.set('acesso_registrado_em', Date.now());
          return true;
        }).catch(function () { return false; });
      } catch (e) { return Promise.resolve(false); }
    },
  };

  /* ── EXPOSIÇÃO GLOBAL ────────────────────────────────────── */
  return {
    config: {
      SUPABASE_URL: SUPABASE_URL,
      REST_URL:     REST_URL,
      STORAGE_URL:  STORAGE_URL,
      EDGE_URL:     EDGE_URL,
      ANON_KEY:     ANON_KEY,
      HEADERS:      HEADERS,
      PLAN_LIMITS:  PLAN_LIMITS,
    },
    Auth:          Auth,
    AuthEmail:     AuthEmail,
    Mcp:           Mcp,
    License:       License,
    Assinatura:    Assinatura,
    Materiais:     Materiais,
    Validator:     Validator,
    Pix:           Pix,
    publicUrl:     publicUrl,
    perfilUrl:     perfilUrl,
    publicUrlConfigurado: publicUrlConfigurado,
    colunasPublicas: _comSelect,
    /* v12.26 · para os fetch() crus de perfil.html e relatorio.html */
    semTituloPublico: _semTituloPublico,

    /* v9.15 · _fetchComTimeout existe desde a v5.8.2, escrito pro
       sintoma "editar perfil fica rodando". As páginas PÚBLICAS —
       perfil.html e avaliar.html — montam o próprio fetch() cru e
       nunca souberam dele: num servidor que não responde, ficavam com
       os skeletons na tela pra sempre.

       São justamente as duas páginas que o cliente abre. Exportado
       aqui pra que exista UMA implementação de timeout no projeto, e
       não três. */
    fetchComTimeout: _fetchComTimeout,
    Origem:        Origem,     /* v9.4 */
    Analytics:     Analytics,  /* v10.23 */
    Consentimento: Consentimento, /* v12.36 */
    Aceite:        Aceite,        /* v12.36 */
    Titular:       Titular,       /* v12.36 */
    Acesso:        Acesso,        /* v12.36 */
    Guia:          Guia,       /* v9.10 */

    /* ── v7.0 · superfície para módulos externos ───────────────────

       `db.locacao.js` precisa falar com o PostgREST. Sem isto ele
       reimplementaria `_req` — e junto viriam, mal copiados, o timeout
       de 25s, a troca de JWT por anon key em página pública, a
       normalização de `err.status` e a injeção de `select=`. Quatro
       comportamentos que já custaram patch (v5.8.2, v6.5, v6.7) e que
       divergiriam em silêncio na primeira correção feita só de um lado.

       Exportar aqui é uma decisão, não um vazamento: é uma lista curta
       e escolhida. A alternativa que eu havia recomendado — quebrar o
       db.js em db.core + db.servicos + db.locacao — foi descartada
       depois de ler o arquivo: são 3.770 linhas dentro de UMA closure
       com estado privado compartilhado. Separar exigiria expor TODOS os
       internos (encapsulamento pior que este) ou uma cirurgia mecânica
       sem nenhum teste cobrindo as costuras. O ganho real da
       modularização é o código NOVO nascer em arquivo próprio, e isso
       se obtém aqui, com dez linhas.

       `get` usa o JWT do dono. `getPublic` força a anon key e injeta o
       select — é o que página pública deve usar. Trocar um pelo outro
       vaza o JWT do dono numa página aberta. */
    rest: {
      get:       _get,
      getPublic: _getPublic,
      post:      _post,
      postPublic: _postPublic,
      patch:     _patch,
      del:       _del,
      rpc:       _rpc,
    },
    Pagamento:     Pagamento,
    PWA:           PWA,
    RateLimit:     RateLimit,
    LocalDB:       LocalDB,
    Draft:         Draft,
    SyncEngine:    SyncEngine,
    Pro:           Pro,
    Professionals: Professionals,
    Reports:       Reports,
    Obras:         Obras,
    Avaliacoes:    Avaliacoes,
    Hashes:        Hashes,
    Budgets:       Budgets,
    Contratos:     Contratos,
    Marketplace:   Marketplace,
    /* ── v4.3 ──────────────────────────────── */
    /* v10.0 · A VERSÃO, VISÍVEL.
       O app mostrava "v1" e "v1.0 · 2026" — strings fixas. Não havia
       como olhar o site publicado e saber se você estava vendo a v9.4
       ou a v10.0, nem depois de limpar cache. Um deploy que não subiu,
       ou um service worker preso numa versão velha, ficavam invisíveis.
       Agora sai do MESMO lugar em toda tela. */
    VERSAO:        'v10.0',
    Icones:        Icones,
    Perfil:        Perfil,
    NavInf:        NavInf,
    Niches:        Niches,
    Profissoes:    Profissoes,
    OutrasProfissoes: OutrasProfissoes,
    Regiao: Regiao, /* v12.28 */
    Credenciais:   Credenciais,
    Themes:        Themes,
    Photos:        Photos,
    UpgradeUI:     UpgradeUI,
    UsageGuard:    UsageGuard,
    /* ──────────────────────────────────────── */
    UI:            UI,
    HBG:           HBG,
    Nav:           Nav,

    toast: UI.toast,
  };

})();

var HBG = FIELDO.HBG;

/* ════════════════════════════════════════════════════════════
   AUTO-REVEAL DE ELEMENTOS PRO
   Quando há elementos [data-pro="1"] na página, esconde por
   default (já vem com style display:none). Após Pro.check(),
   revela se o usuário tiver entitlement.
   Para botões (qa-btn) que devem mudar de comportamento se NÃO
   for Pro: o helper troca href para 'ativar.html' e adiciona
   um pequeno ícone de cadeado, mas mantém o item visível.
════════════════════════════════════════════════════════════ */
(function () {
  if (typeof document === 'undefined') return;

  function applyProState() {
    var els = document.querySelectorAll('[data-pro="1"]');
    if (!els.length) return;

    /* Se não estiver logado, mantém escondido (default) */
    if (!FIELDO.Auth.isLoggedIn()) return;

    FIELDO.Pro.check().then(function (isPro) {
      els.forEach(function (el) {
        /* Itens de menu lateral: mostra se Pro, esconde se não */
        if (el.classList.contains('menu-nav-item')) {
          el.style.display = isPro ? '' : 'none';
          return;
        }
        /* Botões de ação rápida (qa-btn): sempre visíveis.
           v4.3: em vez de redirecionar bruto pra ativar.html, intercepta
           o click e abre UpgradeUI (modal). Mantém label "Pro" no botão. */
        /* v8.6: o botão de Contratos deixou de ser interceptado.
           Antes o clique abria o modal de upgrade em vez de ir pra tela —
           o usuário grátis nunca via o módulo, só a oferta de comprá-lo.
           Vender uma tela que a pessoa nunca viu é pedir fé, não valor.
           Agora o link funciona: ela entra, usa com 1 obra, e o convite
           aparece quando ela quiser a segunda. */
        if (el.classList.contains('qa-btn')) {
          el.style.display = '';
          return;
        }
        /* Genérico: revela se Pro */
        el.style.display = isPro ? '' : 'none';
      });
    }).catch(function () {
      /* Em caso de erro, mantém escondido (lado seguro) */
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyProState);
  } else {
    applyProState();
  }
})();

/* ════════════════════════════════════════════════════════════
   AUTO-START SYNC ENGINE (v4.2)
   Inicia a fila de sincronização em background. Páginas que
   chamarem create() em modo offline terão dados no IndexedDB,
   e essa engine envia para o Supabase quando voltar a rede.
════════════════════════════════════════════════════════════ */
(function () {
  if (typeof document === 'undefined') return;

  function injectIndicator() {
    if (document.getElementById('fieldo-sync-indicator')) return;
    var el = document.createElement('div');
    el.id = 'fieldo-sync-indicator';
    /* v12.8 · era bottom/right: ficava em cima do botão principal de
       quase toda tela — "Continuar" do Novo Serviço, "Gerar orçamento",
       o enviar do Fiel, o "+" do Suporte. Agora mora no alto, centrado,
       logo abaixo da barra do topo, onde não há botão nenhum. */
    el.style.cssText = [
      'position:fixed', 'top:calc(env(safe-area-inset-top, 0px) + 58px)', 'left:50%',
      'transform:translateX(-50%)',
      'background:rgba(20,20,28,.92)', 'color:#fff',
      'font-family:var(--sans, system-ui, sans-serif)', 'font-size:.72rem', 'font-weight:500',
      'padding:.35rem .8rem', 'border-radius:2rem', 'white-space:nowrap',
      'box-shadow:0 4px 16px rgba(0,0,0,.18)',
      'z-index:1000', 'opacity:0', 'pointer-events:none',
      'transition:opacity .25s'
    ].join(';');
    document.body.appendChild(el);
    return el;
  }

  function updateIndicator(text, visible, clicavel) {
    var el = document.getElementById('fieldo-sync-indicator') || injectIndicator();
    if (!el) return;
    el.textContent = text;
    el.style.opacity = visible ? '1' : '0';
    el.style.cursor  = clicavel ? 'pointer' : 'default';
    el.style.pointerEvents = clicavel ? 'auto' : 'none';

    if (clicavel && !el._diagBound) {
      el._diagBound = true;
      el.addEventListener('click', mostrarFalhas);
    }
  }

  /* v6.6: diagnóstico das falhas de envio.
     Mostra o que travou, com resumo do registro, e deixa escolher entre
     tentar de novo e descartar. Descartar pede confirmação nomeando o
     que se perde — "1 item" não diz nada a quem está em obra. */
  function mostrarFalhas() {
    FIELDO.SyncEngine.errors().then(function (lista) {
      if (!lista.length) {
        updateIndicator('', false);
        return;
      }
      var desc = lista.map(function (e, i) {
        return (i + 1) + '. ' + (e.resumo ? e.resumo + ' — ' : '') +
               e.tabela + ' (' + e.motivo + ')';
      }).join('\n');

      var msg = 'Não foi possível enviar:\n\n' + desc +
        '\n\nTentar enviar de novo?\n\n' +
        'OK = tentar de novo\nCancelar = ver opção de descartar';

      if (window.confirm(msg)) {
        FIELDO.SyncEngine.retryErrors().then(function (n) {
          updateIndicator('↻ Reenviando ' + n, true);
          return FIELDO.SyncEngine.flush();
        });
        return;
      }

      if (window.confirm('Descartar definitivamente?\n\n' + desc +
          '\n\nEsses dados serão perdidos e não podem ser recuperados.')) {
        FIELDO.SyncEngine.discardErrors().then(function () {
          updateIndicator('', false);
        });
      }
    });
  }

  /* v12.8 · "✓ Sincronizado" só aparece quando havia algo para enviar.
     Antes piscava em TODA abertura de página, mesmo sem nada pendente —
     um aviso que não avisa nada, em cima dos botões. */
  var _haviaPendencia = false;

  function startSync() {
    if (!FIELDO.LocalDB.isSupported()) return;
    if (!FIELDO.Auth.isLoggedIn()) return;

    FIELDO.SyncEngine.on(function (event, data) {
      if (event === 'start') {
        FIELDO.SyncEngine.status().then(function (s) {
          if (s.pending > 0) { _haviaPendencia = true; updateIndicator('↻ Enviando ' + s.pending + (s.pending > 1 ? ' itens' : ' item'), true); }
        });
      } else if (event === 'end') {
        FIELDO.SyncEngine.status().then(function (s) {
          if (s.pending > 0) {
            _haviaPendencia = true;
            updateIndicator('⏱ ' + s.pending + ' pendente' + (s.pending>1?'s':''), true);
          } else if (s.errors > 0) {
            /* v6.6: clicável. Antes era um aviso permanente sem ação —
               o usuário não sabia o que falhou nem como resolver. */
            updateIndicator('⚠ ' + s.errors + ' falha' + (s.errors>1?'s':'') + ' no envio · toque', true, true);
          } else if (_haviaPendencia) {
            _haviaPendencia = false;
            updateIndicator('✓ Tudo enviado', true);
            setTimeout(function () { updateIndicator('', false); }, 2000);
          } else {
            updateIndicator('', false);
          }
        });
      } else if (event === 'offline') {
        updateIndicator('◌ Offline', true);
      }
    });

    FIELDO.SyncEngine.start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startSync);
  } else {
    startSync();
  }
})();


/* ════════════════════════════════════════════════════════════
   AUTO-BOOT THEMES (v4.3)
   Aplica o tema persistido ANTES do paint pra evitar flash.
   Roda inline (não espera DOMContentLoaded) — assume que
   <script src="db.js"> está no <head> ou no fim do <body>.
   Se o usuário perdeu o Pro, o tema volta pra 'paper'
   silenciosamente após Pro.check resolver.
════════════════════════════════════════════════════════════ */
(function () {
  if (typeof document === 'undefined') return;
  try { FIELDO.Themes.boot(); } catch (e) { /* fail open */ }
})();


/* ════════════════════════════════════════════════════════════
   AUTO-BOOT ORIGEM (v9.4)
   Grava o primeiro toque assim que a página abre, antes de a
   pessoa navegar e perder o `?de=` da URL. Precisa rodar em TODA
   página porque a chegada pode ser em qualquer uma.

   O catch NÃO é mudo: catch mudo aqui significaria origem sempre
   nula e a leitura diria "todo mundo veio direto" — uma conclusão
   errada e confiante, que é pior que não ter o dado.
════════════════════════════════════════════════════════════ */
(function () {
  if (typeof window === 'undefined') return;
  try { FIELDO.Origem.capturar(); }
  catch (e) { console.error('[Fieldo] falha ao capturar origem:', e); }

  /* v10.23 · page_view automático — de graça em toda página carregada,
     sem precisar tocar em cada uma das páginas do site. Roda DEPOIS de
     Origem.capturar(): o page_view já sai com a origem certa do
     primeiro toque, em vez de "direto" por causa da ordem de execução.
     Erros de client_error/unhandledrejection também ficam ligados aqui,
     por página, com teto de 5 — ver Analytics._hookErros. */
  try {
    FIELDO.Analytics._hookErros();
    FIELDO.Analytics._autoPageView();
  } catch (e) { console.error('[Fieldo] falha ao registrar page_view:', e); }

  /* v12.36 · se a pessoa aceitar a medição no banner DEPOIS de a página
     abrir, o page_view desta página sai nessa hora (uma vez só). Sem
     aceite, _autoPageView acima não enviou nada. */
  var _jaContou = FIELDO.Consentimento.analytics();
  window.addEventListener('fieldo:consentimento', function (ev) {
    var ok = ev && ev.detail && ev.detail.analytics === true;
    if (!ok || _jaContou) return;
    _jaContou = true;
    try { FIELDO.Origem.persistir(); FIELDO.Analytics._autoPageView(); } catch (e) {}
  });

  /* v12.36 · com sessão: reenvia aceite pendente e registra o acesso */
  try {
    if (FIELDO.Auth && FIELDO.Auth.isLoggedIn && FIELDO.Auth.isLoggedIn()) {
      FIELDO.Aceite.reenviarPendentes();
      FIELDO.Acesso.registrar();
    }
  } catch (e) { /* nunca atrapalha a página */ }
})();
