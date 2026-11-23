-- ============================================================
-- Fieldo Locação · Contratos digitais · PARTE 2 de 2 — funções
-- ------------------------------------------------------------
-- Rodar DEPOIS de 2026-10-19_loc_contratos_01_tabelas.sql.
--
-- Todas as funções públicas são SECURITY DEFINER com search_path fixo.
--  · Funções da locadora: exigem auth.uid() e conferem locadora_id.
--  · Funções do link (anon): identificam o contrato SOMENTE pelo hash
--    do token; o token nunca é gravado.
-- Retorno padrão: jsonb { ok: true, ... } ou { ok: false, error: '<codigo>' }.
-- ============================================================

-- ── Utilitários internos (sem acesso direto pelo app) ───────────
create or replace function public._loc_err(p_code text, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object('ok', false, 'error', p_code) || coalesce(p_extra, '{}'::jsonb)
$$;

create or replace function public._loc_digits(p text) returns text
language sql immutable as $$ select regexp_replace(coalesce(p, ''), '\D', '', 'g') $$;

create or replace function public._loc_sha256(p text) returns text
language sql immutable as $$
  select encode(extensions.digest(convert_to(coalesce(p, ''), 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function public._loc_cpf_valido(p text) returns boolean
language plpgsql immutable as $$
declare d text := public._loc_digits(p); s int := 0; i int; dv int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
  dv := (s * 10) % 11; if dv = 10 then dv := 0; end if;
  if dv <> substr(d, 10, 1)::int then return false; end if;
  s := 0;
  for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
  dv := (s * 10) % 11; if dv = 10 then dv := 0; end if;
  return dv = substr(d, 11, 1)::int;
end $$;

create or replace function public._loc_cnpj_valido(p text) returns boolean
language plpgsql immutable as $$
declare
  d text := public._loc_digits(p);
  w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int := 0; i int; r int;
begin
  if length(d) <> 14 or d ~ '^(\d)\1{13}$' then return false; end if;
  for i in 1..12 loop s := s + substr(d, i, 1)::int * w1[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  if r <> substr(d, 13, 1)::int then return false; end if;
  s := 0;
  for i in 1..13 loop s := s + substr(d, i, 1)::int * w2[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  return r = substr(d, 14, 1)::int;
end $$;

create or replace function public._loc_doc_valido(p text) returns boolean
language sql immutable as $$ select public._loc_cpf_valido(p) or public._loc_cnpj_valido(p) $$;

-- Aceita só PNG de verdade: confere o prefixo, o alfabeto base64 e a assinatura binária do arquivo.
create or replace function public._loc_png_valido(p text) returns boolean
language plpgsql immutable as $$
begin
  if p is null then return true; end if;
  if p !~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$' then return false; end if;
  return substring(decode(substr(p, 23), 'base64') from 1 for 8) = '\x89504e470d0a1a0a'::bytea;
exception when others then
  return false;
end $$;

create or replace function public._loc_ip() returns text
language plpgsql stable as $$
declare h text; j json;
begin
  h := nullif(current_setting('request.headers', true), '');
  if h is null then return null; end if;
  j := h::json;
  return left(nullif(btrim(split_part(coalesce(j->>'cf-connecting-ip', j->>'x-forwarded-for', ''), ',', 1)), ''), 64);
exception when others then
  return null;
end $$;

create or replace function public._loc_evento(
  p_contrato uuid, p_locadora uuid, p_tipo text, p_ator text, p_detalhe jsonb default '{}'::jsonb
) returns void language sql as $$
  insert into public.loc_contrato_eventos (contrato_id, locadora_id, tipo, ator, detalhe)
  values (p_contrato, p_locadora, p_tipo, p_ator, coalesce(p_detalhe, '{}'::jsonb))
$$;

create or replace function public._loc_valida_clausulas(p jsonb) returns boolean
language plpgsql immutable as $$
begin
  if p is null or jsonb_typeof(p) <> 'array' then return false; end if;
  if jsonb_array_length(p) > 60 then return false; end if;
  return not exists (
    select 1 from jsonb_array_elements(p) e
    where jsonb_typeof(e) <> 'object'
       or jsonb_typeof(e->'titulo') is distinct from 'string'
       or jsonb_typeof(e->'texto')  is distinct from 'string'
       or char_length(e->>'titulo') > 200
       or char_length(e->>'texto')  > 8000
  );
end $$;

-- Aplica só campos permitidos (texto, até 2000 caracteres) sobre os dados do rascunho.
create or replace function public._loc_merge_edicao(p_dados jsonb, p_edicao jsonb) returns jsonb
language plpgsql as $$
declare
  v jsonb := p_dados; sec text; k text; val jsonb; permitidos text[];
begin
  if p_edicao is null or jsonb_typeof(p_edicao) <> 'object' then return v; end if;
  foreach sec in array array['cliente','locadora','condicoes','locacao'] loop
    if jsonb_typeof(p_edicao -> sec) = 'object' then
      permitidos := case sec
        when 'cliente'   then array['nome','documento','telefone','email','endereco']
        when 'locadora'  then array['razao_social','documento','endereco','email','whatsapp','representante']
        when 'condicoes' then array['foro','forma_pagamento','multa_atraso','tolerancia_devolucao','local_devolucao','cancelamento']
        else                  array['observacoes','entrega_endereco']
      end;
      for k, val in select key, value from jsonb_each(p_edicao -> sec) loop
        if k = any(permitidos) then
          if jsonb_typeof(val) = 'null' then
            v := jsonb_set(v, array[sec, k], 'null'::jsonb);
          elsif jsonb_typeof(val) = 'string' then
            if char_length(val #>> '{}') > 2000 then raise exception 'campo_muito_longo'; end if;
            v := jsonb_set(v, array[sec, k],
                           coalesce(to_jsonb(nullif(btrim(val #>> '{}'), '')), 'null'::jsonb));
          end if;
        end if;
      end loop;
    end if;
  end loop;
  return v;
end $$;

-- Foto atual da locação + locadora, no formato que vai para o contrato.
create or replace function public._loc_snapshot(p_locacao_id uuid, p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  l public.locacoes; d public.locadoras; v_itens jsonb; v_dias int;
begin
  select * into l from public.locacoes where id = p_locacao_id and locadora_id = p_uid;
  if not found then return jsonb_build_object('erro', 'locacao_nao_encontrada'); end if;
  select * into d from public.locadoras where id = p_uid;
  if not found then return jsonb_build_object('erro', 'locadora_nao_encontrada'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'equipamento_id', i.equipamento_id, 'nome', e.nome, 'marca', e.marca, 'modelo', e.modelo,
           'quantidade', i.quantidade, 'preco_dia', i.preco_dia_aplicado, 'subtotal', i.subtotal
         ) order by i.created_at, i.id), '[]'::jsonb)
    into v_itens
    from public.locacao_itens i
    left join public.equipamentos e on e.id = i.equipamento_id
   where i.locacao_id = l.id;
  if jsonb_array_length(v_itens) = 0 then return jsonb_build_object('erro', 'locacao_sem_itens'); end if;

  v_dias := greatest(1, coalesce(l.data_prevista_devolucao - l.data_saida, 1));

  return jsonb_build_object(
    'origem_hash', md5(concat_ws('|', l.client_name, l.client_doc, l.client_phone, l.client_email,
                       l.data_saida::text, l.data_prevista_devolucao::text,
                       l.valor_total::text, l.caucao_valor::text, l.entrega_endereco, v_itens::text)),
    'dados', jsonb_build_object(
      'locadora', jsonb_build_object(
        'nome', d.nome, 'razao_social', coalesce(d.razao_social, d.nome), 'documento', d.cnpj,
        'endereco', d.endereco, 'cidade', d.city, 'uf', d.uf, 'email', d.email,
        'whatsapp', d.whatsapp, 'representante', null),
      'cliente', jsonb_build_object(
        'nome', l.client_name, 'documento', l.client_doc, 'telefone', l.client_phone,
        'email', l.client_email, 'endereco', null),
      'locacao', jsonb_build_object(
        'data_saida', l.data_saida, 'data_prevista_devolucao', l.data_prevista_devolucao,
        'diarias', v_dias, 'valor_total', l.valor_total, 'caucao_valor', l.caucao_valor,
        'entrega_endereco', l.entrega_endereco, 'observacoes', l.observacoes),
      'itens', v_itens,
      'condicoes', jsonb_build_object(
        'foro', null, 'forma_pagamento', null, 'multa_atraso', null,
        'tolerancia_devolucao', null, 'local_devolucao', null, 'cancelamento', null)
    )
  );
end $$;

-- Atualiza itens/valores/datas/partes a partir da locação, preservando o que o usuário completou.
create or replace function public._loc_resync(p_antigo jsonb, p_locacao_id uuid, p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_snap jsonb; v_new jsonb;
begin
  v_snap := public._loc_snapshot(p_locacao_id, p_uid);
  if v_snap ? 'erro' then return v_snap; end if;
  v_new := v_snap -> 'dados';
  v_new := jsonb_set(v_new, '{condicoes}', coalesce(p_antigo -> 'condicoes', v_new -> 'condicoes'));
  v_new := jsonb_set(v_new, '{cliente,endereco}', coalesce(p_antigo #> '{cliente,endereco}', 'null'::jsonb));
  v_new := jsonb_set(v_new, '{locadora,representante}', coalesce(p_antigo #> '{locadora,representante}', 'null'::jsonb));
  return jsonb_build_object('dados', v_new, 'origem_hash', v_snap ->> 'origem_hash');
end $$;

-- Define o estado depois de uma assinatura. Chamada com a linha do contrato já travada.
create or replace function public._loc_apos_assinatura(p_contrato uuid) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  c public.loc_contratos; v_loc boolean; v_cli boolean; v_novo text;
begin
  select * into c from public.loc_contratos where id = p_contrato;
  select exists (select 1 from public.loc_contrato_assinaturas where contrato_id = p_contrato and parte = 'locadora') into v_loc;
  select exists (select 1 from public.loc_contrato_assinaturas where contrato_id = p_contrato and parte = 'locatario') into v_cli;

  if v_loc and v_cli then
    -- uma versão anterior assinada deixa de valer quando esta conclui
    with s as (
      update public.loc_contratos
         set status = 'substituido', revogado_em = coalesce(revogado_em, now()),
             substituido_por = c.id, updated_at = now()
       where grupo_id = c.grupo_id and id <> c.id and status = 'assinado'
       returning id, locadora_id)
    insert into public.loc_contrato_eventos (contrato_id, locadora_id, tipo, ator, detalhe)
    select id, locadora_id, 'substituido', 'sistema', jsonb_build_object('por', c.id) from s;
    v_novo := 'assinado';
    update public.loc_contratos set status = 'assinado', concluido_em = now(), updated_at = now() where id = c.id;
    perform public._loc_evento(c.id, c.locadora_id, 'concluido', 'sistema',
                               jsonb_build_object('documento_hash', c.documento_hash, 'versao', c.versao));
  elsif v_cli then
    v_novo := 'aguardando_locadora';
  else
    v_novo := 'aguardando_cliente';
  end if;

  if v_novo <> 'assinado' and v_novo <> c.status then
    update public.loc_contratos set status = v_novo, updated_at = now() where id = c.id;
  end if;
  return v_novo;
end $$;

-- Valida o token e devolve a linha travada ou o código de erro.
create or replace function public._loc_contrato_do_token(p_token text, p_travar boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare c public.loc_contratos; h text;
begin
  if p_token is null or char_length(p_token) < 20 or char_length(p_token) > 200 then
    return public._loc_err('nao_encontrado');
  end if;
  h := public._loc_sha256(p_token);
  if p_travar then
    select * into c from public.loc_contratos where token_hash = h for update;
  else
    select * into c from public.loc_contratos where token_hash = h;
  end if;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.revogado_em is not null and c.status not in ('substituido','cancelado') then
    return public._loc_err('revogado');
  end if;
  if c.status = 'cancelado'  then return public._loc_err('cancelado'); end if;
  if c.status = 'substituido' then return public._loc_err('substituido'); end if;
  if c.token_expira_em is not null and c.token_expira_em < now() then
    return public._loc_err('expirado');
  end if;
  return jsonb_build_object('ok', true, 'id', c.id);
end $$;

-- ════════════════════════════════════════════════════════════
-- LOCADORA — criar / editar / enviar
-- ════════════════════════════════════════════════════════════

create or replace function public.loc_contrato_criar(p_locacao_id uuid, p_clausulas jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_loc public.locacoes; v_snap jsonb; v_dados jsonb; v_clausulas jsonb := '[]'::jsonb;
  v_modelo public.loc_contrato_modelos; v_existente uuid;
  v_ano int; v_seq int; v_numero text; v_id uuid := gen_random_uuid();
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  perform pg_advisory_xact_lock(hashtextextended('loc_contrato:' || v_uid::text, 0));

  select * into v_loc from public.locacoes where id = p_locacao_id and locadora_id = v_uid;
  if not found then return public._loc_err('locacao_nao_encontrada'); end if;
  if v_loc.status = 'cancelada' then return public._loc_err('locacao_cancelada'); end if;

  select id into v_existente from public.loc_contratos
   where locacao_id = p_locacao_id
     and status in ('rascunho','aguardando_cliente','aguardando_locadora','assinado')
   order by created_at desc limit 1;
  if found then return public._loc_err('ja_existe', jsonb_build_object('contrato_id', v_existente)); end if;

  v_snap := public._loc_snapshot(p_locacao_id, v_uid);
  if v_snap ? 'erro' then return public._loc_err(v_snap ->> 'erro'); end if;
  v_dados := v_snap -> 'dados';

  select * into v_modelo from public.loc_contrato_modelos where locadora_id = v_uid;
  if found then
    v_dados := public._loc_merge_edicao(v_dados, jsonb_build_object('condicoes', v_modelo.condicoes));
    if jsonb_array_length(v_modelo.clausulas) > 0 then v_clausulas := v_modelo.clausulas; end if;
  end if;
  if jsonb_array_length(v_clausulas) = 0 and p_clausulas is not null then
    if not public._loc_valida_clausulas(p_clausulas) then return public._loc_err('clausulas_invalidas'); end if;
    v_clausulas := p_clausulas;
  end if;

  v_ano := extract(year from (now() at time zone 'America/Sao_Paulo'))::int;
  select coalesce(max(seq), 0) + 1 into v_seq from public.loc_contratos where locadora_id = v_uid and ano = v_ano;
  v_numero := 'LOC-' || v_ano || '-' || lpad(v_seq::text, 4, '0');

  insert into public.loc_contratos
    (id, locadora_id, locacao_id, grupo_id, ano, seq, numero, versao, status, dados, clausulas, origem_hash)
  values
    (v_id, v_uid, p_locacao_id, v_id, v_ano, v_seq, v_numero, 1, 'rascunho', v_dados, v_clausulas, v_snap ->> 'origem_hash');

  perform public._loc_evento(v_id, v_uid, 'criado', 'locadora', jsonb_build_object('numero', v_numero));
  return jsonb_build_object('ok', true, 'contrato_id', v_id, 'numero', v_numero);
exception when unique_violation then
  return public._loc_err('ja_existe');
end $$;

create or replace function public.loc_contrato_salvar(
  p_id uuid, p_edicao jsonb default '{}'::jsonb, p_clausulas jsonb default null, p_resync boolean default false
) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid(); c public.loc_contratos;
  v_dados jsonb; v_origem text; v_clausulas jsonb; r jsonb;
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  select * into c from public.loc_contratos where id = p_id and locadora_id = v_uid for update;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.status <> 'rascunho' then return public._loc_err('nao_editavel'); end if;

  v_dados := c.dados; v_origem := c.origem_hash; v_clausulas := c.clausulas;

  if p_resync then
    r := public._loc_resync(c.dados, c.locacao_id, v_uid);
    if r ? 'erro' then return public._loc_err(r ->> 'erro'); end if;
    v_dados := r -> 'dados'; v_origem := r ->> 'origem_hash';
  end if;

  v_dados := public._loc_merge_edicao(v_dados, p_edicao);

  if p_clausulas is not null then
    if not public._loc_valida_clausulas(p_clausulas) then return public._loc_err('clausulas_invalidas'); end if;
    v_clausulas := p_clausulas;
  end if;

  update public.loc_contratos
     set dados = v_dados, clausulas = v_clausulas, origem_hash = v_origem, updated_at = now()
   where id = c.id;
  perform public._loc_evento(c.id, v_uid, 'rascunho_salvo', 'locadora', jsonb_build_object('resync', p_resync));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.loc_contrato_enviar(p_id uuid, p_texto text, p_validade_dias int default 7)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid(); c public.loc_contratos; v_loc_status text; v_snap jsonb;
  v_faltam text[] := '{}'; v_token text; v_hash text; v_expira timestamptz;
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  select * into c from public.loc_contratos where id = p_id and locadora_id = v_uid for update;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.status <> 'rascunho' then return public._loc_err('nao_editavel'); end if;
  if p_validade_dias is null or p_validade_dias < 1 or p_validade_dias > 30 then
    return public._loc_err('validade_invalida');
  end if;
  if p_texto is null or char_length(p_texto) < 200 or char_length(p_texto) > 300000
     or position(c.numero in p_texto) = 0 then
    return public._loc_err('texto_invalido');
  end if;

  select status into v_loc_status from public.locacoes where id = c.locacao_id and locadora_id = v_uid;
  if v_loc_status is null then return public._loc_err('locacao_nao_encontrada'); end if;
  if v_loc_status = 'cancelada' then return public._loc_err('locacao_cancelada'); end if;

  v_snap := public._loc_snapshot(c.locacao_id, v_uid);
  if v_snap ? 'erro' then return public._loc_err(v_snap ->> 'erro'); end if;
  if (v_snap ->> 'origem_hash') is distinct from c.origem_hash then
    return public._loc_err('locacao_mudou');
  end if;

  if char_length(btrim(coalesce(c.dados #>> '{cliente,nome}', ''))) < 3 then v_faltam := array_append(v_faltam, 'cliente.nome'); end if;
  if not public._loc_doc_valido(c.dados #>> '{cliente,documento}') then v_faltam := array_append(v_faltam, 'cliente.documento'); end if;
  if length(public._loc_digits(c.dados #>> '{cliente,telefone}')) < 10 then v_faltam := array_append(v_faltam, 'cliente.telefone'); end if;
  if char_length(btrim(coalesce(c.dados #>> '{locadora,razao_social}', c.dados #>> '{locadora,nome}', ''))) < 2 then v_faltam := array_append(v_faltam, 'locadora.razao_social'); end if;
  if not public._loc_doc_valido(c.dados #>> '{locadora,documento}') then v_faltam := array_append(v_faltam, 'locadora.documento'); end if;
  if c.dados #>> '{locacao,data_saida}' is null or c.dados #>> '{locacao,data_prevista_devolucao}' is null then v_faltam := array_append(v_faltam, 'locacao.datas'); end if;
  if jsonb_array_length(coalesce(c.dados -> 'itens', '[]'::jsonb)) = 0 then v_faltam := array_append(v_faltam, 'itens'); end if;
  if array_length(v_faltam, 1) is not null then
    return public._loc_err('campos_invalidos', jsonb_build_object('campos', to_jsonb(v_faltam)));
  end if;

  -- versões pendentes anteriores deixam de valer
  with s as (
    update public.loc_contratos
       set status = 'substituido', revogado_em = coalesce(revogado_em, now()),
           substituido_por = c.id, updated_at = now()
     where grupo_id = c.grupo_id and id <> c.id and status in ('aguardando_cliente','aguardando_locadora')
     returning id, locadora_id)
  insert into public.loc_contrato_eventos (contrato_id, locadora_id, tipo, ator, detalhe)
  select id, locadora_id, 'substituido', 'sistema', jsonb_build_object('por', c.id) from s;

  v_token  := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_hash   := public._loc_sha256(p_texto);
  v_expira := now() + make_interval(days => p_validade_dias);

  update public.loc_contratos
     set status = 'aguardando_cliente', documento_texto = p_texto, documento_hash = v_hash,
         token_hash = public._loc_sha256(v_token), token_expira_em = v_expira, revogado_em = null,
         enviado_em = now(), updated_at = now()
   where id = c.id;

  perform public._loc_evento(c.id, v_uid, 'enviado', 'locadora',
            jsonb_build_object('documento_hash', v_hash, 'versao', c.versao, 'validade_dias', p_validade_dias));
  return jsonb_build_object('ok', true, 'token', v_token, 'documento_hash', v_hash,
                            'token_expira_em', v_expira, 'status', 'aguardando_cliente');
end $$;

create or replace function public.loc_contrato_novo_link(p_id uuid, p_validade_dias int default 7)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid(); c public.loc_contratos; v_token text; v_expira timestamptz;
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  select * into c from public.loc_contratos where id = p_id and locadora_id = v_uid for update;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.status not in ('aguardando_cliente','aguardando_locadora') then return public._loc_err('estado_invalido'); end if;
  if p_validade_dias is null or p_validade_dias < 1 or p_validade_dias > 30 then return public._loc_err('validade_invalida'); end if;
  v_token  := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_expira := now() + make_interval(days => p_validade_dias);
  update public.loc_contratos
     set token_hash = public._loc_sha256(v_token), token_expira_em = v_expira, revogado_em = null, updated_at = now()
   where id = c.id;
  perform public._loc_evento(c.id, v_uid, 'link_gerado', 'locadora', jsonb_build_object('validade_dias', p_validade_dias));
  return jsonb_build_object('ok', true, 'token', v_token, 'token_expira_em', v_expira);
end $$;

create or replace function public.loc_contrato_revogar_link(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_uid uuid := auth.uid(); c public.loc_contratos;
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  select * into c from public.loc_contratos where id = p_id and locadora_id = v_uid for update;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.status not in ('aguardando_cliente','aguardando_locadora') then return public._loc_err('estado_invalido'); end if;
  update public.loc_contratos set revogado_em = now(), updated_at = now() where id = c.id;
  perform public._loc_evento(c.id, v_uid, 'link_revogado', 'locadora');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.loc_contrato_cancelar(p_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_uid uuid := auth.uid(); c public.loc_contratos;
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  select * into c from public.loc_contratos where id = p_id and locadora_id = v_uid for update;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.status not in ('rascunho','aguardando_cliente','aguardando_locadora') then
    return public._loc_err('estado_invalido');
  end if;
  update public.loc_contratos
     set status = 'cancelado', revogado_em = coalesce(revogado_em, now()), updated_at = now()
   where id = c.id;
  perform public._loc_evento(c.id, v_uid, 'cancelado', 'locadora', jsonb_build_object('motivo', left(p_motivo, 500)));
  return jsonb_build_object('ok', true);
end $$;

-- Cria uma nova versão (rascunho) a partir de uma existente. A anterior só é
-- marcada como substituída quando a nova for enviada ou concluída.
create or replace function public.loc_contrato_nova_versao(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid(); c public.loc_contratos; v_rasc uuid; v_ult int;
  v_loc_status text; r jsonb; v_id uuid := gen_random_uuid();
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  perform pg_advisory_xact_lock(hashtextextended('loc_contrato:' || v_uid::text, 0));
  select * into c from public.loc_contratos where id = p_id and locadora_id = v_uid for update;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.status not in ('aguardando_cliente','aguardando_locadora','assinado','recusado','cancelado') then
    return public._loc_err('estado_invalido');
  end if;

  select id into v_rasc from public.loc_contratos where grupo_id = c.grupo_id and status = 'rascunho' limit 1;
  if found then return public._loc_err('ja_existe_rascunho', jsonb_build_object('contrato_id', v_rasc)); end if;

  select status into v_loc_status from public.locacoes where id = c.locacao_id and locadora_id = v_uid;
  if v_loc_status is null then return public._loc_err('locacao_nao_encontrada'); end if;
  if v_loc_status = 'cancelada' then return public._loc_err('locacao_cancelada'); end if;

  r := public._loc_resync(c.dados, c.locacao_id, v_uid);
  if r ? 'erro' then return public._loc_err(r ->> 'erro'); end if;

  select max(versao) into v_ult from public.loc_contratos where grupo_id = c.grupo_id;
  insert into public.loc_contratos
    (id, locadora_id, locacao_id, grupo_id, ano, seq, numero, versao, status, dados, clausulas, origem_hash)
  values
    (v_id, v_uid, c.locacao_id, c.grupo_id, c.ano, c.seq, c.numero, v_ult + 1, 'rascunho',
     r -> 'dados', c.clausulas, r ->> 'origem_hash');

  perform public._loc_evento(v_id, v_uid, 'nova_versao', 'locadora',
            jsonb_build_object('a_partir_de', c.id, 'versao', v_ult + 1));
  return jsonb_build_object('ok', true, 'contrato_id', v_id, 'versao', v_ult + 1);
end $$;

create or replace function public.loc_contrato_modelo_salvar(p_clausulas jsonb, p_condicoes jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_uid uuid := auth.uid(); v_cond jsonb := '{}'::jsonb; k text; val jsonb;
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  if not public._loc_valida_clausulas(coalesce(p_clausulas, '[]'::jsonb)) then
    return public._loc_err('clausulas_invalidas');
  end if;
  if p_condicoes is not null and jsonb_typeof(p_condicoes) = 'object' then
    for k, val in select key, value from jsonb_each(p_condicoes) loop
      if k = any(array['foro','forma_pagamento','multa_atraso','tolerancia_devolucao','local_devolucao','cancelamento'])
         and jsonb_typeof(val) = 'string' and char_length(val #>> '{}') <= 2000 then
        v_cond := v_cond || jsonb_build_object(k, val);
      end if;
    end loop;
  end if;
  insert into public.loc_contrato_modelos (locadora_id, clausulas, condicoes, updated_at)
  values (v_uid, coalesce(p_clausulas, '[]'::jsonb), v_cond, now())
  on conflict (locadora_id) do update
    set clausulas = excluded.clausulas, condicoes = excluded.condicoes, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- ════════════════════════════════════════════════════════════
-- ASSINATURA
-- ════════════════════════════════════════════════════════════

create or replace function public.loc_contrato_assinar_locadora(
  p_id uuid, p_aceite boolean, p_aceite_versao text, p_aceite_texto text,
  p_traco text default null, p_user_agent text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid(); c public.loc_contratos; v_nome text; v_status text;
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  select * into c from public.loc_contratos where id = p_id and locadora_id = v_uid for update;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.status not in ('aguardando_cliente','aguardando_locadora') then return public._loc_err('estado_invalido'); end if;
  if p_aceite is not true then return public._loc_err('aceite_obrigatorio'); end if;
  if coalesce(char_length(p_aceite_versao), 0) < 3 or coalesce(char_length(p_aceite_texto), 0) < 20
     or char_length(p_aceite_texto) > 1000 then
    return public._loc_err('aceite_invalido');
  end if;
  if p_traco is not null and (char_length(p_traco) > 120000 or not public._loc_png_valido(p_traco)) then
    return public._loc_err('traco_invalido');
  end if;
  if exists (select 1 from public.loc_contrato_assinaturas where contrato_id = c.id and parte = 'locadora') then
    return public._loc_err('ja_assinado');
  end if;

  v_nome := coalesce(nullif(btrim(c.dados #>> '{locadora,representante}'), ''),
                     nullif(btrim(c.dados #>> '{locadora,razao_social}'), ''),
                     c.dados #>> '{locadora,nome}');
  insert into public.loc_contrato_assinaturas
    (contrato_id, locadora_id, parte, nome, documento, aceite_versao, aceite_texto,
     documento_hash, traco_png, ip, user_agent)
  values
    (c.id, v_uid, 'locadora', left(v_nome, 200), c.dados #>> '{locadora,documento}', p_aceite_versao, p_aceite_texto,
     c.documento_hash, p_traco, public._loc_ip(), left(p_user_agent, 400));

  v_status := public._loc_apos_assinatura(c.id);
  perform public._loc_evento(c.id, v_uid, 'assinado_locadora', 'locadora',
            jsonb_build_object('documento_hash', c.documento_hash));
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

create or replace function public.loc_contrato_assinar_cliente(
  p_token text, p_nome text, p_documento text, p_aceite boolean, p_aceite_versao text,
  p_aceite_texto text, p_traco text default null, p_user_agent text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  t jsonb; c public.loc_contratos; v_status text; v_tent int;
begin
  t := public._loc_contrato_do_token(p_token, true);
  if (t ->> 'ok')::boolean is not true then return t; end if;
  select * into c from public.loc_contratos where id = (t ->> 'id')::uuid;

  if c.status = 'assinado' then return public._loc_err('ja_assinado'); end if;
  if c.status = 'recusado' then return public._loc_err('recusado'); end if;
  if c.status not in ('aguardando_cliente','aguardando_locadora') then return public._loc_err('estado_invalido'); end if;
  if exists (select 1 from public.loc_contrato_assinaturas where contrato_id = c.id and parte = 'locatario') then
    return public._loc_err('ja_assinado');
  end if;

  select count(*) into v_tent from public.loc_contrato_eventos
   where contrato_id = c.id and tipo = 'tentativa_invalida' and created_at > now() - interval '1 hour';
  if v_tent >= 8 then return public._loc_err('muitas_tentativas'); end if;

  if p_aceite is not true then return public._loc_err('aceite_obrigatorio'); end if;
  if coalesce(char_length(p_aceite_versao), 0) < 3 or coalesce(char_length(p_aceite_texto), 0) < 20
     or char_length(p_aceite_texto) > 1000 then
    return public._loc_err('aceite_invalido');
  end if;
  if char_length(btrim(coalesce(p_nome, ''))) < 3 or char_length(p_nome) > 200 then
    return public._loc_err('nome_invalido');
  end if;
  if p_traco is not null and (char_length(p_traco) > 120000 or not public._loc_png_valido(p_traco)) then
    return public._loc_err('traco_invalido');
  end if;

  if public._loc_digits(p_documento) is distinct from public._loc_digits(c.dados #>> '{cliente,documento}') then
    perform public._loc_evento(c.id, c.locadora_id, 'tentativa_invalida', 'locatario', jsonb_build_object('motivo', 'documento'));
    return public._loc_err('documento_nao_confere');
  end if;

  insert into public.loc_contrato_assinaturas
    (contrato_id, locadora_id, parte, nome, documento, aceite_versao, aceite_texto,
     documento_hash, traco_png, ip, user_agent)
  values
    (c.id, c.locadora_id, 'locatario', btrim(p_nome), btrim(p_documento), p_aceite_versao, p_aceite_texto,
     c.documento_hash, p_traco, public._loc_ip(), left(p_user_agent, 400));

  v_status := public._loc_apos_assinatura(c.id);
  perform public._loc_evento(c.id, c.locadora_id, 'assinado_locatario', 'locatario',
            jsonb_build_object('documento_hash', c.documento_hash));
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

create or replace function public.loc_contrato_recusar(p_token text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare t jsonb; c public.loc_contratos;
begin
  t := public._loc_contrato_do_token(p_token, true);
  if (t ->> 'ok')::boolean is not true then return t; end if;
  select * into c from public.loc_contratos where id = (t ->> 'id')::uuid;
  if c.status not in ('aguardando_cliente','aguardando_locadora') then return public._loc_err('estado_invalido'); end if;
  if exists (select 1 from public.loc_contrato_assinaturas where contrato_id = c.id and parte = 'locatario') then
    return public._loc_err('ja_assinado');
  end if;
  update public.loc_contratos set status = 'recusado', updated_at = now() where id = c.id;
  perform public._loc_evento(c.id, c.locadora_id, 'recusado', 'locatario', jsonb_build_object('motivo', left(p_motivo, 500)));
  return jsonb_build_object('ok', true);
end $$;

-- Leitura pública pelo token. Só devolve o necessário para ler e assinar.
create or replace function public.loc_contrato_por_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  t jsonb; c public.loc_contratos; v_cli_ja boolean; v_ass jsonb; v_doc text; v_dica text;
begin
  t := public._loc_contrato_do_token(p_token, false);
  if (t ->> 'ok')::boolean is not true then return t; end if;
  select * into c from public.loc_contratos where id = (t ->> 'id')::uuid;

  if c.status = 'recusado' then return public._loc_err('recusado'); end if;
  if c.status = 'rascunho' then return public._loc_err('nao_encontrado'); end if;

  select exists (select 1 from public.loc_contrato_assinaturas where contrato_id = c.id and parte = 'locatario') into v_cli_ja;

  select coalesce(jsonb_agg(
           jsonb_build_object('parte', a.parte, 'nome', a.nome, 'assinado_em', a.assinado_em,
                              'documento_hash', a.documento_hash, 'aceite_versao', a.aceite_versao)
           || case when c.status = 'assinado'
                then jsonb_build_object('documento', a.documento, 'ip', a.ip, 'user_agent', a.user_agent,
                                        'traco_png', a.traco_png, 'aceite_texto', a.aceite_texto)
                else '{}'::jsonb end
           order by a.assinado_em), '[]'::jsonb)
    into v_ass
    from public.loc_contrato_assinaturas a where a.contrato_id = c.id;

  v_doc  := public._loc_digits(c.dados #>> '{cliente,documento}');
  v_dica := case when length(v_doc) >= 4 then 'final ' || right(v_doc, 4) else null end;

  if not exists (select 1 from public.loc_contrato_eventos
                  where contrato_id = c.id and tipo = 'visualizado' and ator = 'locatario') then
    perform public._loc_evento(c.id, c.locadora_id, 'visualizado', 'locatario', jsonb_build_object('versao', c.versao));
  end if;

  return jsonb_build_object(
    'ok', true,
    'contrato', jsonb_build_object(
      'numero', c.numero, 'versao', c.versao, 'status', c.status,
      'documento_texto', c.documento_texto, 'documento_hash', c.documento_hash,
      'enviado_em', c.enviado_em, 'concluido_em', c.concluido_em, 'token_expira_em', c.token_expira_em),
    'resumo', jsonb_build_object(
      'locadora', coalesce(c.dados #>> '{locadora,razao_social}', c.dados #>> '{locadora,nome}'),
      'cliente', c.dados #>> '{cliente,nome}',
      'documento_dica', v_dica,
      'valor_total', c.dados #> '{locacao,valor_total}',
      'data_saida', c.dados #>> '{locacao,data_saida}',
      'data_prevista_devolucao', c.dados #>> '{locacao,data_prevista_devolucao}'),
    'assinaturas', v_ass,
    'pode_assinar', (c.status = 'aguardando_cliente' and not v_cli_ja)
  );
end $$;

create or replace function public.loc_contrato_registrar_pdf(p_id uuid, p_path text, p_hash text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_uid uuid := auth.uid(); c public.loc_contratos;
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  select * into c from public.loc_contratos where id = p_id and locadora_id = v_uid for update;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.status <> 'assinado' then return public._loc_err('estado_invalido'); end if;
  if c.pdf_path is not null then return public._loc_err('pdf_ja_registrado'); end if;
  if p_path is null or p_path not like v_uid::text || '/' || c.id::text || '/%' or p_path not like '%.pdf'
     or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    return public._loc_err('pdf_invalido');
  end if;
  update public.loc_contratos set pdf_path = p_path, pdf_hash = p_hash, updated_at = now() where id = c.id;
  perform public._loc_evento(c.id, v_uid, 'pdf_arquivado', 'locadora', jsonb_build_object('pdf_hash', p_hash));
  return jsonb_build_object('ok', true);
end $$;

-- ════════════════════════════════════════════════════════════
-- PERMISSÕES — fechado por padrão, abre só o que precisa
-- ════════════════════════════════════════════════════════════
do $$
declare f text;
begin
  -- internas: ninguém chama pelo app
  foreach f in array array[
    '_loc_err(text,jsonb)','_loc_digits(text)','_loc_sha256(text)','_loc_cpf_valido(text)',
    '_loc_cnpj_valido(text)','_loc_doc_valido(text)','_loc_png_valido(text)','_loc_ip()','_loc_evento(uuid,uuid,text,text,jsonb)',
    '_loc_valida_clausulas(jsonb)','_loc_merge_edicao(jsonb,jsonb)','_loc_snapshot(uuid,uuid)',
    '_loc_resync(jsonb,uuid,uuid)','_loc_apos_assinatura(uuid)','_loc_contrato_do_token(text,boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;

  -- locadora (sessão autenticada)
  foreach f in array array[
    'loc_contrato_criar(uuid,jsonb)','loc_contrato_salvar(uuid,jsonb,jsonb,boolean)',
    'loc_contrato_enviar(uuid,text,int)','loc_contrato_novo_link(uuid,int)',
    'loc_contrato_revogar_link(uuid)','loc_contrato_cancelar(uuid,text)',
    'loc_contrato_nova_versao(uuid)','loc_contrato_modelo_salvar(jsonb,jsonb)',
    'loc_contrato_assinar_locadora(uuid,boolean,text,text,text,text)',
    'loc_contrato_registrar_pdf(uuid,text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;

  -- cliente (link público)
  foreach f in array array[
    'loc_contrato_por_token(text)','loc_contrato_assinar_cliente(text,text,text,boolean,text,text,text,text)',
    'loc_contrato_recusar(text,text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
