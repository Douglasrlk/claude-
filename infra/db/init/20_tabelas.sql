-- Fieldo · baseline extraída do catálogo de produção (projeto jrsctnncoljdcvdofxsg, PG 17)
-- Gerado em 2026-11-21. NÃO editar à mão: regenerar a partir do banco.
-- Parte: tabelas

CREATE TABLE gestao.companies (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  type text DEFAULT 'condominio'::text NOT NULL,
  doc text,
  doc_digits text GENERATED ALWAYS AS (regexp_replace(COALESCE(doc, ''::text), '[^0-9]'::text, ''::text, 'g'::text)) STORED,
  city text,
  uf text,
  phone text,
  email text,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE gestao.company_users (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text DEFAULT 'member'::text NOT NULL,
  full_name text,
  is_active boolean DEFAULT true NOT NULL,
  invited_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.aceites (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  documento text NOT NULL,
  versao text NOT NULL,
  aceito boolean DEFAULT true NOT NULL,
  origem text,
  ip text,
  user_agent text,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.admin_auditoria (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  quando timestamp with time zone DEFAULT now() NOT NULL,
  acao text NOT NULL,
  alvo uuid NOT NULL,
  tabela text,
  antes jsonb,
  depois jsonb
);

CREATE TABLE public.analytics_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  event_name text NOT NULL,
  anonymous_id text,
  session_id text,
  user_id uuid,
  pathname text,
  referrer text,
  origem text,
  device text,
  props jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.asaas_eventos (
  event_id text NOT NULL,
  event_type text,
  recebido_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.assinaturas (
  professional_id uuid NOT NULL,
  asaas_customer_id text NOT NULL,
  asaas_subscription_id text,
  status text DEFAULT 'pendente'::text NOT NULL,
  ciclo text DEFAULT 'MONTHLY'::text NOT NULL,
  valor numeric(10,2) NOT NULL,
  proxima_cobranca date,
  invoice_url text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  ambiente text
);

CREATE TABLE public.assistant_usage (
  professional_id uuid NOT NULL,
  month_start date DEFAULT (date_trunc('month'::text, now()))::date NOT NULL,
  message_count integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.assistant_usage_locadora (
  locadora_id uuid NOT NULL,
  month_start date DEFAULT (date_trunc('month'::text, now()))::date NOT NULL,
  message_count integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.avaliacoes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  professional_id uuid NOT NULL,
  report_id uuid NOT NULL,
  nota smallint NOT NULL,
  comentario text,
  nome_avaliador text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  resposta text,
  respondido_em timestamp with time zone,
  nome_avaliador_curto text
);

CREATE TABLE public.budget_counters (
  professional_id uuid NOT NULL,
  ano smallint NOT NULL,
  ultimo integer DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.budgets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  professional_id uuid NOT NULL,
  number text,
  titulo text,
  client_name text NOT NULL,
  client_phone text,
  local text,
  descricao text,
  items jsonb DEFAULT '[]'::jsonb NOT NULL,
  subtotal numeric(12,2) DEFAULT 0 NOT NULL,
  desconto numeric(12,2) DEFAULT 0 NOT NULL,
  total numeric(12,2) DEFAULT 0 NOT NULL,
  prazo text,
  validade text,
  pagamento text,
  garantia text,
  observacoes text,
  emissao date,
  status text DEFAULT 'pendente'::text NOT NULL,
  linked_report_id uuid,
  is_public boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  approval_token text DEFAULT encode(gen_random_bytes(12), 'hex'::text) NOT NULL,
  approved_at timestamp with time zone,
  approval_note text,
  client_signature text,
  arquivado_em timestamp with time zone,
  mcp_idempotency_key text,
  origem text
);

CREATE TABLE public.change_file_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  change_id text NOT NULL,
  file_path text NOT NULL,
  storage_path_before text,
  storage_path_after text,
  bytes_before integer,
  bytes_after integer,
  hash_before text,
  hash_after text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.change_requests (
  change_id text NOT NULL, -- DEFAULT next_change_id() aplicado em 41_defaults_tardios.sql
  opened_at timestamp with time zone DEFAULT now() NOT NULL,
  reason text NOT NULL,
  author text DEFAULT 'Engineering Agent (Claude)'::text NOT NULL,
  files text[] DEFAULT '{}'::text[] NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  approved_by text,
  approved_at timestamp with time zone,
  deploy_id text,
  post_deploy_status text,
  post_deploy_checked_at timestamp with time zone
);

CREATE TABLE public.change_tests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  change_id text NOT NULL,
  run_at timestamp with time zone DEFAULT now() NOT NULL,
  environment text DEFAULT 'isolado-local'::text NOT NULL,
  checks jsonb,
  result text NOT NULL,
  reasons text[] DEFAULT '{}'::text[] NOT NULL
);

CREATE TABLE public.condo_condominios (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sindico_id uuid NOT NULL,
  nome text NOT NULL,
  endereco text,
  city text,
  city_slug text,
  num_unidades integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.condo_manutencoes_recorrentes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  condominio_id uuid NOT NULL,
  tipo text NOT NULL,
  ultima_execucao date,
  proxima_execucao date NOT NULL,
  frequencia_meses integer NOT NULL,
  observacoes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.condo_servicos_contratados (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  condominio_id uuid NOT NULL,
  report_id uuid,
  manutencao_id uuid,
  descricao text,
  valor numeric,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.condo_sindicos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  whatsapp text,
  email text,
  plan text DEFAULT 'free'::text NOT NULL,
  plan_expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.council_budget (
  month_start date NOT NULL,
  calls_used integer DEFAULT 0 NOT NULL,
  calls_limit integer DEFAULT 50 NOT NULL
);

CREATE TABLE public.council_opinions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  review_id uuid NOT NULL,
  specialist text NOT NULL,
  severity text NOT NULL,
  summary text NOT NULL,
  reasoning text,
  recommended_action text,
  confidence text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.council_reviews (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  incident_id uuid,
  change_id text,
  requested_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  model text NOT NULL,
  input_digest text NOT NULL,
  input_payload jsonb NOT NULL,
  raw_response text,
  status text DEFAULT 'pendente'::text NOT NULL,
  error text,
  tokens_in integer,
  tokens_out integer,
  is_escalation boolean DEFAULT false NOT NULL
);

CREATE TABLE public.document_hashes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  professional_id uuid,
  hash text NOT NULL,
  tipo text NOT NULL,
  ref_id uuid,
  conteudo_resumo jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  locadora_id uuid
);

CREATE TABLE public.empreitadas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  professional_id uuid NOT NULL,
  empreiteiro_id uuid,
  descricao text NOT NULL,
  valor_total numeric(12,2) DEFAULT 0,
  status text DEFAULT 'ativa'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.empreiteiros (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  professional_id uuid NOT NULL,
  nome text NOT NULL,
  telefone text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.equipamento_categorias (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  slug text NOT NULL,
  nome text NOT NULL,
  nome_plural text,
  emoji text,
  descricao text,
  sinonimos text[] DEFAULT '{}'::text[] NOT NULL,
  aprovada boolean DEFAULT false NOT NULL,
  ordem smallint DEFAULT 100 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.equipamentos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  locadora_id uuid NOT NULL,
  categoria_id uuid NOT NULL,
  nome text NOT NULL,
  marca text,
  modelo text,
  descricao text,
  specs jsonb DEFAULT '{}'::jsonb NOT NULL,
  fotos jsonb DEFAULT '[]'::jsonb NOT NULL,
  preco_dia numeric(10,2),
  preco_semana numeric(10,2),
  preco_mes numeric(10,2),
  caucao numeric(10,2),
  quantidade smallint DEFAULT 1 NOT NULL,
  slug text,
  ativo boolean DEFAULT true NOT NULL,
  is_public boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.funnel_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  step text NOT NULL,
  niche text,
  origem text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.impact_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  professional_id uuid NOT NULL,
  event_type text NOT NULL,
  source text DEFAULT 'organico'::text NOT NULL,
  report_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.integrity_checks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  run_id uuid NOT NULL,
  url text NOT NULL,
  checked_at timestamp with time zone DEFAULT now() NOT NULL,
  http_status integer,
  html_bytes integer,
  title text,
  meta_description text,
  h1 text,
  canonical text,
  json_ld_valid boolean,
  run_ok boolean DEFAULT true NOT NULL,
  error text,
  is_baseline boolean DEFAULT false NOT NULL,
  is_regression boolean DEFAULT false NOT NULL,
  evidence jsonb
);

CREATE TABLE public.integrity_incidents (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  check_id uuid,
  url text NOT NULL,
  opened_at timestamp with time zone DEFAULT now() NOT NULL,
  severity text DEFAULT 'regressao'::text NOT NULL,
  summary text NOT NULL,
  evidence jsonb,
  reviewed boolean DEFAULT false NOT NULL,
  reviewed_at timestamp with time zone,
  reviewed_by text
);

CREATE TABLE public.license_redemptions (
  token_hash text NOT NULL,
  professional_id uuid NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  nome_referencia text,
  redeemed_at timestamp with time zone DEFAULT now() NOT NULL,
  reactivations integer DEFAULT 0 NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  reseller_ref text
);

CREATE TABLE public.loc_contrato_assinaturas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  contrato_id uuid NOT NULL,
  locadora_id uuid NOT NULL,
  parte text NOT NULL,
  nome text NOT NULL,
  documento text NOT NULL,
  metodo text DEFAULT 'aceite_eletronico_simples'::text NOT NULL,
  aceite_versao text NOT NULL,
  aceite_texto text NOT NULL,
  documento_hash text NOT NULL,
  traco_png text,
  ip text,
  user_agent text,
  assinado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.loc_contrato_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  contrato_id uuid NOT NULL,
  locadora_id uuid NOT NULL,
  tipo text NOT NULL,
  ator text NOT NULL,
  detalhe jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.loc_contrato_modelos (
  locadora_id uuid NOT NULL,
  clausulas jsonb DEFAULT '[]'::jsonb NOT NULL,
  condicoes jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.loc_contratos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  locadora_id uuid NOT NULL,
  locacao_id uuid NOT NULL,
  grupo_id uuid NOT NULL,
  ano integer NOT NULL,
  seq integer NOT NULL,
  numero text NOT NULL,
  versao integer DEFAULT 1 NOT NULL,
  status text DEFAULT 'rascunho'::text NOT NULL,
  dados jsonb NOT NULL,
  clausulas jsonb DEFAULT '[]'::jsonb NOT NULL,
  origem_hash text,
  documento_texto text,
  documento_hash text,
  token_hash text,
  token_expira_em timestamp with time zone,
  revogado_em timestamp with time zone,
  substituido_por uuid,
  enviado_em timestamp with time zone,
  concluido_em timestamp with time zone,
  pdf_path text,
  pdf_hash text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.locacao_contratos (
  id uuid NOT NULL,
  locadora_id uuid NOT NULL,
  locacao_id uuid NOT NULL,
  ano smallint NOT NULL,
  seq integer NOT NULL,
  numero text NOT NULL,
  versao smallint NOT NULL,
  token text NOT NULL,
  conteudo text NOT NULL,
  hash text NOT NULL,
  hash_id uuid NOT NULL,
  resumo_economico jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'emitido'::text NOT NULL,
  emitido_em timestamp with time zone NOT NULL,
  aceito_em timestamp with time zone,
  aceite_nome text,
  aceite_documento text,
  aceite_ip text,
  aceite_user_agent text,
  aceite_registro text,
  aceite_hash text,
  aceite_hash_id uuid,
  cancelado_em timestamp with time zone,
  cancelamento_motivo text,
  substituido_por uuid,
  substituido_em timestamp with time zone
);

CREATE TABLE public.locacao_itens (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  locacao_id uuid NOT NULL,
  equipamento_id uuid NOT NULL,
  unidade_id uuid,
  quantidade smallint DEFAULT 1 NOT NULL,
  preco_dia_aplicado numeric(10,2),
  subtotal numeric(10,2),
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.locacao_laudos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  locacao_item_id uuid NOT NULL,
  tipo text NOT NULL,
  fotos jsonb DEFAULT '[]'::jsonb NOT NULL,
  observacoes text,
  avarias text,
  hash_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.locacoes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  locadora_id uuid NOT NULL,
  client_name text NOT NULL,
  client_phone text,
  client_email text,
  client_doc text,
  data_saida date NOT NULL,
  data_prevista_devolucao date NOT NULL,
  data_devolucao date,
  status text DEFAULT 'reservada'::text NOT NULL,
  valor_total numeric(10,2),
  caucao_valor numeric(10,2),
  caucao_status text DEFAULT 'pendente'::text NOT NULL,
  entrega_endereco text,
  observacoes text,
  is_public boolean DEFAULT false NOT NULL,
  rating smallint,
  rating_comment text,
  rating_used boolean DEFAULT false NOT NULL,
  rating_token text DEFAULT encode(gen_random_bytes(12), 'hex'::text) NOT NULL,
  consulta_token text DEFAULT encode(gen_random_bytes(12), 'hex'::text) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.locadoras (
  id uuid NOT NULL,
  nome text NOT NULL,
  razao_social text,
  cnpj text,
  slug text,
  city text,
  city_slug text,
  uf character(2),
  endereco text,
  whatsapp text,
  phone text,
  email text,
  bio text,
  logo_url text,
  instagram text,
  pix_key text,
  pix_tipo text,
  horario jsonb DEFAULT '{}'::jsonb NOT NULL,
  entrega boolean DEFAULT false NOT NULL,
  raio_entrega_km smallint,
  plan text DEFAULT 'free'::text NOT NULL,
  plan_expires_at timestamp with time zone,
  is_public boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  responsavel text
);

CREATE TABLE public.materiais (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  slug text NOT NULL,
  nome text NOT NULL,
  nome_curto text,
  categoria text NOT NULL,
  nicho text DEFAULT 'eletrica'::text NOT NULL,
  unidade text DEFAULT 'un'::text NOT NULL,
  sinonimos text[] DEFAULT '{}'::text[] NOT NULL,
  atributos jsonb DEFAULT '{}'::jsonb NOT NULL,
  preco_referencia numeric(10,2),
  preco_ref_fonte text,
  preco_ref_data date,
  aprovada boolean DEFAULT true NOT NULL,
  ordem smallint DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.material_listas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  professional_id uuid NOT NULL,
  titulo text NOT NULL,
  local text,
  budget_id uuid,
  status text DEFAULT 'rascunho'::text NOT NULL,
  observacoes text,
  itens jsonb DEFAULT '[]'::jsonb NOT NULL,
  estimada_em timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.material_precos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  professional_id uuid NOT NULL,
  material_id uuid NOT NULL,
  loja text,
  preco_unit numeric(10,2) NOT NULL,
  data date NOT NULL,
  lista_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.mcp_api_keys (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  professional_id uuid NOT NULL,
  name text DEFAULT 'Chave MCP'::text NOT NULL,
  key_hash text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone,
  rl_window_start timestamp with time zone,
  rl_count integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.mcp_oauth_rate_limit (
  professional_id uuid NOT NULL,
  rl_window_start timestamp with time zone,
  rl_count integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.midia_cotas (
  plano text NOT NULL,
  modulo text NOT NULL,
  limite_mes integer
);

CREATE TABLE public.midia_uso (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  professional_id uuid NOT NULL,
  modulo text NOT NULL,
  unidades integer NOT NULL,
  custo_centavos integer DEFAULT 0 NOT NULL,
  ref text,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.notificacoes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  professional_id uuid NOT NULL,
  tipo text NOT NULL,
  titulo text NOT NULL,
  mensagem text NOT NULL,
  link text,
  chave text NOT NULL,
  criada_em timestamp with time zone DEFAULT now() NOT NULL,
  lida_em timestamp with time zone
);

CREATE TABLE public.obra_contrato_assinaturas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  contrato_id uuid NOT NULL,
  professional_id uuid NOT NULL,
  parte text NOT NULL,
  nome text NOT NULL,
  documento text NOT NULL,
  metodo text DEFAULT 'aceite_eletronico_simples'::text NOT NULL,
  aceite_versao text NOT NULL,
  aceite_texto text NOT NULL,
  documento_hash text NOT NULL,
  traco_png text,
  ip text,
  user_agent text,
  assinado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.obra_contrato_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  contrato_id uuid NOT NULL,
  professional_id uuid NOT NULL,
  tipo text NOT NULL,
  ator text NOT NULL,
  detalhe jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.obra_contratos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  professional_id uuid NOT NULL,
  obra_id uuid NOT NULL,
  grupo_id uuid NOT NULL,
  ano integer NOT NULL,
  seq integer NOT NULL,
  numero text NOT NULL,
  versao integer DEFAULT 1 NOT NULL,
  status text DEFAULT 'rascunho'::text NOT NULL,
  dados jsonb NOT NULL,
  documento_texto text,
  documento_hash text,
  token_hash text,
  token_expira_em timestamp with time zone,
  revogado_em timestamp with time zone,
  substituido_por uuid,
  enviado_em timestamp with time zone,
  concluido_em timestamp with time zone,
  pdf_path text,
  pdf_hash text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.obras (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  professional_id uuid DEFAULT auth.uid() NOT NULL,
  cliente text NOT NULL,
  titulo text,
  cidade text,
  valor_total numeric(12,2) NOT NULL,
  status text DEFAULT 'andamento'::text NOT NULL,
  concluida_em timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.pedidos_titular (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  numero bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid,
  tipo text NOT NULL,
  contato text,
  detalhe text,
  status text DEFAULT 'aberto'::text NOT NULL,
  ip text,
  criado_em timestamp with time zone DEFAULT now() NOT NULL,
  prazo_resposta timestamp with time zone DEFAULT (now() + '15 days'::interval) NOT NULL,
  respondido_em timestamp with time zone,
  resposta text
);

CREATE TABLE public.professional_slug_antigos (
  slug text NOT NULL,
  professional_id uuid NOT NULL,
  trocado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.professionals (
  id uuid NOT NULL,
  name text,
  profissao text,
  specialty text,
  city text,
  slug text,
  phone text,
  whatsapp text,
  email text,
  bio text,
  logo_url text,
  instagram text,
  pix_key text,
  pix_tipo text,
  include_pix boolean DEFAULT true NOT NULL,
  plan text DEFAULT 'free'::text NOT NULL,
  plan_expires_at timestamp with time zone,
  is_public boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  portfolio_publico boolean DEFAULT false NOT NULL,
  portfolio_aceito_em timestamp with time zone,
  city_slug text,
  uf character(2),
  niche text,
  origem text,
  area_atendimento text,
  tipo_atendimento text DEFAULT 'ambos'::text NOT NULL,
  cnpj text,
  empresa_nome text,
  cnpj_situacao text,
  cnpj_abertura date,
  cnpj_verificado_em timestamp with time zone,
  atua_desde smallint,
  garantia text,
  formas_pagamento text[],
  atende_urgencia boolean DEFAULT false NOT NULL,
  registros text,
  outras_profissoes jsonb DEFAULT '[]'::jsonb NOT NULL,
  nichos text[] DEFAULT '{}'::text[] NOT NULL,
  cidades_atendidas text[] DEFAULT '{}'::text[] NOT NULL,
  cidades text[] DEFAULT '{}'::text[] NOT NULL,
  aceita_ligacao boolean DEFAULT false NOT NULL
);

CREATE TABLE public.project_snapshots (
  snapshot_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  origem text NOT NULL,
  status text DEFAULT 'coletando'::text NOT NULL,
  hash_geral text,
  total_arquivos integer DEFAULT 0 NOT NULL,
  total_bytes bigint DEFAULT 0 NOT NULL,
  lacunas jsonb DEFAULT '[]'::jsonb NOT NULL,
  erro text,
  notas text
);

CREATE TABLE public.registros_acesso (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  ip text,
  ocorrido_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.reports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  professional_id uuid NOT NULL,
  client_name text NOT NULL,
  category_key text,
  category_label text,
  niche text,
  service_date date,
  service_location text,
  service_description text,
  photos jsonb DEFAULT '[]'::jsonb NOT NULL,
  is_public boolean DEFAULT true NOT NULL,
  rating smallint,
  rating_comment text,
  rating_used boolean DEFAULT false NOT NULL,
  rating_token text DEFAULT encode(gen_random_bytes(12), 'hex'::text) NOT NULL,
  linked_budget_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  valor numeric(12,2),
  payment_status text DEFAULT 'nao_cobrado'::text NOT NULL,
  paid_at timestamp with time zone,
  client_paid_claim_at timestamp with time zone,
  portfolio_ok boolean DEFAULT true NOT NULL,
  arquivado_em timestamp with time zone,
  cliente_curto text,
  obra_id uuid,
  titulo_publico text,
  tipo text DEFAULT 'servico'::text NOT NULL
);

CREATE TABLE public.signup_leads (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  email text NOT NULL,
  niche text,
  city text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  origem text
);

CREATE TABLE public.snapshot_changes (
  snapshot_id text NOT NULL,
  change_id text NOT NULL
);

CREATE TABLE public.snapshot_exports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  snapshot_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  formato text DEFAULT 'zip'::text NOT NULL,
  storage_path text,
  hash_original text,
  bytes_original bigint,
  hash_recuperado text,
  bytes_recuperado bigint,
  arquivos_conferidos integer DEFAULT 0 NOT NULL,
  arquivos_divergentes integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'gerando'::text NOT NULL,
  erro text
);

CREATE TABLE public.snapshot_files (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  snapshot_id text NOT NULL,
  caminho text NOT NULL,
  origem text NOT NULL,
  fonte_detalhe text,
  bytes integer,
  hash text,
  storage_path text,
  content_type text,
  ok boolean DEFAULT true NOT NULL,
  erro text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.studio_videos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  professional_id uuid NOT NULL,
  report_id uuid NOT NULL,
  codigo text NOT NULL,
  modelo text NOT NULL,
  trilha text NOT NULL,
  roteiro jsonb NOT NULL,
  marca boolean DEFAULT true NOT NULL,
  formato text,
  duracao_ms integer,
  gerado_em timestamp with time zone,
  exportacoes integer DEFAULT 0 NOT NULL,
  compartilhado_em timestamp with time zone,
  aviso_1d_em timestamp with time zone,
  aviso_7d_em timestamp with time zone,
  criado_em timestamp with time zone DEFAULT now() NOT NULL,
  atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.work_entries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  professional_id uuid NOT NULL,
  empreitada_id uuid,
  empreiteiro_id uuid,
  descricao text,
  periodo_tipo text,
  periodo_numero smallint,
  periodo_ano smallint,
  valor_executado numeric(12,2),
  valor_total_diaria numeric(12,2),
  status text DEFAULT 'pendente'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
