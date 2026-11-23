-- ============================================================
-- Fieldo Locação · Contratos digitais · PARTE 1 de 2 — tabelas
-- ------------------------------------------------------------
-- Ordem de execução: esta parte primeiro, depois
-- 2026-10-19_loc_contratos_02_funcoes.sql.
--
-- Princípios:
--  · A locadora só LÊ as tabelas (RLS por locadora_id = auth.uid()).
--    Toda escrita passa por funções (parte 2), que validam estado,
--    dono e integridade no banco — não na tela.
--  · Depois que o contrato é enviado, o texto e os dados ficam
--    congelados (trigger abaixo). Mudança = nova versão.
--  · Assinaturas e eventos são só de inserção (UPDATE bloqueado).
--  · O token do link nunca é gravado; só o hash SHA-256 dele.
-- ============================================================

-- Modelo de cláusulas e condições da própria locadora (pré-preenche rascunhos)
create table if not exists public.loc_contrato_modelos (
  locadora_id uuid primary key references public.locadoras(id) on delete cascade,
  clausulas   jsonb not null default '[]'::jsonb,
  condicoes   jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  constraint loc_modelo_clausulas_array check (jsonb_typeof(clausulas) = 'array'),
  constraint loc_modelo_condicoes_obj   check (jsonb_typeof(condicoes) = 'object')
);

create table if not exists public.loc_contratos (
  id              uuid primary key default gen_random_uuid(),
  locadora_id     uuid not null references public.locadoras(id) on delete cascade,
  locacao_id      uuid not null references public.locacoes(id) on delete restrict,
  grupo_id        uuid not null,              -- todas as versões do mesmo contrato
  ano             int  not null,
  seq             int  not null,
  numero          text not null,              -- ex.: LOC-2026-0001
  versao          int  not null default 1,
  status          text not null default 'rascunho',
  dados           jsonb not null,             -- partes, itens, datas, valores, condições
  clausulas       jsonb not null default '[]'::jsonb,
  origem_hash     text,                       -- fingerprint da locação quando o rascunho foi montado
  documento_texto text,                       -- texto exato apresentado e aceito
  documento_hash  text,                       -- SHA-256 hex do documento_texto (UTF-8)
  token_hash      text,
  token_expira_em timestamptz,
  revogado_em     timestamptz,
  substituido_por uuid references public.loc_contratos(id) deferrable initially deferred,
  enviado_em      timestamptz,
  concluido_em    timestamptz,
  pdf_path        text,
  pdf_hash        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint loc_contratos_status_ck check (status in
    ('rascunho','aguardando_cliente','aguardando_locadora','assinado','recusado','cancelado','substituido')),
  constraint loc_contratos_versao_ck check (versao >= 1),
  constraint loc_contratos_dados_obj check (jsonb_typeof(dados) = 'object'),
  constraint loc_contratos_clausulas_array check (jsonb_typeof(clausulas) = 'array'),
  constraint loc_contratos_texto_max check (documento_texto is null or char_length(documento_texto) <= 300000),
  constraint loc_contratos_congelado_ck check (status = 'rascunho' or (documento_texto is not null and documento_hash is not null)),
  constraint loc_contratos_numero_uk unique (locadora_id, ano, seq, versao)
);

create unique index if not exists loc_contratos_token_hash_uk
  on public.loc_contratos (token_hash) where token_hash is not null;
-- no máximo 1 rascunho por contrato (grupo), 1 pendente e 1 assinado por locação
create unique index if not exists loc_contratos_um_rascunho_por_grupo
  on public.loc_contratos (grupo_id) where status = 'rascunho';
create unique index if not exists loc_contratos_um_pendente_por_locacao
  on public.loc_contratos (locacao_id) where status in ('aguardando_cliente','aguardando_locadora');
create unique index if not exists loc_contratos_um_assinado_por_locacao
  on public.loc_contratos (locacao_id) where status = 'assinado';
create index if not exists loc_contratos_locadora_idx on public.loc_contratos (locadora_id, updated_at desc);
create index if not exists loc_contratos_locacao_idx  on public.loc_contratos (locacao_id);
create index if not exists loc_contratos_grupo_idx    on public.loc_contratos (grupo_id, versao);

create table if not exists public.loc_contrato_assinaturas (
  id             uuid primary key default gen_random_uuid(),
  contrato_id    uuid not null references public.loc_contratos(id) on delete cascade,
  locadora_id    uuid not null references public.locadoras(id) on delete cascade,
  parte          text not null check (parte in ('locadora','locatario')),
  nome           text not null,
  documento      text not null,
  metodo         text not null default 'aceite_eletronico_simples',
  aceite_versao  text not null,
  aceite_texto   text not null,
  documento_hash text not null,               -- hash do documento no momento do aceite
  traco_png      text,                        -- desenho da assinatura (representação visual)
  ip             text,
  user_agent     text,
  assinado_em    timestamptz not null default now(),
  constraint loc_assinatura_uma_por_parte unique (contrato_id, parte),
  constraint loc_assinatura_traco_max check (traco_png is null or char_length(traco_png) <= 120000),
  constraint loc_assinatura_traco_fmt check (traco_png is null or traco_png like 'data:image/png;base64,%')
);
create index if not exists loc_assinaturas_locadora_idx on public.loc_contrato_assinaturas (locadora_id);

create table if not exists public.loc_contrato_eventos (
  id          bigint generated always as identity primary key,
  contrato_id uuid not null references public.loc_contratos(id) on delete cascade,
  locadora_id uuid not null references public.locadoras(id) on delete cascade,
  tipo        text not null,
  ator        text not null check (ator in ('locadora','locatario','sistema')),
  detalhe     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists loc_eventos_contrato_idx on public.loc_contrato_eventos (contrato_id, created_at);

-- ── Proteção: documento congelado + transições válidas ───────────
create or replace function public._loc_contratos_guard() returns trigger
language plpgsql as $$
begin
  if old.status <> 'rascunho' then
    if new.dados is distinct from old.dados
       or new.clausulas is distinct from old.clausulas
       or new.documento_texto is distinct from old.documento_texto
       or new.documento_hash is distinct from old.documento_hash
       or new.numero is distinct from old.numero
       or new.versao is distinct from old.versao
       or new.seq is distinct from old.seq
       or new.ano is distinct from old.ano
       or new.grupo_id is distinct from old.grupo_id
       or new.locacao_id is distinct from old.locacao_id
       or new.locadora_id is distinct from old.locadora_id then
      raise exception 'contrato_imutavel' using errcode = 'P0001';
    end if;
  end if;

  if old.pdf_path is not null and new.pdf_path is distinct from old.pdf_path then
    raise exception 'pdf_ja_registrado' using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'rascunho'            and new.status in ('aguardando_cliente','cancelado')) or
      (old.status = 'aguardando_cliente'  and new.status in ('aguardando_locadora','assinado','recusado','cancelado','substituido')) or
      (old.status = 'aguardando_locadora' and new.status in ('assinado','recusado','cancelado','substituido')) or
      (old.status = 'assinado'            and new.status = 'substituido')
    ) then
      raise exception 'transicao_invalida: % -> %', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists loc_contratos_guard on public.loc_contratos;
create trigger loc_contratos_guard before update on public.loc_contratos
  for each row execute function public._loc_contratos_guard();

create or replace function public._loc_somente_insercao() returns trigger
language plpgsql as $$
begin
  raise exception 'registro_imutavel' using errcode = 'P0001';
end $$;

drop trigger if exists loc_assinaturas_no_update on public.loc_contrato_assinaturas;
create trigger loc_assinaturas_no_update before update on public.loc_contrato_assinaturas
  for each row execute function public._loc_somente_insercao();
drop trigger if exists loc_eventos_no_update on public.loc_contrato_eventos;
create trigger loc_eventos_no_update before update on public.loc_contrato_eventos
  for each row execute function public._loc_somente_insercao();

-- ── RLS: a locadora só lê o que é dela. Escrita só via funções. ──
alter table public.loc_contratos           enable row level security;
alter table public.loc_contrato_assinaturas enable row level security;
alter table public.loc_contrato_eventos     enable row level security;
alter table public.loc_contrato_modelos     enable row level security;

drop policy if exists loc_contratos_select_own on public.loc_contratos;
create policy loc_contratos_select_own on public.loc_contratos
  for select to authenticated using (locadora_id = auth.uid());

drop policy if exists loc_assinaturas_select_own on public.loc_contrato_assinaturas;
create policy loc_assinaturas_select_own on public.loc_contrato_assinaturas
  for select to authenticated using (locadora_id = auth.uid());

drop policy if exists loc_eventos_select_own on public.loc_contrato_eventos;
create policy loc_eventos_select_own on public.loc_contrato_eventos
  for select to authenticated using (locadora_id = auth.uid());

drop policy if exists loc_modelos_all_own on public.loc_contrato_modelos;
drop policy if exists loc_modelos_select_own on public.loc_contrato_modelos;
create policy loc_modelos_select_own on public.loc_contrato_modelos
  for select to authenticated using (locadora_id = auth.uid());
-- escrita do modelo: só pela função loc_contrato_modelo_salvar (valida o conteúdo)

revoke all on public.loc_contratos, public.loc_contrato_assinaturas,
              public.loc_contrato_eventos, public.loc_contrato_modelos from anon, authenticated;
grant select on public.loc_contratos, public.loc_contrato_assinaturas,
                public.loc_contrato_eventos, public.loc_contrato_modelos to authenticated;

-- ── Storage: PDFs finais, bucket privado, pasta = id da locadora ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('loc-contratos', 'loc-contratos', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists loc_contratos_pdf_insert on storage.objects;
create policy loc_contratos_pdf_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'loc-contratos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists loc_contratos_pdf_select on storage.objects;
create policy loc_contratos_pdf_select on storage.objects
  for select to authenticated
  using (bucket_id = 'loc-contratos' and (storage.foldername(name))[1] = auth.uid()::text);
-- Sem policy de UPDATE/DELETE: o PDF arquivado não é sobrescrito nem apagado pelo app.
