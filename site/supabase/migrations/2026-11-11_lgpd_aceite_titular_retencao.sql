-- Fieldo · v12.36 · LGPD e Marco Civil (11/11/2026)
--
-- NÃO APLICADO. Rodar no SQL Editor do Supabase ANTES de publicar o
-- site v12.36: o site novo já chama as funções criadas aqui. Se o site
-- subir primeiro, o aceite fica guardado no aparelho e é reenviado
-- depois, mas "Baixar meus dados" e "Fazer um pedido" dão erro até
-- este arquivo rodar.
--
-- O QUE CRIA
--   1. aceites              · quem aceitou Termos e Política, qual versão, quando,
--                             de qual navegador e IP. Só se insere, nunca se altera.
--   2. pedidos_titular      · pedidos da LGPD (acesso, correção, exclusão...) com
--                             prazo de resposta de 15 dias (LGPD art. 19, II).
--   3. registros_acesso     · conta, data, hora e IP de uso do app, guardados por
--                             6 meses (Marco Civil da Internet, art. 15).
--   4. meus_dados()         · devolve num JSON tudo o que a conta tem, sem os
--                             tokens e hashes que dão acesso a terceiros.
--   5. lgpd_aplicar_retencao() + agendamento diário · apaga o que passou do prazo.
--   6. signup_leads         · para de aceitar gravação. Os 20 e-mails que já estão
--                             lá são apagados na primeira rodada da retenção
--                             (prazo de 30 dias), porque a finalidade anunciada
--                             ("te mandar o link de volta") nunca existiu: o
--                             Fieldo não envia e-mail.
--
-- PRAZOS DE GUARDA (os mesmos da Política de Privacidade)
--   analytics_events   12 meses     funnel_events    12 meses
--   registros_acesso    6 meses     signup_leads     30 dias (e para de coletar)
--   integrity_checks   90 dias (a linha de base fica)
--   impact_events      24 meses     pedidos_titular   5 anos
--   aceites             5 anos depois que a conta deixa de existir
--   contas anônimas sem perfil, locadora nem síndico: 12 meses sem uso
--
-- O QUE NÃO FAZ
--   · Não apaga o schema backup_v10_5. Isso está em arquivo separado
--     (2026-11-11_lgpd_apagar_backup_v10_5.sql), porque não tem volta.
--   · Não mexe em conta, perfil, relatório ou orçamento de ninguém.

begin;

-- ─────────────────────────────────────────────────────────────────
-- 0. IP de quem fez a requisição (PostgREST repassa os cabeçalhos)
-- ─────────────────────────────────────────────────────────────────
create schema if not exists private;

create or replace function private.ip_da_requisicao()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  h json;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return null;
  end;
  if h is null then
    return null;
  end if;
  return nullif(btrim(coalesce(
    h ->> 'cf-connecting-ip',
    h ->> 'x-real-ip',
    split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1)
  )), '');
end
$$;

revoke all on function private.ip_da_requisicao() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 1. ACEITES
-- user_id sem chave estrangeira de propósito: a prova do aceite
-- precisa sobreviver à exclusão da conta (guardada por 5 anos depois).
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.aceites (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  documento   text not null check (documento in ('termos', 'privacidade', 'marketing')),
  versao      text not null check (char_length(versao) between 1 and 20),
  aceito      boolean not null default true,
  origem      text check (origem is null or char_length(origem) <= 60),
  ip          text check (ip is null or char_length(ip) <= 64),
  user_agent  text check (user_agent is null or char_length(user_agent) <= 300),
  criado_em   timestamptz not null default now()
);

comment on table public.aceites is
  'v12.36 · LGPD. Registro de aceite de Termos, Política e (se um dia existir) marketing. Só INSERT pela função registrar_aceite. O dono lê os próprios.';

create index if not exists idx_aceites_user on public.aceites (user_id, documento, criado_em desc);

alter table public.aceites enable row level security;

drop policy if exists aceites_select_own on public.aceites;
create policy aceites_select_own on public.aceites
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.aceites from anon, authenticated;
grant select on public.aceites to authenticated;

-- Aceite nunca muda depois de gravado
create or replace function private.aceites_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('request.jwt.claims', true) is not null
     and current_setting('request.jwt.claims', true) <> '' then
    raise exception 'aceite_imutavel' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_aceites_imutavel on public.aceites;
create trigger trg_aceites_imutavel
  before update or delete on public.aceites
  for each row execute function private.aceites_imutavel();

create or replace function public.registrar_aceite(
  p_documento  text,
  p_versao     text,
  p_aceito     boolean default true,
  p_origem     text    default null,
  p_user_agent text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'nao_autenticado' using errcode = '28000';
  end if;
  if p_documento is null or p_documento not in ('termos', 'privacidade', 'marketing') then
    raise exception 'documento_invalido' using errcode = '22023';
  end if;
  if p_versao is null or btrim(p_versao) = '' then
    raise exception 'versao_invalida' using errcode = '22023';
  end if;

  insert into public.aceites (user_id, documento, versao, aceito, origem, ip, user_agent)
  values (
    v_uid,
    p_documento,
    left(btrim(p_versao), 20),
    coalesce(p_aceito, true),
    left(p_origem, 60),
    left(private.ip_da_requisicao(), 64),
    left(p_user_agent, 300)
  )
  returning id into v_id;

  return v_id;
end
$$;

revoke all on function public.registrar_aceite(text, text, boolean, text, text) from public, anon;
grant execute on function public.registrar_aceite(text, text, boolean, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 2. PEDIDOS DO TITULAR
-- Qualquer pessoa pode pedir (cliente que avaliou também é titular),
-- por isso a função aceita anon. Sem login, o contato é obrigatório.
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.pedidos_titular (
  id              uuid primary key default gen_random_uuid(),
  numero          bigint generated always as identity,
  user_id         uuid,
  tipo            text not null check (tipo in
                    ('acesso', 'correcao', 'exclusao', 'portabilidade', 'revogacao', 'oposicao', 'informacao',
                     'arrependimento', 'outro')),
  contato         text check (contato is null or char_length(contato) <= 160),
  detalhe         text check (detalhe is null or char_length(detalhe) <= 2000),
  status          text not null default 'aberto' check (status in ('aberto', 'em_andamento', 'concluido', 'recusado')),
  ip              text check (ip is null or char_length(ip) <= 64),
  criado_em       timestamptz not null default now(),
  prazo_resposta  timestamptz not null default (now() + interval '15 days'),
  respondido_em   timestamptz,
  resposta        text
);

comment on table public.pedidos_titular is
  'v12.36 · LGPD art. 18 (acesso, correção, exclusão etc., resposta em 15 dias) e CDC art. 49 (tipo arrependimento: reembolso integral pedido em até 7 dias da contratação). Quem responde é o administrador, pelo SQL Editor ou por um painel com service role.';

create index if not exists idx_pedidos_abertos on public.pedidos_titular (status, prazo_resposta) where status in ('aberto', 'em_andamento');

alter table public.pedidos_titular enable row level security;

drop policy if exists pedidos_select_own on public.pedidos_titular;
create policy pedidos_select_own on public.pedidos_titular
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.pedidos_titular from anon, authenticated;
grant select (id, numero, tipo, status, criado_em, prazo_resposta, respondido_em, resposta)
  on public.pedidos_titular to authenticated;

create or replace function public.registrar_pedido_titular(
  p_tipo     text,
  p_contato  text default null,
  p_detalhe  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_ip      text := left(private.ip_da_requisicao(), 64);
  v_contato text := nullif(btrim(coalesce(p_contato, '')), '');
  v_row     public.pedidos_titular%rowtype;
  v_recentes int;
begin
  if p_tipo is null or p_tipo not in
     ('acesso', 'correcao', 'exclusao', 'portabilidade', 'revogacao', 'oposicao', 'informacao',
      'arrependimento', 'outro') then
    raise exception 'tipo_invalido' using errcode = '22023';
  end if;
  if v_uid is null and v_contato is null then
    raise exception 'contato_obrigatorio' using errcode = '22023';
  end if;

  -- Freio contra abuso: no máximo 5 pedidos por hora por conta ou por IP
  select count(*) into v_recentes
    from public.pedidos_titular
   where criado_em > now() - interval '1 hour'
     and ((v_uid is not null and user_id = v_uid) or (v_ip is not null and ip = v_ip));
  if v_recentes >= 5 then
    raise exception 'muitos_pedidos' using errcode = '54000';
  end if;

  insert into public.pedidos_titular (user_id, tipo, contato, detalhe, ip)
  values (v_uid, p_tipo, left(v_contato, 160), left(nullif(btrim(coalesce(p_detalhe, '')), ''), 2000), v_ip)
  returning * into v_row;

  return jsonb_build_object('numero', v_row.numero, 'prazo_resposta', v_row.prazo_resposta);
end
$$;

revoke all on function public.registrar_pedido_titular(text, text, text) from public;
grant execute on function public.registrar_pedido_titular(text, text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 3. REGISTROS DE ACESSO (Marco Civil, art. 15: 6 meses)
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.registros_acesso (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  ip          text check (ip is null or char_length(ip) <= 64),
  ocorrido_em timestamptz not null default now()
);

comment on table public.registros_acesso is
  'v12.36 · Marco Civil da Internet, art. 15. Conta, data/hora e IP de uso do app. Guardado por 6 meses. Só a função registrar_acesso escreve; ninguém lê pela API.';

create index if not exists idx_reg_acesso_user on public.registros_acesso (user_id, ocorrido_em desc);
create index if not exists idx_reg_acesso_data on public.registros_acesso (ocorrido_em);

alter table public.registros_acesso enable row level security;
revoke all on public.registros_acesso from anon, authenticated;

create or replace function public.registrar_acesso()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;
  if exists (select 1 from public.registros_acesso
              where user_id = v_uid and ocorrido_em > now() - interval '1 hour') then
    return;
  end if;
  insert into public.registros_acesso (user_id, ip)
  values (v_uid, left(private.ip_da_requisicao(), 64));
end
$$;

revoke all on function public.registrar_acesso() from public, anon;
grant execute on function public.registrar_acesso() to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 4. MEUS DADOS (LGPD art. 18, II e V)
-- Tira só o que serve de chave de acesso para OUTRA pessoa (link de
-- avaliação, de aprovação, de contrato) e o hash das chaves MCP.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.meus_dados()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  u uuid := auth.uid();
  r jsonb;
begin
  if u is null then
    raise exception 'nao_autenticado' using errcode = '28000';
  end if;

  select jsonb_build_object(
    'gerado_em', now(),
    'aviso', 'Cópia dos dados que o Fieldo guarda sobre esta conta (LGPD, art. 18). Links e códigos que dão acesso a clientes foram retirados por segurança.',
    'conta', (select jsonb_build_object(
                'id', au.id,
                'email', case when au.email like '%@device.fieldo.app' then null else au.email end,
                'criada_em', au.created_at,
                'ultimo_login', au.last_sign_in_at)
              from auth.users au where au.id = u),
    'profissional',        (select to_jsonb(p) from public.professionals p where p.id = u),
    'relatorios',          (select coalesce(jsonb_agg(to_jsonb(x) - 'rating_token' order by x.created_at), '[]'::jsonb)
                              from public.reports x where x.professional_id = u),
    'orcamentos',          (select coalesce(jsonb_agg(to_jsonb(x) - array['approval_token', 'mcp_idempotency_key'] order by x.created_at), '[]'::jsonb)
                              from public.budgets x where x.professional_id = u),
    'avaliacoes_recebidas',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
                              from public.avaliacoes x where x.professional_id = u),
    'obras',               (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
                              from public.obras x where x.professional_id = u),
    'empreiteiros',        (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
                              from public.empreiteiros x where x.professional_id = u),
    'empreitadas',         (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
                              from public.empreitadas x where x.professional_id = u),
    'diarias_e_periodos',  (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
                              from public.work_entries x where x.professional_id = u),
    'listas_de_material',  (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
                              from public.material_listas x where x.professional_id = u),
    'precos_de_material',  (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
                              from public.material_precos x where x.professional_id = u),
    'assinatura',          (select to_jsonb(x) from public.assinaturas x where x.professional_id = u),
    'chaves_de_ia',        (select coalesce(jsonb_agg(jsonb_build_object(
                                'nome', k.name, 'criada_em', k.created_at,
                                'ultimo_uso', k.last_used_at, 'revogada_em', k.revoked_at) order by k.created_at), '[]'::jsonb)
                              from public.mcp_api_keys k where k.professional_id = u),
    'selos_de_documento',  (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
                              from public.document_hashes x where x.professional_id = u or x.locadora_id = u),
    'visitas_e_cliques_no_perfil', (select jsonb_build_object('total', count(*), 'desde', min(x.created_at))
                              from public.impact_events x where x.professional_id = u),
    'locadora',            (select to_jsonb(x) from public.locadoras x where x.id = u),
    'equipamentos',        (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
                              from public.equipamentos x where x.locadora_id = u),
    'locacoes',            (select coalesce(jsonb_agg(to_jsonb(x) - array['rating_token', 'consulta_token'] order by x.created_at), '[]'::jsonb)
                              from public.locacoes x where x.locadora_id = u),
    'contratos_de_locacao',(select coalesce(jsonb_agg(to_jsonb(x) - 'token_hash' order by x.created_at), '[]'::jsonb)
                              from public.loc_contratos x where x.locadora_id = u),
    'contratos_de_locacao_v1', (select coalesce(jsonb_agg(to_jsonb(x) - 'token' order by x.emitido_em), '[]'::jsonb)
                              from public.locacao_contratos x where x.locadora_id = u),
    'sindico',             (select to_jsonb(x) from public.condo_sindicos x where x.id = u),
    'condominios',         (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
                              from public.condo_condominios x where x.sindico_id = u),
    'aceites',             (select coalesce(jsonb_agg(to_jsonb(x) - 'user_id' order by x.criado_em), '[]'::jsonb)
                              from public.aceites x where x.user_id = u),
    'pedidos_lgpd',        (select coalesce(jsonb_agg(jsonb_build_object(
                                'numero', x.numero, 'tipo', x.tipo, 'status', x.status,
                                'criado_em', x.criado_em, 'prazo_resposta', x.prazo_resposta,
                                'respondido_em', x.respondido_em, 'resposta', x.resposta) order by x.criado_em), '[]'::jsonb)
                              from public.pedidos_titular x where x.user_id = u)
  ) into r;

  return r;
end
$$;

revoke all on function public.meus_dados() from public, anon;
grant execute on function public.meus_dados() to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 5. SIGNUP_LEADS para de receber e-mails
-- ─────────────────────────────────────────────────────────────────
drop policy if exists leads_insert_publico on public.signup_leads;
revoke insert on public.signup_leads from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 6. RETENÇÃO (roda todo dia às 03:17 de Brasília)
-- ─────────────────────────────────────────────────────────────────
create or replace function public.lgpd_aplicar_retencao()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n_analytics int; n_funil int; n_acesso int; n_leads int;
  n_integ int; n_impact int; n_pedidos int; n_aceites int; n_contas int;
begin
  delete from public.analytics_events where created_at < now() - interval '12 months';
  get diagnostics n_analytics = row_count;

  delete from public.funnel_events where created_at < now() - interval '12 months';
  get diagnostics n_funil = row_count;

  delete from public.registros_acesso where ocorrido_em < now() - interval '6 months';
  get diagnostics n_acesso = row_count;

  delete from public.signup_leads where created_at < now() - interval '30 days';
  get diagnostics n_leads = row_count;

  -- a linha de base do monitoramento fica; incidentes ficam (check_id vira null)
  delete from public.integrity_checks where checked_at < now() - interval '90 days' and not is_baseline;
  get diagnostics n_integ = row_count;

  delete from public.impact_events where created_at < now() - interval '24 months';
  get diagnostics n_impact = row_count;

  delete from public.pedidos_titular where criado_em < now() - interval '5 years';
  get diagnostics n_pedidos = row_count;

  -- prova de aceite: 5 anos depois que a conta deixou de existir
  delete from public.aceites a
   where a.criado_em < now() - interval '5 years'
     and not exists (select 1 from auth.users u where u.id = a.user_id);
  get diagnostics n_aceites = row_count;

  -- conta anônima que nunca virou perfil, locadora nem síndico, parada há 12 meses
  delete from auth.users u
   where u.is_anonymous
     and u.created_at < now() - interval '12 months'
     and coalesce(u.last_sign_in_at, u.created_at) < now() - interval '12 months'
     and not exists (select 1 from public.professionals p where p.id = u.id)
     and not exists (select 1 from public.locadoras l where l.id = u.id)
     and not exists (select 1 from public.condo_sindicos c where c.id = u.id);
  get diagnostics n_contas = row_count;

  return jsonb_build_object(
    'rodou_em', now(),
    'analytics_events', n_analytics, 'funnel_events', n_funil,
    'registros_acesso', n_acesso, 'signup_leads', n_leads,
    'integrity_checks', n_integ, 'impact_events', n_impact,
    'pedidos_titular', n_pedidos, 'aceites', n_aceites,
    'contas_anonimas_sem_perfil', n_contas);
end
$$;

revoke all on function public.lgpd_aplicar_retencao() from public, anon, authenticated;

select cron.schedule(
  'lgpd-retencao-diaria',
  '17 6 * * *',
  $cron$ select public.lgpd_aplicar_retencao(); $cron$
);

commit;

-- CONFERIR DEPOIS DE RODAR (cada linha deve dar o indicado):
--   select count(*) from public.aceites;                              -- 0 (tabela nova)
--   select public.lgpd_aplicar_retencao();                            -- mostra o que apagou
--   select jobname, schedule, active from cron.job where jobname = 'lgpd-retencao-diaria';
--   select has_function_privilege('anon', 'public.meus_dados()', 'execute');   -- false
--   select has_table_privilege('anon', 'public.signup_leads', 'insert');       -- false
