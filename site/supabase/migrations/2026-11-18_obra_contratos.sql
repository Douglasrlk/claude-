-- ============================================================
-- Fieldo · v12.40 · Contrato de obra com assinatura eletrônica (18/11/2026)
-- ------------------------------------------------------------
-- Pedido do dono: a obra passa a ter contrato firmado com assinatura e
-- validação jurídica. Mesmo desenho dos contratos da Locação
-- (2026-10-19_loc_contratos_01/02), que já está em produção:
--
--  · O profissional só LÊ as tabelas (RLS por professional_id). Toda
--    escrita passa por funções que validam dono, estado e dados.
--  · Depois de enviado, texto e dados ficam congelados (trigger). Mudança
--    = nova versão (aditivo). A versão assinada anterior vira "substituído"
--    só quando a nova é assinada.
--  · Assinaturas e eventos são só de inserção.
--  · O token do link nunca é gravado; só o SHA-256 dele.
--  · O profissional (CONTRATADA) assina ao enviar; o cliente
--    (CONTRATANTE) assina pelo link, confirmando o CPF/CNPJ do contrato.
--  · Assinatura eletrônica simples (Lei 14.063/2020, art. 4º, I), com
--    evidências: data/hora, IP, navegador, hash do texto aceito, texto
--    do aceite e desenho opcional. Conferível em verificar_hash.
--  · Liberado para TODOS os planos (decisão do dono, 18/11): contrato de
--    obra é o que dá segurança ao cliente final, não um extra do Pro.
--
-- Reaproveita as funções utilitárias da Locação, que são genéricas:
-- _loc_err, _loc_digits, _loc_sha256, _loc_doc_valido, _loc_png_valido,
-- _loc_ip e _loc_somente_insercao.
-- ============================================================

-- ── tabelas ──────────────────────────────────────────────────────
create table if not exists public.obra_contratos (
  id              uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  obra_id         uuid not null references public.obras(id) on delete restrict,
  grupo_id        uuid not null,
  ano             int  not null,
  seq             int  not null,
  numero          text not null,                 -- OBR-2026-0001
  versao          int  not null default 1,
  status          text not null default 'rascunho',
  dados           jsonb not null,                -- partes, obra, pagamento, condições
  documento_texto text,
  documento_hash  text,
  token_hash      text,
  token_expira_em timestamptz,
  revogado_em     timestamptz,
  substituido_por uuid references public.obra_contratos(id) deferrable initially deferred,
  enviado_em      timestamptz,
  concluido_em    timestamptz,
  pdf_path        text,
  pdf_hash        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint obra_contratos_status_ck check (status in
    ('rascunho','aguardando_cliente','assinado','recusado','cancelado','substituido')),
  constraint obra_contratos_versao_ck check (versao >= 1),
  constraint obra_contratos_dados_obj check (jsonb_typeof(dados) = 'object'),
  constraint obra_contratos_texto_max check (documento_texto is null or char_length(documento_texto) <= 200000),
  constraint obra_contratos_congelado_ck check (status = 'rascunho' or (documento_texto is not null and documento_hash is not null)),
  constraint obra_contratos_numero_uk unique (professional_id, ano, seq, versao)
);

create unique index if not exists obra_contratos_token_hash_uk on public.obra_contratos (token_hash) where token_hash is not null;
create unique index if not exists obra_contratos_um_rascunho_por_grupo on public.obra_contratos (grupo_id) where status = 'rascunho';
create unique index if not exists obra_contratos_um_pendente_por_obra on public.obra_contratos (obra_id) where status = 'aguardando_cliente';
create unique index if not exists obra_contratos_um_assinado_por_obra on public.obra_contratos (obra_id) where status = 'assinado';
create index if not exists obra_contratos_prof_idx on public.obra_contratos (professional_id, updated_at desc);
create index if not exists obra_contratos_obra_idx on public.obra_contratos (obra_id, versao desc);
create index if not exists obra_contratos_hash_idx on public.obra_contratos (documento_hash) where documento_hash is not null;
create index if not exists obra_contratos_pdf_idx  on public.obra_contratos (pdf_hash) where pdf_hash is not null;

create table if not exists public.obra_contrato_assinaturas (
  id              uuid primary key default gen_random_uuid(),
  contrato_id     uuid not null references public.obra_contratos(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  parte           text not null check (parte in ('contratada','contratante')),
  nome            text not null,
  documento       text not null,
  metodo          text not null default 'aceite_eletronico_simples',
  aceite_versao   text not null,
  aceite_texto    text not null,
  documento_hash  text not null,
  traco_png       text,
  ip              text,
  user_agent      text,
  assinado_em     timestamptz not null default now(),
  constraint obra_assinatura_uma_por_parte unique (contrato_id, parte),
  constraint obra_assinatura_traco_max check (traco_png is null or char_length(traco_png) <= 120000),
  constraint obra_assinatura_traco_fmt check (traco_png is null or traco_png like 'data:image/png;base64,%')
);
create index if not exists obra_assinaturas_prof_idx on public.obra_contrato_assinaturas (professional_id);

create table if not exists public.obra_contrato_eventos (
  id              bigint generated always as identity primary key,
  contrato_id     uuid not null references public.obra_contratos(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  tipo            text not null,
  ator            text not null check (ator in ('contratada','contratante','sistema')),
  detalhe         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists obra_eventos_contrato_idx on public.obra_contrato_eventos (contrato_id, created_at);

-- ── proteção: congelado depois de enviado + transições válidas ───
create or replace function public._oc_guard() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  if old.status <> 'rascunho' then
    if new.dados is distinct from old.dados
       or new.documento_texto is distinct from old.documento_texto
       or new.documento_hash is distinct from old.documento_hash
       or new.numero is distinct from old.numero or new.versao is distinct from old.versao
       or new.seq is distinct from old.seq or new.ano is distinct from old.ano
       or new.grupo_id is distinct from old.grupo_id or new.obra_id is distinct from old.obra_id
       or new.professional_id is distinct from old.professional_id then
      raise exception 'contrato_imutavel' using errcode = 'P0001';
    end if;
  end if;
  if old.pdf_path is not null and new.pdf_path is distinct from old.pdf_path then
    raise exception 'pdf_ja_registrado' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    if not (
      (old.status = 'rascunho'           and new.status in ('aguardando_cliente','cancelado')) or
      (old.status = 'aguardando_cliente' and new.status in ('assinado','recusado','cancelado','substituido')) or
      (old.status = 'assinado'           and new.status = 'substituido')
    ) then
      raise exception 'transicao_invalida: % -> %', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists obra_contratos_guard on public.obra_contratos;
create trigger obra_contratos_guard before update on public.obra_contratos
  for each row execute function public._oc_guard();
drop trigger if exists obra_assinaturas_no_update on public.obra_contrato_assinaturas;
create trigger obra_assinaturas_no_update before update on public.obra_contrato_assinaturas
  for each row execute function public._loc_somente_insercao();
drop trigger if exists obra_eventos_no_update on public.obra_contrato_eventos;
create trigger obra_eventos_no_update before update on public.obra_contrato_eventos
  for each row execute function public._loc_somente_insercao();

-- ── RLS: o profissional só lê o que é dele ───────────────────────
alter table public.obra_contratos            enable row level security;
alter table public.obra_contrato_assinaturas enable row level security;
alter table public.obra_contrato_eventos     enable row level security;

drop policy if exists obra_contratos_select_own on public.obra_contratos;
create policy obra_contratos_select_own on public.obra_contratos
  for select to authenticated using (professional_id = (select auth.uid()));
drop policy if exists obra_assinaturas_select_own on public.obra_contrato_assinaturas;
create policy obra_assinaturas_select_own on public.obra_contrato_assinaturas
  for select to authenticated using (professional_id = (select auth.uid()));
drop policy if exists obra_eventos_select_own on public.obra_contrato_eventos;
create policy obra_eventos_select_own on public.obra_contrato_eventos
  for select to authenticated using (professional_id = (select auth.uid()));

revoke all on public.obra_contratos, public.obra_contrato_assinaturas, public.obra_contrato_eventos from anon, authenticated;
grant select on public.obra_contratos, public.obra_contrato_assinaturas, public.obra_contrato_eventos to authenticated;

-- ── storage: PDF final, bucket privado, pasta = id do profissional ─
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('obra-contratos', 'obra-contratos', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists obra_contratos_pdf_insert on storage.objects;
create policy obra_contratos_pdf_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'obra-contratos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists obra_contratos_pdf_select on storage.objects;
create policy obra_contratos_pdf_select on storage.objects
  for select to authenticated
  using (bucket_id = 'obra-contratos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ════════════════════════════════════════════════════════════════
-- utilitários
-- ════════════════════════════════════════════════════════════════
create or replace function public._oc_evento(p_contrato uuid, p_prof uuid, p_tipo text, p_ator text, p_detalhe jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public, extensions, pg_temp as $$
  insert into public.obra_contrato_eventos (contrato_id, professional_id, tipo, ator, detalhe)
  values (p_contrato, p_prof, p_tipo, p_ator, coalesce(p_detalhe, '{}'::jsonb))
$$;

-- texto livre: até N caracteres, sem caracteres de controle
create or replace function public._oc_txt(p jsonb, p_max int) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when p is null or jsonb_typeof(p) <> 'string' then null
              else nullif(btrim(left(regexp_replace(p #>> '{}', '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'), p_max)), '') end
$$;

-- dados iniciais a partir da obra e do perfil
create or replace function public._oc_snapshot(p_obra uuid, p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare o public.obras; p public.professionals;
begin
  select * into o from public.obras where id = p_obra and professional_id = p_uid;
  if not found then return jsonb_build_object('erro', 'obra_nao_encontrada'); end if;
  select * into p from public.professionals where id = p_uid;
  return jsonb_build_object(
    'contratada', jsonb_build_object(
      'nome', coalesce(nullif(p.empresa_nome, ''), p.name),
      'documento', case when p.cnpj_situacao = 'ATIVA' then p.cnpj else null end,
      'telefone', p.whatsapp,
      'cidade', concat_ws('/', nullif(p.city, ''), nullif(p.uf, ''))),
    'contratante', jsonb_build_object('nome', o.cliente, 'documento', null, 'telefone', null, 'endereco', null),
    'obra', jsonb_build_object(
      'titulo', o.titulo, 'endereco', o.cidade, 'descricao', null,
      'inicio', null, 'termino_previsto', null, 'valor_total', o.valor_total),
    'pagamento', jsonb_build_object('forma', 'Pix', 'parcelas', '[]'::jsonb),
    'condicoes', jsonb_build_object(
      'materiais', 'contratante', 'materiais_obs', null, 'garantia_meses', 3,
      'multa_atraso', null, 'foro', concat_ws('/', nullif(p.city, ''), nullif(p.uf, '')))
  );
end $$;

-- aplica uma edição só nos campos permitidos, com limites
create or replace function public._oc_merge(p_dados jsonb, p_ed jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  d jsonb := p_dados; sec text; k text; v jsonb; lista jsonb := '[]'::jsonb; it jsonb; n int := 0;
  permitidos jsonb := jsonb_build_object(
    'contratada',  jsonb_build_array('nome','documento','telefone','cidade'),
    'contratante', jsonb_build_array('nome','documento','telefone','endereco'),
    'obra',        jsonb_build_array('titulo','endereco','descricao','inicio','termino_previsto','valor_total'),
    'pagamento',   jsonb_build_array('forma'),
    'condicoes',   jsonb_build_array('materiais','materiais_obs','garantia_meses','multa_atraso','foro'));
begin
  if p_ed is null or jsonb_typeof(p_ed) <> 'object' then return d; end if;
  for sec in select jsonb_object_keys(permitidos) loop
    if p_ed ? sec and jsonb_typeof(p_ed -> sec) = 'object' then
      for k, v in select key, value from jsonb_each(p_ed -> sec) loop
        if not (permitidos -> sec) ? k then continue; end if;
        if k = 'valor_total' then
          d := jsonb_set(d, array[sec, k], case when jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between 0 and 100000000
                                                then to_jsonb(round((v #>> '{}')::numeric, 2)) else 'null'::jsonb end, true);
        elsif k = 'garantia_meses' then
          d := jsonb_set(d, array[sec, k], case when jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between 0 and 120
                                                then to_jsonb(floor((v #>> '{}')::numeric)::int) else 'null'::jsonb end, true);
        elsif k in ('inicio','termino_previsto') then
          d := jsonb_set(d, array[sec, k], case when jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
                                                then v else 'null'::jsonb end, true);
        elsif k = 'materiais' then
          d := jsonb_set(d, array[sec, k], case when (v #>> '{}') in ('contratante','contratada','misto') then v else '"contratante"'::jsonb end, true);
        else
          d := jsonb_set(d, array[sec, k], coalesce(to_jsonb(public._oc_txt(v, case when k in ('descricao','materiais_obs','multa_atraso') then 4000 else 300 end)), 'null'::jsonb), true);
        end if;
      end loop;
    end if;
  end loop;
  -- parcelas: até 24, cada uma com descrição (até 200), valor e quando (até 120)
  if p_ed ? 'pagamento' and (p_ed -> 'pagamento') ? 'parcelas' and jsonb_typeof(p_ed #> '{pagamento,parcelas}') = 'array' then
    for it in select value from jsonb_array_elements(p_ed #> '{pagamento,parcelas}') loop
      n := n + 1;
      exit when n > 24;
      if jsonb_typeof(it) = 'object' and jsonb_typeof(it -> 'valor') = 'number' and (it ->> 'valor')::numeric > 0 then
        lista := lista || jsonb_build_array(jsonb_build_object(
          'descricao', coalesce(public._oc_txt(it -> 'descricao', 200), 'Parcela ' || n),
          'valor', round((it ->> 'valor')::numeric, 2),
          'quando', public._oc_txt(it -> 'quando', 120)));
      end if;
    end loop;
    d := jsonb_set(d, '{pagamento,parcelas}', lista, true);
  end if;
  return d;
end $$;

-- data AAAA-MM-DD válida ou null (31/02 não derruba a validação)
create or replace function public._oc_data(p text) returns date
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then return null;
end $$;

-- campos que faltam para enviar
create or replace function public._oc_faltam(d jsonb) returns text[]
language plpgsql immutable set search_path = public, pg_temp as $$
declare f text[] := '{}'; soma numeric; tot numeric;
begin
  if char_length(btrim(coalesce(d #>> '{contratada,nome}', ''))) < 3 then f := f || 'contratada.nome'; end if;
  if not public._loc_doc_valido(d #>> '{contratada,documento}') then f := f || 'contratada.documento'; end if;
  if char_length(btrim(coalesce(d #>> '{contratante,nome}', ''))) < 3 then f := f || 'contratante.nome'; end if;
  if not public._loc_doc_valido(d #>> '{contratante,documento}') then f := f || 'contratante.documento'; end if;
  if length(public._loc_digits(d #>> '{contratante,telefone}')) < 10 then f := f || 'contratante.telefone'; end if;
  if char_length(btrim(coalesce(d #>> '{obra,titulo}', ''))) < 3 then f := f || 'obra.titulo'; end if;
  if char_length(btrim(coalesce(d #>> '{obra,endereco}', ''))) < 5 then f := f || 'obra.endereco'; end if;
  if char_length(btrim(coalesce(d #>> '{obra,descricao}', ''))) < 20 then f := f || 'obra.descricao'; end if;
  if public._oc_data(d #>> '{obra,inicio}') is null or public._oc_data(d #>> '{obra,termino_previsto}') is null
     or public._oc_data(d #>> '{obra,termino_previsto}') < public._oc_data(d #>> '{obra,inicio}') then f := f || 'obra.prazo'; end if;
  tot := nullif(d #>> '{obra,valor_total}', '')::numeric;
  if tot is null or tot <= 0 then f := f || 'obra.valor_total'; end if;
  if jsonb_array_length(coalesce(d #> '{pagamento,parcelas}', '[]'::jsonb)) > 0 then
    select sum((x ->> 'valor')::numeric) into soma from jsonb_array_elements(d #> '{pagamento,parcelas}') x;
    if tot is not null and abs(coalesce(soma, 0) - tot) > 0.009 then f := f || 'pagamento.parcelas'; end if;
  end if;
  if char_length(btrim(coalesce(d #>> '{condicoes,foro}', ''))) < 3 then f := f || 'condicoes.foro'; end if;
  return f;
end $$;

create or replace function public._oc_do_token(p_token text, p_travar boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare c public.obra_contratos; h text;
begin
  if p_token is null or char_length(p_token) < 20 or char_length(p_token) > 200 then return public._loc_err('nao_encontrado'); end if;
  h := public._loc_sha256(p_token);
  if p_travar then select * into c from public.obra_contratos where token_hash = h for update;
  else select * into c from public.obra_contratos where token_hash = h; end if;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.status = 'cancelado'   then return public._loc_err('cancelado'); end if;
  if c.status = 'substituido' then return public._loc_err('substituido'); end if;
  if c.status = 'rascunho'    then return public._loc_err('nao_encontrado'); end if;
  if c.revogado_em is not null and c.status <> 'assinado' then return public._loc_err('revogado'); end if;
  if c.token_expira_em is not null and c.token_expira_em < now() and c.status <> 'assinado' then
    return public._loc_err('expirado');
  end if;
  return jsonb_build_object('ok', true, 'id', c.id);
end $$;

-- ════════════════════════════════════════════════════════════════
-- PROFISSIONAL
-- ════════════════════════════════════════════════════════════════
create or replace function public.obra_contrato_criar(p_obra_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_snap jsonb; v_exist uuid; v_ano int; v_seq int; v_num text; v_id uuid := gen_random_uuid();
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  perform pg_advisory_xact_lock(hashtextextended('obra_contrato:' || v_uid::text, 0));

  v_snap := public._oc_snapshot(p_obra_id, v_uid);
  if v_snap ? 'erro' then return public._loc_err(v_snap ->> 'erro'); end if;

  select id into v_exist from public.obra_contratos
   where obra_id = p_obra_id and status in ('rascunho','aguardando_cliente','assinado')
   order by created_at desc limit 1;
  if found then return public._loc_err('ja_existe', jsonb_build_object('contrato_id', v_exist)); end if;

  v_ano := extract(year from (now() at time zone 'America/Sao_Paulo'))::int;
  select coalesce(max(seq), 0) + 1 into v_seq from public.obra_contratos where professional_id = v_uid and ano = v_ano;
  v_num := 'OBR-' || v_ano || '-' || lpad(v_seq::text, 4, '0');

  insert into public.obra_contratos (id, professional_id, obra_id, grupo_id, ano, seq, numero, versao, status, dados)
  values (v_id, v_uid, p_obra_id, v_id, v_ano, v_seq, v_num, 1, 'rascunho', v_snap);
  perform public._oc_evento(v_id, v_uid, 'criado', 'contratada', jsonb_build_object('numero', v_num));
  return jsonb_build_object('ok', true, 'contrato_id', v_id, 'numero', v_num);
exception when unique_violation then
  return public._loc_err('ja_existe');
end $$;

create or replace function public.obra_contrato_salvar(p_id uuid, p_edicao jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_uid uuid := auth.uid(); c public.obra_contratos; d jsonb;
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  select * into c from public.obra_contratos where id = p_id and professional_id = v_uid for update;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.status <> 'rascunho' then return public._loc_err('nao_editavel'); end if;
  d := public._oc_merge(c.dados, p_edicao);
  update public.obra_contratos set dados = d, updated_at = now() where id = c.id;
  return jsonb_build_object('ok', true, 'dados', d, 'faltam', to_jsonb(public._oc_faltam(d)));
end $$;

-- Envia: congela texto e dados, registra a assinatura da CONTRATADA e gera o link.
create or replace function public.obra_contrato_enviar(
  p_id uuid, p_texto text, p_aceite boolean, p_aceite_versao text, p_aceite_texto text,
  p_traco text default null, p_user_agent text default null, p_validade_dias int default 15
) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid(); c public.obra_contratos; v_faltam text[]; v_token text; v_hash text; v_expira timestamptz;
  v_valor text;
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  select * into c from public.obra_contratos where id = p_id and professional_id = v_uid for update;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.status <> 'rascunho' then return public._loc_err('nao_editavel'); end if;
  if p_validade_dias is null or p_validade_dias < 1 or p_validade_dias > 60 then return public._loc_err('validade_invalida'); end if;
  if p_aceite is not true then return public._loc_err('aceite_obrigatorio'); end if;
  if coalesce(char_length(p_aceite_versao), 0) < 3 or coalesce(char_length(p_aceite_texto), 0) < 20 or char_length(p_aceite_texto) > 1000 then
    return public._loc_err('aceite_invalido');
  end if;
  if p_traco is not null and (char_length(p_traco) > 120000 or not public._loc_png_valido(p_traco)) then
    return public._loc_err('traco_invalido');
  end if;

  v_faltam := public._oc_faltam(c.dados);
  if array_length(v_faltam, 1) is not null then
    return public._loc_err('campos_invalidos', jsonb_build_object('campos', to_jsonb(v_faltam)));
  end if;

  -- o texto tem de ser DESTE contrato: número, versão, documentos das partes e valor
  -- "10.000,00": vírgula e ponto do to_char são fixos (não dependem do locale)
  v_valor := translate(to_char((c.dados #>> '{obra,valor_total}')::numeric, 'FM999,999,999,990.00'), ',.', '.,');
  if p_texto is null or char_length(p_texto) < 400 or char_length(p_texto) > 200000
     or position(c.numero in p_texto) = 0
     or position(public._loc_digits(c.dados #>> '{contratante,documento}') in public._loc_digits(p_texto)) = 0
     or position(public._loc_digits(c.dados #>> '{contratada,documento}') in public._loc_digits(p_texto)) = 0
     or position(v_valor in p_texto) = 0 then
    return public._loc_err('texto_invalido');
  end if;

  -- versões pendentes anteriores do mesmo contrato deixam de valer
  with s as (
    update public.obra_contratos
       set status = 'substituido', revogado_em = coalesce(revogado_em, now()), substituido_por = c.id, updated_at = now()
     where grupo_id = c.grupo_id and id <> c.id and status = 'aguardando_cliente'
     returning id, professional_id)
  insert into public.obra_contrato_eventos (contrato_id, professional_id, tipo, ator, detalhe)
  select id, professional_id, 'substituido', 'sistema', jsonb_build_object('por', c.id) from s;

  v_token  := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_hash   := public._loc_sha256(p_texto);
  v_expira := now() + make_interval(days => p_validade_dias);

  update public.obra_contratos
     set status = 'aguardando_cliente', documento_texto = p_texto, documento_hash = v_hash,
         token_hash = public._loc_sha256(v_token), token_expira_em = v_expira, revogado_em = null,
         enviado_em = now(), updated_at = now()
   where id = c.id;

  insert into public.obra_contrato_assinaturas
    (contrato_id, professional_id, parte, nome, documento, aceite_versao, aceite_texto, documento_hash, traco_png, ip, user_agent)
  values
    (c.id, v_uid, 'contratada', left(c.dados #>> '{contratada,nome}', 200), c.dados #>> '{contratada,documento}',
     p_aceite_versao, p_aceite_texto, v_hash, p_traco, public._loc_ip(), left(p_user_agent, 400));

  perform public._oc_evento(c.id, v_uid, 'enviado', 'contratada',
            jsonb_build_object('documento_hash', v_hash, 'versao', c.versao, 'validade_dias', p_validade_dias));
  perform public._oc_evento(c.id, v_uid, 'assinado_contratada', 'contratada', jsonb_build_object('documento_hash', v_hash));
  return jsonb_build_object('ok', true, 'token', v_token, 'documento_hash', v_hash, 'token_expira_em', v_expira, 'status', 'aguardando_cliente');
end $$;

create or replace function public.obra_contrato_novo_link(p_id uuid, p_validade_dias int default 15)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_uid uuid := auth.uid(); c public.obra_contratos; v_token text; v_expira timestamptz;
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  select * into c from public.obra_contratos where id = p_id and professional_id = v_uid for update;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.status not in ('aguardando_cliente','assinado') then return public._loc_err('estado_invalido'); end if;
  if p_validade_dias is null or p_validade_dias < 1 or p_validade_dias > 60 then return public._loc_err('validade_invalida'); end if;
  v_token  := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_expira := now() + make_interval(days => p_validade_dias);
  update public.obra_contratos
     set token_hash = public._loc_sha256(v_token), token_expira_em = v_expira, revogado_em = null, updated_at = now()
   where id = c.id;
  perform public._oc_evento(c.id, v_uid, 'link_gerado', 'contratada', jsonb_build_object('validade_dias', p_validade_dias));
  return jsonb_build_object('ok', true, 'token', v_token, 'token_expira_em', v_expira);
end $$;

create or replace function public.obra_contrato_cancelar(p_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_uid uuid := auth.uid(); c public.obra_contratos;
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  select * into c from public.obra_contratos where id = p_id and professional_id = v_uid for update;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.status not in ('rascunho','aguardando_cliente') then return public._loc_err('estado_invalido'); end if;
  update public.obra_contratos set status = 'cancelado', revogado_em = coalesce(revogado_em, now()), updated_at = now() where id = c.id;
  perform public._oc_evento(c.id, v_uid, 'cancelado', 'contratada', jsonb_build_object('motivo', left(p_motivo, 500)));
  return jsonb_build_object('ok', true);
end $$;

-- Nova versão (aditivo): rascunho com os dados da versão escolhida.
create or replace function public.obra_contrato_nova_versao(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_uid uuid := auth.uid(); c public.obra_contratos; v_rasc uuid; v_ult int; v_id uuid := gen_random_uuid();
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  perform pg_advisory_xact_lock(hashtextextended('obra_contrato:' || v_uid::text, 0));
  select * into c from public.obra_contratos where id = p_id and professional_id = v_uid for update;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.status not in ('aguardando_cliente','assinado','recusado','cancelado') then return public._loc_err('estado_invalido'); end if;
  select id into v_rasc from public.obra_contratos where grupo_id = c.grupo_id and status = 'rascunho' limit 1;
  if found then return public._loc_err('ja_existe_rascunho', jsonb_build_object('contrato_id', v_rasc)); end if;
  select max(versao) into v_ult from public.obra_contratos where grupo_id = c.grupo_id;
  insert into public.obra_contratos (id, professional_id, obra_id, grupo_id, ano, seq, numero, versao, status, dados)
  values (v_id, v_uid, c.obra_id, c.grupo_id, c.ano, c.seq, c.numero, v_ult + 1, 'rascunho', c.dados);
  perform public._oc_evento(v_id, v_uid, 'nova_versao', 'contratada', jsonb_build_object('a_partir_de', c.id, 'versao', v_ult + 1));
  return jsonb_build_object('ok', true, 'contrato_id', v_id, 'versao', v_ult + 1);
end $$;

create or replace function public.obra_contrato_registrar_pdf(p_id uuid, p_path text, p_hash text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_uid uuid := auth.uid(); c public.obra_contratos;
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  select * into c from public.obra_contratos where id = p_id and professional_id = v_uid for update;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.status <> 'assinado' then return public._loc_err('estado_invalido'); end if;
  if c.pdf_path is not null then return public._loc_err('pdf_ja_registrado'); end if;
  if p_path is null or p_path not like v_uid::text || '/' || c.id::text || '/%' or p_path not like '%.pdf'
     or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    return public._loc_err('pdf_invalido');
  end if;
  update public.obra_contratos set pdf_path = p_path, pdf_hash = p_hash, updated_at = now() where id = c.id;
  perform public._oc_evento(c.id, v_uid, 'pdf_arquivado', 'contratada', jsonb_build_object('pdf_hash', p_hash));
  return jsonb_build_object('ok', true);
end $$;

-- ════════════════════════════════════════════════════════════════
-- CLIENTE (link público)
-- ════════════════════════════════════════════════════════════════
create or replace function public.obra_contrato_por_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare t jsonb; c public.obra_contratos; v_cli boolean; v_ass jsonb; v_doc text;
begin
  t := public._oc_do_token(p_token, false);
  if (t ->> 'ok')::boolean is not true then return t; end if;
  select * into c from public.obra_contratos where id = (t ->> 'id')::uuid;
  if c.status = 'recusado' then return public._loc_err('recusado'); end if;

  select exists (select 1 from public.obra_contrato_assinaturas where contrato_id = c.id and parte = 'contratante') into v_cli;
  select coalesce(jsonb_agg(
           jsonb_build_object('parte', a.parte, 'nome', a.nome, 'assinado_em', a.assinado_em,
                              'documento_hash', a.documento_hash, 'aceite_versao', a.aceite_versao)
           || case when c.status = 'assinado'
                then jsonb_build_object('documento', a.documento, 'ip', a.ip, 'user_agent', a.user_agent,
                                        'traco_png', a.traco_png, 'aceite_texto', a.aceite_texto)
                else '{}'::jsonb end
           order by a.assinado_em), '[]'::jsonb)
    into v_ass from public.obra_contrato_assinaturas a where a.contrato_id = c.id;

  v_doc := public._loc_digits(c.dados #>> '{contratante,documento}');
  if not exists (select 1 from public.obra_contrato_eventos where contrato_id = c.id and tipo = 'visualizado' and ator = 'contratante') then
    perform public._oc_evento(c.id, c.professional_id, 'visualizado', 'contratante', jsonb_build_object('versao', c.versao));
  end if;

  return jsonb_build_object(
    'ok', true,
    'contrato', jsonb_build_object(
      'numero', c.numero, 'versao', c.versao, 'status', c.status,
      'documento_texto', c.documento_texto, 'documento_hash', c.documento_hash,
      'enviado_em', c.enviado_em, 'concluido_em', c.concluido_em, 'token_expira_em', c.token_expira_em),
    'resumo', jsonb_build_object(
      'contratada', c.dados #>> '{contratada,nome}',
      'contratante', c.dados #>> '{contratante,nome}',
      'documento_dica', case when length(v_doc) >= 4 then right(v_doc, 4) else null end,
      'obra', c.dados #>> '{obra,titulo}',
      'valor_total', c.dados #> '{obra,valor_total}',
      'inicio', c.dados #>> '{obra,inicio}',
      'termino_previsto', c.dados #>> '{obra,termino_previsto}'),
    'assinaturas', v_ass,
    'pode_assinar', (c.status = 'aguardando_cliente' and not v_cli)
  );
end $$;

create or replace function public.obra_contrato_assinar_cliente(
  p_token text, p_nome text, p_documento text, p_aceite boolean, p_aceite_versao text,
  p_aceite_texto text, p_traco text default null, p_user_agent text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare t jsonb; c public.obra_contratos; v_tent int;
begin
  t := public._oc_do_token(p_token, true);
  if (t ->> 'ok')::boolean is not true then return t; end if;
  select * into c from public.obra_contratos where id = (t ->> 'id')::uuid;
  if c.status = 'assinado' then return public._loc_err('ja_assinado'); end if;
  if c.status = 'recusado' then return public._loc_err('recusado'); end if;
  if c.status <> 'aguardando_cliente' then return public._loc_err('estado_invalido'); end if;
  if exists (select 1 from public.obra_contrato_assinaturas where contrato_id = c.id and parte = 'contratante') then
    return public._loc_err('ja_assinado');
  end if;

  select count(*) into v_tent from public.obra_contrato_eventos
   where contrato_id = c.id and tipo = 'tentativa_invalida' and created_at > now() - interval '1 hour';
  if v_tent >= 8 then return public._loc_err('muitas_tentativas'); end if;

  if p_aceite is not true then return public._loc_err('aceite_obrigatorio'); end if;
  if coalesce(char_length(p_aceite_versao), 0) < 3 or coalesce(char_length(p_aceite_texto), 0) < 20 or char_length(p_aceite_texto) > 1000 then
    return public._loc_err('aceite_invalido');
  end if;
  if char_length(btrim(coalesce(p_nome, ''))) < 3 or char_length(p_nome) > 200 then return public._loc_err('nome_invalido'); end if;
  if p_traco is not null and (char_length(p_traco) > 120000 or not public._loc_png_valido(p_traco)) then
    return public._loc_err('traco_invalido');
  end if;
  if public._loc_digits(p_documento) is distinct from public._loc_digits(c.dados #>> '{contratante,documento}') then
    perform public._oc_evento(c.id, c.professional_id, 'tentativa_invalida', 'contratante', jsonb_build_object('motivo', 'documento'));
    return public._loc_err('documento_nao_confere');
  end if;

  insert into public.obra_contrato_assinaturas
    (contrato_id, professional_id, parte, nome, documento, aceite_versao, aceite_texto, documento_hash, traco_png, ip, user_agent)
  values
    (c.id, c.professional_id, 'contratante', btrim(p_nome), btrim(p_documento), p_aceite_versao, p_aceite_texto,
     c.documento_hash, p_traco, public._loc_ip(), left(p_user_agent, 400));

  -- as duas partes assinaram: conclui e a versão assinada anterior deixa de valer
  with s as (
    update public.obra_contratos
       set status = 'substituido', revogado_em = coalesce(revogado_em, now()), substituido_por = c.id, updated_at = now()
     where grupo_id = c.grupo_id and id <> c.id and status = 'assinado'
     returning id, professional_id)
  insert into public.obra_contrato_eventos (contrato_id, professional_id, tipo, ator, detalhe)
  select id, professional_id, 'substituido', 'sistema', jsonb_build_object('por', c.id) from s;

  update public.obra_contratos set status = 'assinado', concluido_em = now(), updated_at = now() where id = c.id;
  perform public._oc_evento(c.id, c.professional_id, 'assinado_contratante', 'contratante', jsonb_build_object('documento_hash', c.documento_hash));
  perform public._oc_evento(c.id, c.professional_id, 'concluido', 'sistema', jsonb_build_object('documento_hash', c.documento_hash, 'versao', c.versao));
  return jsonb_build_object('ok', true, 'status', 'assinado');
end $$;

create or replace function public.obra_contrato_recusar(p_token text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare t jsonb; c public.obra_contratos;
begin
  t := public._oc_do_token(p_token, true);
  if (t ->> 'ok')::boolean is not true then return t; end if;
  select * into c from public.obra_contratos where id = (t ->> 'id')::uuid;
  if c.status <> 'aguardando_cliente' then return public._loc_err('estado_invalido'); end if;
  update public.obra_contratos set status = 'recusado', updated_at = now() where id = c.id;
  perform public._oc_evento(c.id, c.professional_id, 'recusado', 'contratante', jsonb_build_object('motivo', left(p_motivo, 500)));
  return jsonb_build_object('ok', true);
end $$;

-- ════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO: o contrato de obra entra em verificar_hash e verificar_pdf
-- ════════════════════════════════════════════════════════════════
create or replace function public.verificar_hash(p_hash text)
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  d public.document_hashes%rowtype; c public.loc_contratos%rowtype; oc public.obra_contratos%rowtype;
  v_resumo jsonb; v_hash text := lower(btrim(coalesce(p_hash, '')));
begin
  if v_hash = '' then return null; end if;
  select * into d from public.document_hashes where hash = v_hash;
  if found then
    v_resumo := d.conteudo_resumo;
    if v_resumo is not null and jsonb_typeof(v_resumo) = 'object' and v_resumo ? 'client' then
      v_resumo := jsonb_set(v_resumo, '{client}', to_jsonb(private.nome_curto(v_resumo->>'client')));
    end if;
    return jsonb_build_object('hash', d.hash, 'tipo', d.tipo, 'ref_id', d.ref_id, 'created_at', d.created_at, 'conteudo_resumo', v_resumo);
  end if;

  -- v12.11 · contrato de locação
  select * into c from public.loc_contratos where documento_hash = v_hash and status <> 'rascunho' order by versao desc limit 1;
  if found then
    return jsonb_build_object(
      'hash', c.documento_hash, 'tipo', 'contrato_locacao_v2', 'ref_id', null,
      'created_at', coalesce(c.enviado_em, c.created_at),
      'conteudo_resumo', jsonb_build_object(
        'numero', c.numero, 'versao', c.versao, 'situacao', c.status, 'concluido_em', c.concluido_em,
        'locadora', c.dados->'locadora'->>'nome',
        'client', private.nome_curto(c.dados->'cliente'->>'nome'),
        'assinaturas', coalesce((select jsonb_agg(jsonb_build_object('parte', a.parte, 'assinado_em', a.assinado_em) order by a.assinado_em)
                                   from public.loc_contrato_assinaturas a where a.contrato_id = c.id and a.documento_hash = c.documento_hash), '[]'::jsonb),
        'versao_mais_nova', exists (select 1 from public.loc_contratos n where n.grupo_id = c.grupo_id and n.versao > c.versao and n.status <> 'rascunho')));
  end if;

  -- v12.40 · contrato de obra
  select * into oc from public.obra_contratos where documento_hash = v_hash and status <> 'rascunho' order by versao desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'hash', oc.documento_hash, 'tipo', 'contrato_obra', 'ref_id', null,
    'created_at', coalesce(oc.enviado_em, oc.created_at),
    'conteudo_resumo', jsonb_build_object(
      'numero', oc.numero, 'versao', oc.versao, 'situacao', oc.status, 'concluido_em', oc.concluido_em,
      'contratada', oc.dados #>> '{contratada,nome}',
      'client', private.nome_curto(oc.dados #>> '{contratante,nome}'),
      'obra', oc.dados #>> '{obra,titulo}',
      'valor', oc.dados #> '{obra,valor_total}',
      'assinaturas', coalesce((select jsonb_agg(jsonb_build_object('parte', a.parte, 'assinado_em', a.assinado_em) order by a.assinado_em)
                                 from public.obra_contrato_assinaturas a where a.contrato_id = oc.id and a.documento_hash = oc.documento_hash), '[]'::jsonb),
      'versao_mais_nova', exists (select 1 from public.obra_contratos n where n.grupo_id = oc.grupo_id and n.versao > oc.versao and n.status not in ('rascunho','cancelado'))));
end $function$;

create or replace function public.verificar_pdf(p_pdf_hash text)
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
declare v_hash text := lower(btrim(coalesce(p_pdf_hash, ''))); v_doc_hash text; v_doc jsonb;
begin
  if v_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select documento_hash into v_doc_hash from public.loc_contratos where pdf_hash = v_hash and status <> 'rascunho' order by versao desc limit 1;
  if v_doc_hash is null then
    select documento_hash into v_doc_hash from public.obra_contratos where pdf_hash = v_hash and status <> 'rascunho' order by versao desc limit 1;
  end if;
  if v_doc_hash is null then return null; end if;
  v_doc := public.verificar_hash(v_doc_hash);
  if v_doc is null then return null; end if;
  return v_doc || jsonb_build_object('arquivo_identico', true, 'pdf_hash', v_hash);
end $function$;

-- O resumo da obra (relatório do cliente) passa a dizer se há contrato.
create or replace function public.obra_resumo(p_token text default null, p_report_id uuid default null)
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  r public.reports%rowtype; o public.obras%rowtype; itens jsonb; lancado numeric; pago numeric; v_ct jsonb;
begin
  if p_token is not null and length(p_token) >= 16 then
    select * into r from public.reports where rating_token = p_token;
  elsif p_report_id is not null then
    select * into r from public.reports where id = p_report_id and professional_id = auth.uid();
  end if;
  if r.id is null or r.obra_id is null then return null; end if;
  select * into o from public.obras where id = r.obra_id;
  if o.id is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'data',   coalesce(x.service_date, x.created_at::date),
           'titulo', left(coalesce(nullif(btrim(split_part(coalesce(x.service_description,''), E'\n', 1)), ''), x.category_label, 'Etapa'), 90),
           'valor',  coalesce(x.valor, 0),
           'pago',   x.payment_status = 'pago',
           'este',   x.id = r.id
         ) order by coalesce(x.service_date, x.created_at::date), x.created_at), '[]'::jsonb),
         coalesce(sum(x.valor), 0),
         coalesce(sum(x.valor) filter (where x.payment_status = 'pago'), 0)
    into itens, lancado, pago
    from public.reports x
   where x.obra_id = o.id;  -- arquivar só esconde da lista; o valor continua contando

  -- v12.40 · contrato vigente (assinado) ou pendente, sem dado pessoal
  select jsonb_build_object('numero', k.numero, 'versao', k.versao, 'status', k.status,
                            'concluido_em', k.concluido_em, 'documento_hash', k.documento_hash)
    into v_ct
    from public.obra_contratos k
   where k.obra_id = o.id and k.status in ('assinado','aguardando_cliente')
   order by (k.status = 'assinado') desc, k.versao desc
   limit 1;

  return jsonb_build_object(
    'titulo', o.titulo, 'cliente', o.cliente, 'status', o.status,
    'valor_total', o.valor_total, 'lancado', lancado, 'pago', pago,
    'restante', o.valor_total - lancado, 'itens', itens, 'contrato', v_ct);
end $function$;

-- ════════════════════════════════════════════════════════════════
-- PERMISSÕES — fechado por padrão
-- ════════════════════════════════════════════════════════════════
do $$
declare f text;
begin
  foreach f in array array[
    '_oc_guard()', '_oc_evento(uuid,uuid,text,text,jsonb)', '_oc_txt(jsonb,int)', '_oc_snapshot(uuid,uuid)',
    '_oc_merge(jsonb,jsonb)', '_oc_data(text)', '_oc_faltam(jsonb)', '_oc_do_token(text,boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;

  foreach f in array array[
    'obra_contrato_criar(uuid)', 'obra_contrato_salvar(uuid,jsonb)',
    'obra_contrato_enviar(uuid,text,boolean,text,text,text,text,int)', 'obra_contrato_novo_link(uuid,int)',
    'obra_contrato_cancelar(uuid,text)', 'obra_contrato_nova_versao(uuid)', 'obra_contrato_registrar_pdf(uuid,text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;

  foreach f in array array[
    'obra_contrato_por_token(text)', 'obra_contrato_assinar_cliente(text,text,text,boolean,text,text,text,text)',
    'obra_contrato_recusar(text,text)', 'verificar_hash(text)', 'verificar_pdf(text)', 'obra_resumo(text,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
