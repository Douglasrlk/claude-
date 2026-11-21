-- Fieldo · baseline extraída do catálogo de produção (projeto jrsctnncoljdcvdofxsg, PG 17)
-- Gerado em 2026-11-21. NÃO editar à mão: regenerar a partir do banco.
-- Parte: funções (public, private, gestao)

SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION gestao.criar_empresa(p_name text, p_type text DEFAULT 'condominio'::text, p_doc text DEFAULT NULL::text, p_full_name text DEFAULT NULL::text)
 RETURNS gestao.companies
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'gestao', 'public', 'pg_temp'
AS $function$
declare
  v_uid     uuid := (select auth.uid());
  v_company gestao.companies;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  if not private.gestao_is_corporate() then
    raise exception 'conta_anonima_nao_permitida' using errcode = '42501';
  end if;

  /* MVP: 1 empresa ativa por usuário. Também protege contra duplo clique e
     retry de rede — a 2ª chamada falha em vez de duplicar. Restrição
     deliberada: relaxar depois é migração trivial, limpar duplicatas não. */
  if exists (select 1 from gestao.company_users where user_id = v_uid and is_active) then
    raise exception 'usuario_ja_vinculado' using errcode = '23505';
  end if;

  insert into gestao.companies (name, type, doc, created_by)
       values (btrim(p_name),
               coalesce(nullif(btrim(p_type), ''), 'condominio'),
               nullif(btrim(p_doc), ''),
               v_uid)
    returning * into v_company;

  insert into gestao.company_users (company_id, user_id, role, full_name)
       values (v_company.id, v_uid, 'owner', nullif(btrim(p_full_name), ''));

  return v_company;
end $function$
;

CREATE OR REPLACE FUNCTION gestao.meu_contexto()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'gestao', 'public', 'pg_temp'
AS $function$
  select coalesce(
    (select json_build_object(
              'company', json_build_object(
                'id', c.id, 'name', c.name, 'type', c.type,
                'city', c.city, 'uf', c.uf),
              'role', cu.role,
              'full_name', cu.full_name)
       from gestao.company_users cu
       join gestao.companies     c on c.id = cu.company_id
      where cu.user_id = (select auth.uid())
        and cu.is_active and c.is_active
      order by cu.created_at
      limit 1),
    json_build_object('company', null, 'role', null, 'full_name', null));
$function$
;

CREATE OR REPLACE FUNCTION gestao.tg_protege_ultimo_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'gestao', 'public', 'pg_temp'
AS $function$
declare v_outros int;
begin
  if tg_op = 'UPDATE' and not (old.role = 'owner' and old.is_active) then return new; end if;
  if tg_op = 'UPDATE' and new.role = 'owner' and new.is_active       then return new; end if;
  if tg_op = 'DELETE' and not (old.role = 'owner' and old.is_active) then return old; end if;

  select count(*) into v_outros from gestao.company_users
   where company_id = old.company_id and id <> old.id and role = 'owner' and is_active;

  if v_outros = 0 then
    raise exception 'A empresa ficaria sem nenhum responsável ativo.'
      using errcode = 'raise_exception',
            hint = 'Promova outro membro a owner antes de remover este.';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end $function$
;

CREATE OR REPLACE FUNCTION private.aceites_imutavel()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
                                                                begin
                                                                  if current_setting('request.jwt.claims', true) is not null
                                                                       and current_setting('request.jwt.claims', true) <> '' then
                                                                           raise exception 'aceite_imutavel' using errcode = '42501';
                                                                             end if;
                                                                               return case when tg_op = 'DELETE' then old else new end;
                                                                               end
                                                                               $function$
;

CREATE OR REPLACE FUNCTION private.chamada_de_usuario()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(auth.role(), '') in ('anon', 'authenticated')
        or current_user in ('anon', 'authenticated');
        $function$
;

CREATE OR REPLACE FUNCTION private.doc_normalizado(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g'));
$function$
;

CREATE OR REPLACE FUNCTION private.documento_valido(p text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  d      text := private.doc_normalizado(p);
  s      int;
  r      int;
  i      int;
  pesos1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  pesos2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
begin
  if d ~ '^[0-9]{11}$' then
    if d = repeat(substr(d, 1, 1), 11) then return false; end if;
    s := 0;
    for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    if r <> substr(d, 10, 1)::int then return false; end if;
    s := 0;
    for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    return r = substr(d, 11, 1)::int;
  end if;

  if d ~ '^[0-9A-Z]{12}[0-9]{2}$' then
    if d = repeat(substr(d, 1, 1), 14) then return false; end if;
    s := 0;
    for i in 1..12 loop s := s + (ascii(substr(d, i, 1)) - 48) * pesos1[i]; end loop;
    r := s % 11;
    if (case when r < 2 then 0 else 11 - r end) <> substr(d, 13, 1)::int then return false; end if;
    s := 0;
    for i in 1..13 loop s := s + (ascii(substr(d, i, 1)) - 48) * pesos2[i]; end loop;
    r := s % 11;
    return (case when r < 2 then 0 else 11 - r end) = substr(d, 14, 1)::int;
  end if;

  return false;
end $function$
;

CREATE OR REPLACE FUNCTION private.gestao_company_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select cu.company_id
    from gestao.company_users cu
    join gestao.companies     c on c.id = cu.company_id
   where cu.user_id = (select auth.uid())
     and cu.is_active and c.is_active
     and private.gestao_is_corporate();
$function$
;

CREATE OR REPLACE FUNCTION private.gestao_is_admin(p_company uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from gestao.company_users cu
      join gestao.companies c on c.id = cu.company_id
     where cu.company_id = p_company
       and cu.user_id = (select auth.uid())
       and cu.role in ('owner','admin')
       and cu.is_active and c.is_active
       and private.gestao_is_corporate());
$function$
;

CREATE OR REPLACE FUNCTION private.gestao_is_corporate()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select (select auth.uid()) is not null
     and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false;
$function$
;

CREATE OR REPLACE FUNCTION private.ip_da_requisicao()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
                                        $function$
;

CREATE OR REPLACE FUNCTION private.is_pro(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.professionals
    where id = uid and plan = 'pro'
      and (plan_expires_at is null or plan_expires_at > now())
  );
$function$
;

CREATE OR REPLACE FUNCTION private.midia_inicio_mes()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select (date_trunc('month', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
$function$
;

CREATE OR REPLACE FUNCTION private.midia_reservar(p_prof uuid, p_modulo text, p_unidades integer, p_ref text, p_custo_centavos integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_sit jsonb;
begin
  if p_unidades is null or p_unidades < 1 then
    return jsonb_build_object('ok', false, 'error', 'unidades_invalidas');
  end if;
  perform pg_advisory_xact_lock(hashtext('midia:' || p_prof::text || ':' || p_modulo));
  v_sit := private.midia_situacao(p_prof, p_modulo);
  if (v_sit->>'limite') is not null and (v_sit->>'usado')::int + p_unidades > (v_sit->>'limite')::int then
    return jsonb_build_object('ok', false, 'error', 'cota_esgotada', 'cota', v_sit);
  end if;
  insert into public.midia_uso (professional_id, modulo, unidades, custo_centavos, ref)
  values (p_prof, p_modulo, p_unidades, coalesce(p_custo_centavos, 0), left(p_ref, 80));
  return jsonb_build_object('ok', true, 'cota', private.midia_situacao(p_prof, p_modulo));
end $function$
;

CREATE OR REPLACE FUNCTION private.midia_situacao(p_prof uuid, p_modulo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_plano  text := case when private.is_pro(p_prof) then 'pro' else 'free' end;
  v_limite integer;
  v_usado  integer;
  v_ini    timestamptz := private.midia_inicio_mes();
begin
  select limite_mes into v_limite from public.midia_cotas where plano = v_plano and modulo = p_modulo;
  if not found then v_limite := 0; end if;   -- módulo sem cota cadastrada: fechado
  select coalesce(sum(unidades), 0) into v_usado
    from public.midia_uso where professional_id = p_prof and modulo = p_modulo and criado_em >= v_ini;
  return jsonb_build_object(
    'plano', v_plano, 'limite', v_limite, 'usado', v_usado,
    'restante', case when v_limite is null then null else greatest(v_limite - v_usado, 0) end,
    'renova_em', (v_ini at time zone 'America/Sao_Paulo' + interval '1 month')::date);
end $function$
;

CREATE OR REPLACE FUNCTION private.nome_curto(p_nome text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select case
    when coalesce(btrim(p_nome), '') = '' then 'Cliente'
    when array_length(regexp_split_to_array(btrim(p_nome), '\s+'), 1) = 1
      then (regexp_split_to_array(btrim(p_nome), '\s+'))[1]
    else (regexp_split_to_array(btrim(p_nome), '\s+'))[1] || ' ' ||
         upper(left((regexp_split_to_array(btrim(p_nome), '\s+'))[2], 1)) || '.'
  end;
$function$
;

CREATE OR REPLACE FUNCTION private.release_license(p_token_hash text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  delete from public.license_redemptions where token_hash = p_token_hash
  returning true;
$function$
;

CREATE OR REPLACE FUNCTION private.requisicao_meta(OUT ip text, OUT user_agent text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare h json;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    h := null;
  end;
  if h is null then return; end if;
  ip := nullif(btrim(coalesce(h->>'cf-connecting-ip',
                              h->>'x-real-ip',
                              split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1))), '');
  user_agent := left(h->>'user-agent', 300);
end $function$
;

CREATE OR REPLACE FUNCTION private.studio_avisos()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
  n integer := 0;
  v_txt text;
begin
  for r in
    select v.id, v.professional_id, v.gerado_em, v.aviso_1d_em, v.aviso_7d_em,
           count(*) filter (where ie.event_type = 'view') as visitas,
           count(*) filter (where ie.event_type in ('whatsapp_click', 'call_click')) as contatos
      from public.studio_videos v
      join public.impact_events ie on ie.professional_id = v.professional_id and ie.source = 'studio_' || v.codigo
     where v.gerado_em between now() - interval '9 days' and now() - interval '20 hours'
       and (v.aviso_1d_em is null or (v.aviso_7d_em is null and v.gerado_em <= now() - interval '7 days'))
     group by v.id
  loop
    continue when r.visitas = 0 and r.contatos = 0;
    v_txt := r.visitas || ' visita' || case when r.visitas = 1 then '' else 's' end || ' ao seu perfil';
    if r.contatos > 0 then
      v_txt := v_txt || ' e ' || r.contatos || ' contato' || case when r.contatos = 1 then '' else 's' end || ' pelo WhatsApp ou telefone';
    end if;
    if r.gerado_em > now() - interval '7 days' then
      insert into public.notificacoes (professional_id, tipo, titulo, mensagem, link, chave)
      values (r.professional_id, 'studio_resultado', 'Seu vídeo já está trazendo gente',
              'Desde que você gerou o vídeo: ' || v_txt || '.', 'studio.html?v=' || r.id, 'studio1d:' || r.id)
      on conflict (chave) do nothing;
      update public.studio_videos set aviso_1d_em = now() where id = r.id;
    else
      insert into public.notificacoes (professional_id, tipo, titulo, mensagem, link, chave)
      values (r.professional_id, 'studio_resultado', 'Uma semana do seu vídeo',
              'Em 7 dias, o vídeo trouxe ' || v_txt || '. Que tal fazer outro com o próximo serviço?',
              'studio.html?v=' || r.id, 'studio7d:' || r.id)
      on conflict (chave) do nothing;
      update public.studio_videos set aviso_1d_em = coalesce(aviso_1d_em, now()), aviso_7d_em = now() where id = r.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION private.studio_report_elegivel(p_prof uuid, p_report uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when r.id is null                         then 'servico_nao_encontrado'
    when not coalesce(p.portfolio_publico, false) then 'portfolio_desligado'
    when not r.is_public or r.tipo <> 'servico' or r.arquivado_em is not null then 'servico_privado'
    when not r.portfolio_ok                   then 'servico_fora_do_portfolio'
    when jsonb_array_length(coalesce(r.photos, '[]'::jsonb)) = 0 then 'sem_fotos'
    else 'ok' end
  from public.professionals p
  left join public.reports r on r.id = p_report and r.professional_id = p.id
  where p.id = p_prof;
$function$
;

CREATE OR REPLACE FUNCTION private.studio_roteiro_valido(p_roteiro jsonb, p_fotos jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_url text;
  k text;
begin
  if p_roteiro is null or jsonb_typeof(p_roteiro) <> 'object' then return 'roteiro_invalido'; end if;
  if pg_column_size(p_roteiro) > 6000 then return 'roteiro_grande'; end if;
  for k in select jsonb_object_keys(p_roteiro) loop
    if k not in ('v', 'titulo', 'chamada', 'fotos', 'capa', 'antes', 'depois', 'avaliacao', 'acento') then
      return 'roteiro_invalido';
    end if;
  end loop;
  if jsonb_typeof(p_roteiro->'fotos') <> 'array'
     or jsonb_array_length(p_roteiro->'fotos') not between 1 and 8 then return 'fotos_invalidas'; end if;
  for v_url in select jsonb_array_elements_text(p_roteiro->'fotos') loop
    if not (p_fotos ? v_url) then return 'foto_fora_do_servico'; end if;
  end loop;
  foreach k in array array['capa', 'antes', 'depois'] loop
    if p_roteiro ? k and jsonb_typeof(p_roteiro->k) <> 'null' then
      if jsonb_typeof(p_roteiro->k) <> 'string' or not (p_fotos ? (p_roteiro->>k)) then return 'foto_fora_do_servico'; end if;
    end if;
  end loop;
  foreach k in array array['titulo', 'chamada'] loop
    if p_roteiro ? k and jsonb_typeof(p_roteiro->k) <> 'null' then
      if jsonb_typeof(p_roteiro->k) <> 'string' or char_length(p_roteiro->>k) > 60
         or (p_roteiro->>k) ~ '[\u0000-\u001f<>]' then return 'texto_invalido'; end if;
    end if;
  end loop;
  if p_roteiro ? 'avaliacao' and jsonb_typeof(p_roteiro->'avaliacao') not in ('boolean', 'null') then return 'roteiro_invalido'; end if;
  if p_roteiro ? 'acento' and jsonb_typeof(p_roteiro->'acento') <> 'null'
     and coalesce(p_roteiro->>'acento', '') !~ '^#[0-9a-f]{6}$' then return 'roteiro_invalido'; end if;
  return 'ok';
end $function$
;

CREATE OR REPLACE FUNCTION public._admin_auditoria_so_insercao()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  raise exception 'auditoria_imutavel' using errcode = 'P0001';
end $function$
;

CREATE OR REPLACE FUNCTION public._assistant_check_and_bump_usage()
 RETURNS TABLE(mensagens_restantes integer, limite integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_prof      uuid := auth.uid();
  v_limite    int;
  v_month     date := date_trunc('month', now())::date;
  v_row_month date;
  v_count     int;
begin
  if v_prof is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;

  perform 1 from public.professionals where id = v_prof;
  if not found then
    raise exception 'perfil não encontrado' using errcode = 'P0002';
  end if;

  -- v12.40: Pro vencido conta como grátis (mesma regra da RLS de Contratos)
  v_limite := case when private.is_pro(v_prof) then 300 else 20 end;

  select month_start, message_count into v_row_month, v_count
  from public.assistant_usage
  where professional_id = v_prof
  for update;

  if not found then
    insert into public.assistant_usage (professional_id, month_start, message_count)
    values (v_prof, v_month, 1);
    return query select (v_limite - 1), v_limite;
    return;
  end if;

  if v_row_month <> v_month then
    update public.assistant_usage
      set month_start = v_month, message_count = 1
      where professional_id = v_prof;
    return query select (v_limite - 1), v_limite;
    return;
  end if;

  if v_count >= v_limite then
    raise exception 'Limite de % mensagens do assistente neste mês foi atingido. Tente de novo mês que vem.', v_limite using errcode = '42901';
  end if;

  update public.assistant_usage
    set message_count = message_count + 1
    where professional_id = v_prof;

  return query select (v_limite - v_count - 1), v_limite;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._assistant_loc_check_and_bump_usage()
 RETURNS TABLE(mensagens_restantes integer, limite integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
      declare
        v_loc    uuid := auth.uid();
          v_plan   text;
            v_exp    timestamptz;
              v_limite integer := 50;
                v_month  date := date_trunc('month', now())::date;
                  v_row_month date;
                    v_count  integer;
                    begin
                      if v_loc is null then
                          raise exception 'não autenticado' using errcode = '28000';
                            end if;

                              select coalesce(plan, 'free'), plan_expires_at into v_plan, v_exp
                                  from public.locadoras where id = v_loc;
                                    if not found then
                                        raise exception 'locadora não encontrada' using errcode = 'P0002';
                                          end if;
                                            if v_plan <> 'pro' or (v_exp is not null and v_exp < now()) then
                                                raise exception 'O assistente da Locação faz parte do plano Pro.' using errcode = '42901';
                                                  end if;

                                                    select month_start, message_count into v_row_month, v_count
                                                        from public.assistant_usage_locadora where locadora_id = v_loc for update;

                                                          if not found then
                                                              insert into public.assistant_usage_locadora (locadora_id, month_start, message_count)
                                                                  values (v_loc, v_month, 1);
                                                                      return query select (v_limite - 1), v_limite;
                                                                          return;
                                                                            end if;

                                                                              if v_row_month <> v_month then
                                                                                  update public.assistant_usage_locadora
                                                                                         set month_start = v_month, message_count = 1
                                                                                              where locadora_id = v_loc;
                                                                                                  return query select (v_limite - 1), v_limite;
                                                                                                      return;
                                                                                                        end if;

                                                                                                          if v_count >= v_limite then
                                                                                                              raise exception 'Limite de % mensagens do assistente neste mês foi atingido. Renova no dia 1º.', v_limite using errcode = '42901';
                                                                                                                end if;

                                                                                                                  update public.assistant_usage_locadora
                                                                                                                       set message_count = message_count + 1
                                                                                                                          where locadora_id = v_loc;
                                                                                                                            return query select (v_limite - v_count - 1), v_limite;
                                                                                                                            end $function$
;

CREATE OR REPLACE FUNCTION public._assistant_loc_refund_usage(p_loc uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
                                                                                                                            begin
                                                                                                                              update public.assistant_usage_locadora
                                                                                                                                   set message_count = greatest(0, message_count - 1)
                                                                                                                                      where locadora_id = p_loc
                                                                                                                                           and month_start = date_trunc('month', now())::date
                                                                                                                                                and message_count > 0;
                                                                                                                                                end $function$
;

CREATE OR REPLACE FUNCTION public._assistant_refund_usage(p_prof uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.assistant_usage
     set message_count = greatest(0, message_count - 1)
   where professional_id = p_prof
     and month_start = date_trunc('month', now())::date
     and message_count > 0;
end $function$
;

CREATE OR REPLACE FUNCTION public._budget_next_number(p_professional_id uuid, p_ano smallint DEFAULT NULL::smallint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ano smallint := coalesce(p_ano, extract(year from current_date)::smallint);
  v_seq integer;
begin
  if p_professional_id is null then
    raise exception 'professional_id é obrigatório para gerar número' using errcode = '22023';
  end if;

  insert into public.budget_counters as c (professional_id, ano, ultimo)
  values (p_professional_id, v_ano, 1)
  on conflict (professional_id, ano) do update
        set ultimo = c.ultimo + 1,
            updated_at = now()
  returning c.ultimo into v_seq;

  return v_ano::text || '-' || lpad(v_seq::text, 4, '0');
end
$function$
;

CREATE OR REPLACE FUNCTION public._council_check_and_bump_budget()
 RETURNS TABLE(usadas integer, teto integer, restantes integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m       date := date_trunc('month', now())::date;
  v_used  integer;
  v_limit integer;
begin
  insert into public.council_budget (month_start) values (m)
  on conflict (month_start) do nothing;

  update public.council_budget b
     set calls_used = b.calls_used + 1
   where b.month_start = m
     and b.calls_used < b.calls_limit
  returning b.calls_used, b.calls_limit into v_used, v_limit;

  if not found then
    select b.calls_used, b.calls_limit into v_used, v_limit
      from public.council_budget b
     where b.month_start = m;
    raise exception
      'teto mensal do Conselho atingido (% de %) — nenhuma consulta foi feita',
      v_used, v_limit;
  end if;

  usadas := v_used;
  teto := v_limit;
  restantes := v_limit - v_used;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._council_refund_budget()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.council_budget
     set calls_used = greatest(0, calls_used - 1)
   where month_start = date_trunc('month', now())::date;
end $function$
;

CREATE OR REPLACE FUNCTION public._council_revisar_incidentes_pendentes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
declare
  r       record;
  chave   text;
  enviados integer := 0;
begin
  select decrypted_secret into chave
    from vault.decrypted_secrets
   where name = 'council_key'
   limit 1;
  if chave is null then
    return 0;
  end if;

  for r in
    select i.id
      from public.integrity_incidents i
     where not exists (
             select 1 from public.council_reviews c
              where c.incident_id = i.id and c.is_escalation = false
           )
       and not exists (
             select 1
               from public.council_reviews c2
               join public.integrity_incidents i2 on i2.id = c2.incident_id
              where c2.status = 'concluida'
                and c2.is_escalation = false
                and i2.url = i.url
                and i2.summary = i.summary
                and c2.requested_at > now() - interval '7 days'
           )
       and i.opened_at > now() - interval '7 days'
     order by i.opened_at
     limit 3
  loop
    perform net.http_post(
      url := 'https://jrsctnncoljdcvdofxsg.supabase.co/functions/v1/council',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-council-key', chave),
      body := jsonb_build_object('incident_id', r.id),
      timeout_milliseconds := 60000
    );
    enviados := enviados + 1;
  end loop;

  return enviados;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._loc_apos_assinatura(p_contrato uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      end $function$
;

CREATE OR REPLACE FUNCTION public._loc_cnpj_valido(p text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                            end $function$
;

CREATE OR REPLACE FUNCTION public._loc_contrato_do_token(p_token text, p_travar boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      end $function$
;

CREATE OR REPLACE FUNCTION public._loc_contratos_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                                      end $function$
;

CREATE OR REPLACE FUNCTION public._loc_cpf_valido(p text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                    end $function$
;

CREATE OR REPLACE FUNCTION public._loc_digits(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$ select regexp_replace(coalesce(p, ''), '\D', '', 'g') $function$
;

CREATE OR REPLACE FUNCTION public._loc_doc_valido(p text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$ select public._loc_cpf_valido(p) or public._loc_cnpj_valido(p) $function$
;

CREATE OR REPLACE FUNCTION public._loc_err(p_code text, p_extra jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  select jsonb_build_object('ok', false, 'error', p_code) || coalesce(p_extra, '{}'::jsonb)
  $function$
;

CREATE OR REPLACE FUNCTION public._loc_evento(p_contrato uuid, p_locadora uuid, p_tipo text, p_ator text, p_detalhe jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
                                                                  insert into public.loc_contrato_eventos (contrato_id, locadora_id, tipo, ator, detalhe)
                                                                    values (p_contrato, p_locadora, p_tipo, p_ator, coalesce(p_detalhe, '{}'::jsonb))
                                                                    $function$
;

CREATE OR REPLACE FUNCTION public._loc_ip()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
                                                    declare h text; j json;
                                                    begin
                                                      h := nullif(current_setting('request.headers', true), '');
                                                        if h is null then return null; end if;
                                                          j := h::json;
                                                            return left(nullif(btrim(split_part(coalesce(j->>'cf-connecting-ip', j->>'x-forwarded-for', ''), ',', 1)), ''), 64);
                                                            exception when others then
                                                              return null;
                                                              end $function$
;

CREATE OR REPLACE FUNCTION public._loc_merge_edicao(p_dados jsonb, p_edicao jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                                                       end $function$
;

CREATE OR REPLACE FUNCTION public._loc_png_valido(p text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
                                            begin
                                              if p is null then return true; end if;
                                                if p !~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$' then return false; end if;
                                                  return substring(decode(substr(p, 23), 'base64') from 1 for 8) = '\x89504e470d0a1a0a'::bytea;
                                                  exception when others then
                                                    return false;
                                                    end $function$
;

CREATE OR REPLACE FUNCTION public._loc_resync(p_antigo jsonb, p_locacao_id uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_snap jsonb; v_new jsonb;
begin
  v_snap := public._loc_snapshot(p_locacao_id, p_uid);
  if v_snap ? 'erro' then return v_snap; end if;
  v_new := v_snap -> 'dados';
  v_new := jsonb_set(v_new, '{condicoes}', coalesce(p_antigo -> 'condicoes', v_new -> 'condicoes'));
  v_new := jsonb_set(v_new, '{cliente,endereco}', coalesce(p_antigo #> '{cliente,endereco}', 'null'::jsonb));
  if jsonb_typeof(p_antigo #> '{locadora,representante}') = 'string' then
    v_new := jsonb_set(v_new, '{locadora,representante}', p_antigo #> '{locadora,representante}');
  end if;
  return jsonb_build_object('dados', v_new, 'origem_hash', v_snap ->> 'origem_hash');
end $function$
;

CREATE OR REPLACE FUNCTION public._loc_sha256(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
    select encode(extensions.digest(convert_to(coalesce(p, ''), 'UTF8'), 'sha256'), 'hex')
    $function$
;

CREATE OR REPLACE FUNCTION public._loc_snapshot(p_locacao_id uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
        'whatsapp', d.whatsapp, 'representante', nullif(btrim(d.responsavel), '')),
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
end $function$
;

CREATE OR REPLACE FUNCTION public._loc_somente_insercao()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
                                                                                                                                                                                                                                                                                        begin
                                                                                                                                                                                                                                                                                          raise exception 'registro_imutavel' using errcode = 'P0001';
                                                                                                                                                                                                                                                                                          end $function$
;

CREATE OR REPLACE FUNCTION public._loc_valida_clausulas(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                                                                                                end $function$
;

CREATE OR REPLACE FUNCTION public._mcp_resolve_identity(p_raw_key text, p_is_write boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_prof   uuid;
  v_window timestamptz;
  v_count  int;
  v_limite constant int := 20;
  v_janela constant interval := interval '60 minutes';
begin
  -- Caminho 1: chave fmcp_ — comportamento de hoje, sem nenhuma mudança.
  if p_raw_key is not null then
    return public._mcp_resolve_key(p_raw_key, p_is_write);
  end if;

  -- Caminho 2: OAuth. auth.uid() só devolve algo quando o PostgREST
  -- recebeu um token de USUÁRIO já validado pelo Supabase Auth (não a
  -- anon key) — a mesma checagem que já protege o app inteiro quando
  -- qualquer profissional usa o Fieldo logado normalmente.
  v_prof := auth.uid();
  if v_prof is null then
    raise exception 'chave mcp inválida ou revogada' using errcode = '28000';
  end if;

  if not p_is_write then
    return v_prof;
  end if;

  -- Mesma regra de 20 escritas/hora do caminho de chave, guardada por
  -- profissional (sem "chave" nesse caminho pra pendurar o contador).
  select rl_window_start, rl_count into v_window, v_count
  from public.mcp_oauth_rate_limit
  where professional_id = v_prof
  for update;

  if not found then
    insert into public.mcp_oauth_rate_limit (professional_id, rl_window_start, rl_count)
    values (v_prof, now(), 1);
    return v_prof;
  end if;

  if v_window is null or now() - v_window > v_janela then
    update public.mcp_oauth_rate_limit
      set rl_window_start = now(), rl_count = 1
      where professional_id = v_prof;
    return v_prof;
  end if;

  if v_count >= v_limite then
    raise exception 'limite de uso atingido (% chamadas de escrita em % minutos). Tente de novo mais tarde.',
      v_limite, round(extract(epoch from v_janela) / 60)::int using errcode = '42901';
  end if;

  update public.mcp_oauth_rate_limit
    set rl_count = rl_count + 1
    where professional_id = v_prof;

  return v_prof;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._mcp_resolve_key(p_raw_key text, p_is_write boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_hash        text;
  v_prof        uuid;
  v_window      timestamptz;
  v_count       int;
  v_limite      constant int := 20;
  v_janela      constant interval := interval '60 minutes';
begin
  if p_raw_key is null or length(p_raw_key) < 10 then
    raise exception 'chave mcp inválida ou revogada' using errcode = '28000';
  end if;

  v_hash := encode(digest(p_raw_key, 'sha256'), 'hex');

  select professional_id, rl_window_start, rl_count
    into v_prof, v_window, v_count
  from public.mcp_api_keys
  where key_hash = v_hash and revoked_at is null;

  if v_prof is null then
    raise exception 'chave mcp inválida ou revogada' using errcode = '28000';
  end if;

  if not p_is_write then
    update public.mcp_api_keys set last_used_at = now() where key_hash = v_hash;
    return v_prof;
  end if;

  if v_window is null or now() - v_window > v_janela then
    update public.mcp_api_keys
      set last_used_at = now(), rl_window_start = now(), rl_count = 1
      where key_hash = v_hash;
    return v_prof;
  end if;

  if v_count >= v_limite then
    raise exception 'limite de uso desta chave atingido (% chamadas de escrita em % minutos). Tente de novo mais tarde.',
      v_limite, round(extract(epoch from v_janela) / 60)::int using errcode = '42901';
  end if;

  update public.mcp_api_keys
    set last_used_at = now(), rl_count = rl_count + 1
    where key_hash = v_hash;

  return v_prof;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._oc_data(p text)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then return null;
end $function$
;

CREATE OR REPLACE FUNCTION public._oc_do_token(p_token text, p_travar boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public._oc_evento(p_contrato uuid, p_prof uuid, p_tipo text, p_ator text, p_detalhe jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  insert into public.obra_contrato_eventos (contrato_id, professional_id, tipo, ator, detalhe)
  values (p_contrato, p_prof, p_tipo, p_ator, coalesce(p_detalhe, '{}'::jsonb))
$function$
;

CREATE OR REPLACE FUNCTION public._oc_faltam(d jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public._oc_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public._oc_merge(p_dados jsonb, p_ed jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public._oc_snapshot(p_obra uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public._oc_txt(p jsonb, p_max integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when p is null or jsonb_typeof(p) <> 'string' then null
              else nullif(btrim(left(regexp_replace(p #>> '{}', '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'), p_max)), '') end
$function$
;

CREATE OR REPLACE FUNCTION public._snapshot_listar_migrations()
 RETURNS TABLE(version text, name text, sql text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'supabase_migrations'
AS $function$
begin
  return query
    select m.version,
           coalesce(m.name, 'sem_nome') as name,
           array_to_string(coalesce(m.statements, array[]::text[]), E';\n\n') as sql
      from supabase_migrations.schema_migrations m
     order by m.version;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.aceitar_contrato_locacao(p_token text, p_hash text, p_nome text, p_documento text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c          public.locacao_contratos%rowtype;
  v_nome     text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_doc      text := private.doc_normalizado(p_documento);
  v_doc_ct   text;
  v_meta     record;
  v_agora    timestamptz := now();
  v_registro text;
  v_hash     text;
  v_hash_id  uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('ok', false, 'error', 'nao_encontrado');
  end if;

  select * into c from public.locacao_contratos where token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'nao_encontrado');
  end if;
  if c.status = 'aceito' then
    return jsonb_build_object('ok', false, 'error', 'ja_aceito', 'aceito_em', c.aceito_em);
  end if;
  if c.status = 'cancelado' then
    return jsonb_build_object('ok', false, 'error', 'cancelado');
  end if;
  if c.status = 'substituido' then
    return jsonb_build_object('ok', false, 'error', 'substituido');
  end if;
  if p_hash is distinct from c.hash then
    return jsonb_build_object('ok', false, 'error', 'hash_divergente');
  end if;
  if length(v_nome) < 5 or length(v_nome) > 120 or v_nome !~ '\S+ \S+' then
    return jsonb_build_object('ok', false, 'error', 'nome_invalido');
  end if;
  if not private.documento_valido(v_doc) then
    return jsonb_build_object('ok', false, 'error', 'documento_invalido');
  end if;

  -- Se a locadora registrou o CPF/CNPJ do cliente, só ele aceita.
  v_doc_ct := nullif(private.doc_normalizado((c.conteudo::jsonb)->'cliente'->>'documento'), '');
  if v_doc_ct is not null and v_doc_ct <> v_doc then
    return jsonb_build_object('ok', false, 'error', 'documento_diferente');
  end if;

  select * into v_meta from private.requisicao_meta();

  v_registro := jsonb_build_object(
    'documento',           'aceite_contrato_locacao',
    'contrato_id',         c.id,
    'contrato_numero',     c.numero,
    'contrato_versao',     c.versao,
    'contrato_hash',       c.hash,
    'aceito_em',           to_char(v_agora at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'nome',                v_nome,
    'documento_aceitante', v_doc,
    'declaracao',          'Li integralmente este contrato, conferi equipamentos, valores e condições, e aceito todas as suas cláusulas.',
    'ip',                  v_meta.ip,
    'user_agent',          v_meta.user_agent
  )::text;

  v_hash := encode(extensions.digest(convert_to(v_registro, 'UTF8'), 'sha256'), 'hex');

  insert into public.document_hashes (locadora_id, hash, tipo, ref_id, conteudo_resumo)
  values (c.locadora_id, v_hash, 'aceite_locacao', c.id,
          jsonb_build_object('client', v_nome, 'numero', c.numero))
  returning id into v_hash_id;

  update public.locacao_contratos
     set status            = 'aceito',
         aceito_em         = v_agora,
         aceite_nome       = v_nome,
         aceite_documento  = v_doc,
         aceite_ip         = v_meta.ip,
         aceite_user_agent = v_meta.user_agent,
         aceite_registro   = v_registro,
         aceite_hash       = v_hash,
         aceite_hash_id    = v_hash_id
   where id = c.id;

  -- Contrato aceito antes desta versão perde a vigência AGORA: as duas
  -- partes concordaram com o novo texto.
  update public.locacao_contratos
     set status = 'substituido', substituido_por = c.id, substituido_em = v_agora
   where locacao_id = c.locacao_id and status = 'aceito' and id <> c.id;

  return jsonb_build_object(
    'ok',              true,
    'aceito_em',       v_agora,
    'aceite_hash',     v_hash,
    'aceite_registro', v_registro);
end $function$
;

CREATE OR REPLACE FUNCTION public.ativar_perfil_publico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_qtd int;
begin
  select count(*) into v_qtd
    from public.reports
   where professional_id = new.professional_id and is_public;

  if v_qtd >= 3 then
    update public.professionals
       set is_public = true
     where id = new.professional_id
       and is_public = false
       -- exige o mínimo para não publicar perfil vazio no marketplace
       and name is not null and profissao is not null and city is not null;
  end if;

  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.bloquear_alteracao_plano()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if new.plan is distinct from old.plan
     or new.plan_expires_at is distinct from old.plan_expires_at then
    raise exception 'plano só pode ser alterado pelo servidor'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.cancelar_contrato_locacao(p_contrato_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c     public.locacao_contratos%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'nao_autenticado');
  end if;
  select * into c from public.locacao_contratos where id = p_contrato_id for update;
  if not found or c.locadora_id <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'nao_encontrado');
  end if;
  if c.status = 'aceito' then
    return jsonb_build_object('ok', false, 'error', 'ja_aceito');
  end if;
  if c.status <> 'emitido' then
    return jsonb_build_object('ok', false, 'error', 'ja_encerrado');
  end if;
  update public.locacao_contratos
     set status = 'cancelado',
         cancelado_em = now(),
         cancelamento_motivo = left(nullif(btrim(coalesce(p_motivo, '')), ''), 300)
   where id = c.id;
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.cidade_partes(p_city text, OUT city_slug text, OUT uf character)
 RETURNS record
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare m text[]; resto text; nome text;
begin
  if p_city is null or btrim(p_city) = '' then
    city_slug := null; uf := null; return;
  end if;

  -- 1) sigla de duas letras no fim, com separador obrigatorio.
  --    O separador nao pode ser opcional: sem ele "Torres" (RS)
  --    viraria "Torr" + UF "ES".
  m := regexp_match(btrim(p_city),
        '^(.+?)(?:[\s]*[-–—/,][\s]*|[\s]+)(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$',
        'i');

  if m is not null then
    resto := m[1];
    uf    := upper(m[2]);
  else
    -- 2) estado por extenso no fim. Case e acento resolvidos pelo
    --    proprio normalizar_city_slug, entao a comparacao e feita
    --    sobre o slug.
    resto := p_city;
    uf    := null;

    nome := public.normalizar_city_slug(p_city);
    for m in
      select array[padrao, sigla] from (values
        ('acre','AC'),('alagoas','AL'),('amapa','AP'),('amazonas','AM'),
        ('bahia','BA'),('ceara','CE'),('distrito-federal','DF'),
        ('espirito-santo','ES'),('goias','GO'),('maranhao','MA'),
        ('mato-grosso-do-sul','MS'),('mato-grosso','MT'),('minas-gerais','MG'),
        ('para','PA'),('paraiba','PB'),('parana','PR'),('pernambuco','PE'),
        ('piaui','PI'),('rio-de-janeiro','RJ'),('rio-grande-do-norte','RN'),
        ('rio-grande-do-sul','RS'),('rondonia','RO'),('roraima','RR'),
        ('santa-catarina','SC'),('sao-paulo','SP'),('sergipe','SE'),
        ('tocantins','TO')
      ) t(padrao, sigla)
      -- mais longo primeiro: "mato-grosso-do-sul" antes de "mato-grosso",
      -- senao MS vira MT.
      order by length(padrao) desc
    loop
      if nome like '%-' || m[1] then
        resto := left(nome, length(nome) - length(m[1]) - 1);
        uf    := m[2];
        exit;
      end if;
    end loop;
  end if;

  city_slug := public.normalizar_city_slug(resto);
end $function$
;

CREATE OR REPLACE FUNCTION public.claim_payment(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_rep public.reports%rowtype;
begin
  select * into v_rep from public.reports
   where rating_token = p_token for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'nao_encontrado');
  end if;
  if v_rep.payment_status = 'pago' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if v_rep.payment_status <> 'pendente' then
    return jsonb_build_object('ok', false, 'error', 'nao_cobrado');
  end if;
  if v_rep.client_paid_claim_at is not null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  update public.reports set client_paid_claim_at = now() where id = v_rep.id;
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.contrato_locacao_por_hash(p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c       public.locacao_contratos%rowtype;
  v_selo  text;
  v_novo  text;
  v_lcd   text;
  h       text := lower(btrim(coalesce(p_hash, '')));
begin
  if h !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into c from public.locacao_contratos where hash = h;
  if found then
    v_selo := 'emissao';
  else
    select * into c from public.locacao_contratos where aceite_hash = h;
    if not found then
      return null;
    end if;
    v_selo := 'aceite';
  end if;
  if c.substituido_por is not null then
    select numero into v_novo from public.locacao_contratos where id = c.substituido_por;
  end if;
  select nome into v_lcd from public.locadoras where id = c.locadora_id;
  return jsonb_build_object(
    'selo',                   v_selo,
    'numero',                 c.numero,
    'versao',                 c.versao,
    'status',                 c.status,
    'emitido_em',             c.emitido_em,
    'aceito_em',              c.aceito_em,
    'cancelado_em',           c.cancelado_em,
    'substituido_em',         c.substituido_em,
    'substituido_por_numero', v_novo,
    'locadora',               v_lcd,
    'cliente',                private.nome_curto((c.conteudo::jsonb)->'cliente'->>'nome'),
    'aceite_nome',            case when c.aceite_nome is not null then private.nome_curto(c.aceite_nome) end);
end $function$
;

CREATE OR REPLACE FUNCTION public.contrato_locacao_por_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c       public.locacao_contratos%rowtype;
  v_novo  text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return null;
  end if;
  select * into c from public.locacao_contratos where token = p_token;
  if not found then
    return null;
  end if;
  if c.substituido_por is not null then
    select numero into v_novo from public.locacao_contratos where id = c.substituido_por;
  end if;
  return jsonb_build_object(
    'id',                     c.id,
    'numero',                 c.numero,
    'versao',                 c.versao,
    'status',                 c.status,
    'conteudo',               c.conteudo,
    'hash',                   c.hash,
    'emitido_em',             c.emitido_em,
    'aceito_em',              c.aceito_em,
    'aceite_registro',        c.aceite_registro,
    'aceite_hash',            c.aceite_hash,
    'cancelado_em',           c.cancelado_em,
    'cancelamento_motivo',    c.cancelamento_motivo,
    'substituido_em',         c.substituido_em,
    'substituido_por_numero', v_novo);
end $function$
;

CREATE OR REPLACE FUNCTION public.decide_budget(p_token text, p_decisao text, p_nota text DEFAULT NULL::text, p_assinatura text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_bud public.budgets%rowtype;
begin
  if p_decisao not in ('aprovado','recusado') then
    return jsonb_build_object('ok', false, 'error', 'decisao_invalida');
  end if;

  -- FOR UPDATE serializa dois cliques simultâneos no mesmo link
  select * into v_bud from public.budgets
   where approval_token = p_token for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'nao_encontrado');
  end if;

  -- Decisão é definitiva: evita o cliente aprovar, mudar de ideia e
  -- recusar depois que o profissional já começou o serviço.
  if v_bud.status in ('aprovado','recusado','concluido') then
    return jsonb_build_object('ok', false, 'error', 'ja_decidido',
                              'status', v_bud.status);
  end if;

  update public.budgets
     set status         = p_decisao,
         approved_at    = now(),
         approval_note  = nullif(btrim(p_nota), ''),
         client_signature = case when p_decisao = 'aprovado'
                                 then nullif(btrim(p_assinatura), '') end
   where id = v_bud.id;

  return jsonb_build_object('ok', true, 'status', p_decisao,
                            'total', v_bud.total, 'numero', v_bud.number);
end $function$
;

CREATE OR REPLACE FUNCTION public.emitir_contrato_locacao(p_locacao_id uuid, p_termos jsonb, p_clausulas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid       uuid := auth.uid();
  v_loc       public.locacoes%rowtype;
  v_lcd       public.locadoras%rowtype;
  v_ant       public.locacao_contratos%rowtype;
  v_termos    jsonb := coalesce(p_termos, '{}'::jsonb);
  v_item      jsonb;
  v_agora     timestamptz := now();
  v_ano       smallint := extract(year from (now() at time zone 'America/Sao_Paulo'))::smallint;
  v_id        uuid := gen_random_uuid();
  v_token     text := encode(extensions.gen_random_bytes(16), 'hex');
  v_seq       int;
  v_versao    smallint;
  v_numero    text;
  v_modelo    text;
  v_pagto     text;
  v_local     text;
  v_cli_end   text;
  v_foro      text;
  v_cli_doc   text;
  v_dev_ant   text;
  v_acresc    numeric := 0;
  v_prazo_cc  int := 3;
  v_total     numeric;
  v_diarias   int;
  v_itens     jsonb;
  v_laudos    jsonb;
  v_clausulas jsonb;
  v_resumo    jsonb;
  v_conteudo  text;
  v_hash      text;
  v_hash_id   uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'nao_autenticado');
  end if;

  -- FOR UPDATE: duas emissões simultâneas da mesma locação viram fila,
  -- e a numeração de versão não colide.
  select * into v_loc from public.locacoes where id = p_locacao_id for update;
  if not found or v_loc.locadora_id <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'locacao_nao_encontrada');
  end if;
  if v_loc.status = 'cancelada' then
    return jsonb_build_object('ok', false, 'error', 'locacao_cancelada');
  end if;

  select * into v_lcd from public.locadoras where id = v_uid;
  if coalesce(btrim(v_lcd.nome), '') = ''
     or not private.documento_valido(v_lcd.cnpj)
     or coalesce(btrim(v_lcd.endereco), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'locadora_incompleta');
  end if;

  if coalesce(btrim(v_loc.client_name), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'cliente_sem_nome');
  end if;
  v_cli_doc := nullif(btrim(coalesce(v_loc.client_doc, '')), '');
  if v_cli_doc is not null and not private.documento_valido(v_cli_doc) then
    return jsonb_build_object('ok', false, 'error', 'cliente_documento_invalido');
  end if;

  -- ── termos ──
  if jsonb_typeof(v_termos) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'termos_invalidos');
  end if;
  v_modelo  := coalesce(nullif(btrim(v_termos->>'modelo'), ''), 'locacao-v1');
  v_pagto   := nullif(btrim(v_termos->>'forma_pagamento'), '');
  v_local   := nullif(btrim(v_termos->>'local_uso'), '');
  v_cli_end := nullif(btrim(v_termos->>'cliente_endereco'), '');
  v_foro    := nullif(btrim(v_termos->>'foro'), '');
  v_dev_ant := coalesce(nullif(btrim(v_termos->>'devolucao_antecipada'), ''), 'cobra_dias_usados');

  if coalesce(length(v_modelo), 0) > 40  or coalesce(length(v_pagto), 0) > 300
  or coalesce(length(v_local), 0) > 300  or coalesce(length(v_cli_end), 0) > 300
  or coalesce(length(v_foro), 0) > 120
  or v_dev_ant not in ('cobra_dias_usados', 'sem_reembolso') then
    return jsonb_build_object('ok', false, 'error', 'termos_invalidos');
  end if;
  if v_foro is null then
    return jsonb_build_object('ok', false, 'error', 'foro_obrigatorio');
  end if;

  if jsonb_typeof(v_termos->'acrescimo_atraso_pct') = 'number' then
    v_acresc := (v_termos->>'acrescimo_atraso_pct')::numeric;
  elsif v_termos ? 'acrescimo_atraso_pct' and jsonb_typeof(v_termos->'acrescimo_atraso_pct') <> 'null' then
    return jsonb_build_object('ok', false, 'error', 'termos_invalidos');
  end if;
  if v_acresc < 0 or v_acresc > 100 then
    return jsonb_build_object('ok', false, 'error', 'termos_invalidos');
  end if;

  if jsonb_typeof(v_termos->'prazo_caucao_dias') = 'number' then
    if (v_termos->>'prazo_caucao_dias')::numeric <> trunc((v_termos->>'prazo_caucao_dias')::numeric) then
      return jsonb_build_object('ok', false, 'error', 'termos_invalidos');
    end if;
    v_prazo_cc := (v_termos->>'prazo_caucao_dias')::numeric::int;
  elsif v_termos ? 'prazo_caucao_dias' and jsonb_typeof(v_termos->'prazo_caucao_dias') <> 'null' then
    return jsonb_build_object('ok', false, 'error', 'termos_invalidos');
  end if;
  if v_prazo_cc < 0 or v_prazo_cc > 90 then
    return jsonb_build_object('ok', false, 'error', 'termos_invalidos');
  end if;

  if v_termos ? 'itens' and jsonb_typeof(v_termos->'itens') not in ('array', 'null') then
    return jsonb_build_object('ok', false, 'error', 'termos_invalidos');
  end if;
  for v_item in select x from jsonb_array_elements(
                  case when jsonb_typeof(v_termos->'itens') = 'array' then v_termos->'itens' else '[]'::jsonb end) x
  loop
    if jsonb_typeof(v_item) <> 'object' then
      return jsonb_build_object('ok', false, 'error', 'termos_invalidos');
    end if;
    if not exists (select 1 from public.locacao_itens li
                    where li.locacao_id = v_loc.id and li.id::text = v_item->>'item_id') then
      return jsonb_build_object('ok', false, 'error', 'item_desconhecido');
    end if;
    if coalesce(length(v_item->>'estado_saida'), 0) > 600 then
      return jsonb_build_object('ok', false, 'error', 'termos_invalidos');
    end if;
    if jsonb_typeof(v_item->'valor_reposicao') = 'number' then
      if (v_item->>'valor_reposicao')::numeric < 0 or (v_item->>'valor_reposicao')::numeric > 10000000 then
        return jsonb_build_object('ok', false, 'error', 'termos_invalidos');
      end if;
    elsif v_item ? 'valor_reposicao' and jsonb_typeof(v_item->'valor_reposicao') <> 'null' then
      return jsonb_build_object('ok', false, 'error', 'termos_invalidos');
    end if;
  end loop;

  -- ── cláusulas ──
  if jsonb_typeof(p_clausulas) is distinct from 'array'
     or jsonb_array_length(p_clausulas) < 1 or jsonb_array_length(p_clausulas) > 60 then
    return jsonb_build_object('ok', false, 'error', 'clausulas_invalidas');
  end if;
  for v_item in select x from jsonb_array_elements(p_clausulas) x loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(btrim(v_item->>'titulo'), '') = '' or length(v_item->>'titulo') > 140
       or coalesce(btrim(v_item->>'texto'),  '') = '' or length(v_item->>'texto')  > 8000 then
      return jsonb_build_object('ok', false, 'error', 'clausulas_invalidas');
    end if;
  end loop;
  select jsonb_agg(jsonb_build_object('n', ord, 'titulo', btrim(x->>'titulo'), 'texto', btrim(x->>'texto'))
                   order by ord)
    into v_clausulas
    from jsonb_array_elements(p_clausulas) with ordinality as t(x, ord);

  -- ── itens: do banco, com o que a locadora declarou por item ──
  select jsonb_agg(jsonb_build_object(
           'item_id',         li.id,
           'equipamento_id',  li.equipamento_id,
           'nome',            coalesce(e.nome, 'Equipamento'),
           'marca',           e.marca,
           'modelo',          e.modelo,
           'quantidade',      li.quantidade,
           'preco_dia',       li.preco_dia_aplicado,
           'subtotal',        li.subtotal,
           'estado_saida',    coalesce(nullif(btrim(t.x->>'estado_saida'), ''),
                                'Em perfeito estado de funcionamento e conservação, conferido na entrega.'),
           'valor_reposicao', case when jsonb_typeof(t.x->'valor_reposicao') = 'number'
                                   then (t.x->>'valor_reposicao')::numeric end)
         order by li.created_at, li.id)
    into v_itens
    from public.locacao_itens li
    left join public.equipamentos e on e.id = li.equipamento_id
    left join lateral (
      select x from jsonb_array_elements(
               case when jsonb_typeof(v_termos->'itens') = 'array' then v_termos->'itens' else '[]'::jsonb end) x
       where x->>'item_id' = li.id::text
       limit 1) t on true
   where li.locacao_id = v_loc.id;

  if v_itens is null then
    return jsonb_build_object('ok', false, 'error', 'locacao_sem_itens');
  end if;

  v_total := coalesce(v_loc.valor_total,
                      (select sum(subtotal) from public.locacao_itens where locacao_id = v_loc.id));
  if v_total is null then
    return jsonb_build_object('ok', false, 'error', 'locacao_sem_valor');
  end if;

  v_diarias := greatest(1, v_loc.data_prevista_devolucao - v_loc.data_saida);

  -- ── laudos de saída, se existirem ──
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id',       ll.locacao_item_id,
           'observacoes',   ll.observacoes,
           'avarias',       ll.avarias,
           'fotos',         ll.fotos,
           'hash',          dh.hash,
           'registrado_em', to_char(ll.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
         order by ll.created_at), '[]'::jsonb)
    into v_laudos
    from public.locacao_laudos ll
    join public.locacao_itens li on li.id = ll.locacao_item_id
    left join public.document_hashes dh on dh.id = ll.hash_id
   where li.locacao_id = v_loc.id and ll.tipo = 'saida';

  -- ── numeração ──
  select coalesce(max(versao), 0) + 1 into v_versao
    from public.locacao_contratos where locacao_id = v_loc.id;

  perform pg_advisory_xact_lock(hashtextextended('locacao_contratos:' || v_uid::text, 0));
  select coalesce(max(seq), 0) + 1 into v_seq
    from public.locacao_contratos where locadora_id = v_uid and ano = v_ano;
  v_numero := 'CT-' || v_ano || '-' ||
              case when v_seq < 10000 then lpad(v_seq::text, 4, '0') else v_seq::text end;

  select * into v_ant
    from public.locacao_contratos
   where locacao_id = v_loc.id and status in ('emitido', 'aceito')
   order by versao desc
   limit 1;

  -- ── conteúdo canônico ──
  v_conteudo := jsonb_build_object(
    'documento',   'contrato_locacao_bens_moveis',
    'modelo',      v_modelo,
    'id',          v_id,
    'numero',      v_numero,
    'versao',      v_versao,
    'substitui',   v_ant.numero,
    'emitido_em',  to_char(v_agora at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'locadora',    jsonb_build_object(
                     'id',           v_lcd.id,
                     'nome',         btrim(v_lcd.nome),
                     'razao_social', nullif(btrim(coalesce(v_lcd.razao_social, '')), ''),
                     'documento',    btrim(v_lcd.cnpj),
                     'endereco',     btrim(v_lcd.endereco),
                     'cidade',       v_lcd.city,
                     'uf',           v_lcd.uf,
                     'whatsapp',     v_lcd.whatsapp,
                     'email',        nullif(btrim(coalesce(v_lcd.email, '')), '')),
    'cliente',     jsonb_build_object(
                     'nome',      btrim(v_loc.client_name),
                     'documento', v_cli_doc,
                     'telefone',  v_loc.client_phone,
                     'email',     v_loc.client_email,
                     'endereco',  v_cli_end),
    'locacao',     jsonb_build_object(
                     'id',                 v_loc.id,
                     'saida',              v_loc.data_saida,
                     'devolucao_prevista', v_loc.data_prevista_devolucao,
                     'diarias',            v_diarias,
                     'modalidade',         case when nullif(btrim(coalesce(v_loc.entrega_endereco, '')), '') is null
                                                then 'retirada' else 'entrega' end,
                     'entrega_endereco',   nullif(btrim(coalesce(v_loc.entrega_endereco, '')), ''),
                     'local_uso',          coalesce(v_local, nullif(btrim(coalesce(v_loc.entrega_endereco, '')), ''))),
    'itens',       v_itens,
    'valores',     jsonb_build_object(
                     'total',           v_total,
                     'caucao',          coalesce(v_loc.caucao_valor, 0),
                     'forma_pagamento', v_pagto),
    'condicoes',   jsonb_build_object(
                     'devolucao_antecipada', v_dev_ant,
                     'acrescimo_atraso_pct', v_acresc,
                     'prazo_caucao_dias',    v_prazo_cc),
    'laudos_saida', v_laudos,
    'clausulas',   v_clausulas,
    'foro',        v_foro
  )::text;

  if length(v_conteudo) > 400000 then
    return jsonb_build_object('ok', false, 'error', 'conteudo_grande');
  end if;

  v_hash := encode(extensions.digest(convert_to(v_conteudo, 'UTF8'), 'sha256'), 'hex');

  select jsonb_build_object(
           'saida',    v_loc.data_saida,
           'prevista', v_loc.data_prevista_devolucao,
           'total',    v_total,
           'caucao',   coalesce(v_loc.caucao_valor, 0),
           'itens',    coalesce(jsonb_agg(jsonb_build_object('equipamento_id', equipamento_id,
                                                             'quantidade',     quantidade)
                                          order by equipamento_id, quantidade), '[]'::jsonb))
    into v_resumo
    from public.locacao_itens where locacao_id = v_loc.id;

  -- Resumo público do selo: o verificar_hash já encurta 'client' para
  -- "Maria A.". Documento do cliente nunca entra aqui.
  insert into public.document_hashes (locadora_id, hash, tipo, ref_id, conteudo_resumo)
  values (v_uid, v_hash, 'contrato_locacao', v_id, jsonb_build_object(
            'client',  btrim(v_loc.client_name),
            'numero',  v_numero,
            'periodo', to_char(v_loc.data_saida, 'DD/MM/YYYY') || ' a ' ||
                       to_char(v_loc.data_prevista_devolucao, 'DD/MM/YYYY'),
            'valor',   v_total))
  returning id into v_hash_id;

  insert into public.locacao_contratos (
    id, locadora_id, locacao_id, ano, seq, numero, versao, token,
    conteudo, hash, hash_id, resumo_economico, status, emitido_em)
  values (
    v_id, v_uid, v_loc.id, v_ano, v_seq, v_numero, v_versao, v_token,
    v_conteudo, v_hash, v_hash_id, v_resumo, 'emitido', v_agora);

  -- Versão anterior ainda NÃO aceita perde efeito na hora: nunca foi
  -- vinculante. A anterior ACEITA continua valendo até o cliente
  -- aceitar esta — quem troca contrato vigente são as duas partes.
  update public.locacao_contratos
     set status = 'substituido', substituido_por = v_id, substituido_em = v_agora
   where locacao_id = v_loc.id and status = 'emitido' and id <> v_id;

  return jsonb_build_object(
    'ok',         true,
    'id',         v_id,
    'numero',     v_numero,
    'versao',     v_versao,
    'token',      v_token,
    'hash',       v_hash,
    'emitido_em', v_agora);
end $function$
;

CREATE OR REPLACE FUNCTION public.equip_disponivel(p_equip uuid, p_de date, p_ate date)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select greatest((select quantidade from public.equipamentos where id = p_equip)
                  - public.equip_ocupado(p_equip, p_de, p_ate), 0)::int;
$function$
;

CREATE OR REPLACE FUNCTION public.equip_ocupado(p_equip uuid, p_de date, p_ate date)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(sum(i.quantidade), 0)::int
    from public.locacao_itens i
    join public.locacoes l on l.id = i.locacao_id
   where i.equipamento_id = p_equip
     and l.status in ('reservada','em_andamento','atrasada')
     and l.data_saida <= p_ate
     and coalesce(l.data_devolucao, l.data_prevista_devolucao) >= p_de;
$function$
;

CREATE OR REPLACE FUNCTION public.equip_slug_livre(p_base text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_slug text; v_n int := 1;
begin
  if p_base is null or p_base = '' then return null; end if;
  v_slug := p_base;
  while exists (select 1 from public.equipamentos where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := p_base || '-' || v_n;
    if v_n > 500 then
      return p_base || '-' || replace(gen_random_uuid()::text,'-','');
    end if;
  end loop;
  return v_slug;
end $function$
;

CREATE OR REPLACE FUNCTION public.estimar_materiais(p_ids uuid[])
 RETURNS TABLE(material_id uuid, nome text, unidade text, preco numeric, origem text, pago_em date, loja text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select m.id, m.nome, m.unidade,
         coalesce(p.preco_unit, m.preco_referencia),
         case when p.preco_unit is not null then 'seu' else 'referencia' end,
         p.data, p.loja
  from materiais m
  left join lateral (
    select preco_unit, data, loja from material_precos
    where professional_id = (select auth.uid()) and material_id = m.id
    order by data desc limit 1
  ) p on true
  where m.id = any(p_ids) and m.aprovada
$function$
;

CREATE OR REPLACE FUNCTION public.fieldo_chave_categoria(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select nullif(btrim(regexp_replace(
           translate(lower(btrim(coalesce(p, ''))),
                     'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
           '[^a-z0-9]+', '-', 'g'), '-'), '')
$function$
;

CREATE OR REPLACE FUNCTION public.fieldo_eh_foto_de_trabalho(p_desc text, p_cliente text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select coalesce(p_desc ~* '^\s*(teste|subir google|test)\s*$', false)
      or coalesce(p_cliente ~* '^\s*(teste|subir\s+g\S*)(\s+\d+)?\s*$', false)
$function$
;

CREATE OR REPLACE FUNCTION public.fieldo_titulo_servico(p_desc text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  re_dinheiro constant text :=
    '(r\$|\$\s*\d|\yreais\y|\yvalor|\yempreitada|\ysaldo|\ycobran[cç]a|\ypagamento|\ypagar\y|\ypendente|\ytotal\y|\yor[cç]amento|\ydesconto|\ypix\y|\yacerto\y)';
  re_generico constant text :=
    '^(servi[cç]os?( realizados?| executados?)?|finaliza[cç][aã]o( dos servi[cç]os)?|descri[cç][aã]o( t[eé]cnica)?( dos servi[cç]os)?( el[eé]tricos)?|resumo|relat[oó]rio|ol[aá]|bom dia|boa tarde|boa noite|condi[cç][oõ]es comerciais|observa[cç][oõ]es)[\s:.!,-]*$';
  re_saudacao constant text :=
    '^(ol[aá]|oi|bom dia|boa tarde|boa noite|prezad[oa]s?|obrigad[oa]|obg)(?=[\s,.!;:]|$)';
  v_linhas text[];
  v_frases text[] := '{}';
  v_ln text;
  v_l text;
  i int;
begin
  if p_desc is null or btrim(p_desc) = '' then
    return null;
  end if;

  v_linhas := (regexp_split_to_array(p_desc, E'\r?\n'))[1:8];
  foreach v_ln in array v_linhas loop
    v_frases := v_frases || regexp_split_to_array(v_ln, '(?<=[.!?])\s+');
  end loop;

  for i in 1 .. least(coalesce(array_length(v_frases, 1), 0), 12) loop
    v_l := v_frases[i];
    v_l := regexp_replace(v_l, '^[\s#>*–—•·-]+', '');
    v_l := regexp_replace(v_l, '^\d+\s*\\?[.)]\s*', '');
    v_l := regexp_replace(v_l, '[*_`]+', '', 'g');
    v_l := regexp_replace(v_l, '\(\s*\$?\s*[0-9.,]+\s*\)', '', 'g');
    v_l := regexp_replace(v_l, '\s+', ' ', 'g');
    v_l := regexp_replace(v_l, '^\s+|\s+$', '', 'g');
    continue when char_length(v_l) < 4;
    continue when v_l ~* re_dinheiro;
    continue when v_l ~* re_generico;
    continue when v_l ~* re_saudacao;
    v_l := regexp_replace(v_l, '[\s:;,.]+$', '');
    return upper(left(v_l, 1)) || substr(v_l, 2);
  end loop;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.get_council_key()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
declare
  k text;
begin
  select decrypted_secret into k
    from vault.decrypted_secrets
   where name = 'council_key'
   limit 1;
  return k;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_impact_funnel(p_dias integer DEFAULT 30)
 RETURNS TABLE(cards_gerados integer, entraram_perfil integer, cliques_whatsapp integer, pediram_orcamento integer, servicos_fechados integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    (select count(*)::int from impact_events
      where professional_id = auth.uid()
        and event_type = 'card_generated'
        and created_at >= now() - (p_dias || ' days')::interval),
    (select count(*)::int from impact_events
      where professional_id = auth.uid()
        and event_type = 'view'
        and created_at >= now() - (p_dias || ' days')::interval),
    (select count(*)::int from impact_events
      where professional_id = auth.uid()
        and event_type = 'whatsapp_click'
        and created_at >= now() - (p_dias || ' days')::interval),
    (select count(*)::int from budgets
      where professional_id = auth.uid()
        and created_at >= now() - (p_dias || ' days')::interval),
    (select count(*)::int from reports
      where professional_id = auth.uid()
        and arquivado_em is null
        and created_at >= now() - (p_dias || ' days')::interval)
$function$
;

CREATE OR REPLACE FUNCTION public.get_integrity_cron_key()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
  select decrypted_secret from vault.decrypted_secrets where name = 'integrity_cron_key' limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_project_snapshot_key()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
declare
  k text;
begin
  select decrypted_secret into k
    from vault.decrypted_secrets
   where name = 'project_snapshot_key'
   limit 1;
  return k;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_version_manager_key()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
  select decrypted_secret from vault.decrypted_secrets where name = 'version_manager_key' limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.impedir_delete_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare v_restantes bigint; v_afetadas bigint; v_antes bigint;
begin
  execute format('select count(*) from %I.%I', tg_table_schema, tg_table_name)
    into v_restantes;
  select count(*) into v_afetadas from afetadas;
  v_antes := v_restantes + v_afetadas;

  /* Bloqueia quando a tabela tinha mais de 3 linhas e NENHUMA sobrou —
     assinatura de DELETE sem WHERE. Limpeza pequena continua livre. */
  if v_antes > 3 and v_restantes = 0 then
    raise exception
      'DELETE sem filtro em %.%: apagaria as % linhas da tabela. Use WHERE.',
      tg_table_schema, tg_table_name, v_afetadas
      using errcode = 'raise_exception',
            hint = 'Se a limpeza total for intencional, remova o gatilho trg_protege_% antes.';
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.lgpd_aplicar_retencao()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               $function$
;

CREATE OR REPLACE FUNCTION public.limitar_reports_plano_gratis()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_inicio timestamptz;
    v_usados int;
      c_limite constant int := 5;
      begin
        if not private.chamada_de_usuario() then
            return new;
              end if;
                if private.is_pro(new.professional_id) then
                    return new;
                      end if;

                        -- Serializa inserts simultâneos do mesmo profissional, para dois
                          -- envios em paralelo não passarem os dois com 4 usados.
                            perform pg_advisory_xact_lock(hashtextextended('reports_quota:' || new.professional_id::text, 0));

                              v_inicio := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';

                                select count(*) into v_usados
                                    from public.reports
                                       where professional_id = new.professional_id
                                            and created_at >= v_inicio;

                                              if v_usados >= c_limite then
                                                  raise exception 'Limite do plano grátis atingido: % serviços por mês. Assine o Pro para registrar mais.', c_limite
                                                        using errcode = 'P0001', hint = 'limite_plano_gratis';
                                                          end if;

                                                            return new;
                                                            end $function$
;

CREATE OR REPLACE FUNCTION public.listas_estimadas()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select count(*)::int from material_listas
  where professional_id = (select auth.uid()) and estimada_em is not null
$function$
;

CREATE OR REPLACE FUNCTION public.loc_contrato_assinar_cliente(p_token text, p_nome text, p_documento text, p_aceite boolean, p_aceite_versao text, p_aceite_texto text, p_traco text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                end $function$
;

CREATE OR REPLACE FUNCTION public.loc_contrato_assinar_locadora(p_id uuid, p_aceite boolean, p_aceite_versao text, p_aceite_texto text, p_traco text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            end $function$
;

CREATE OR REPLACE FUNCTION public.loc_contrato_cancelar(p_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                       end $function$
;

CREATE OR REPLACE FUNCTION public.loc_contrato_criar(p_locacao_id uuid, p_clausulas jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               end $function$
;

CREATE OR REPLACE FUNCTION public.loc_contrato_enviar(p_id uuid, p_texto text, p_validade_dias integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                                                                                                                                                                               end $function$
;

CREATE OR REPLACE FUNCTION public.loc_contrato_modelo_salvar(p_clausulas jsonb, p_condicoes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                                                                                                                                                           end $function$
;

CREATE OR REPLACE FUNCTION public.loc_contrato_nova_versao(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                                                                                            end $function$
;

CREATE OR REPLACE FUNCTION public.loc_contrato_novo_link(p_id uuid, p_validade_dias integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                             end $function$
;

CREATE OR REPLACE FUNCTION public.loc_contrato_por_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 end $function$
;

CREATE OR REPLACE FUNCTION public.loc_contrato_recusar(p_token text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      end $function$
;

CREATE OR REPLACE FUNCTION public.loc_contrato_registrar_pdf(p_id uuid, p_path text, p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              end $function$
;

CREATE OR REPLACE FUNCTION public.loc_contrato_revogar_link(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
                                                                                                                                                                                                                             declare v_uid uuid := auth.uid(); c public.loc_contratos;
                                                                                                                                                                                                                             begin
                                                                                                                                                                                                                               if v_uid is null then return public._loc_err('nao_autenticado'); end if;
                                                                                                                                                                                                                                 select * into c from public.loc_contratos where id = p_id and locadora_id = v_uid for update;
                                                                                                                                                                                                                                   if not found then return public._loc_err('nao_encontrado'); end if;
                                                                                                                                                                                                                                     if c.status not in ('aguardando_cliente','aguardando_locadora') then return public._loc_err('estado_invalido'); end if;
                                                                                                                                                                                                                                       update public.loc_contratos set revogado_em = now(), updated_at = now() where id = c.id;
                                                                                                                                                                                                                                         perform public._loc_evento(c.id, v_uid, 'link_revogado', 'locadora');
                                                                                                                                                                                                                                           return jsonb_build_object('ok', true);
                                                                                                                                                                                                                                           end $function$
;

CREATE OR REPLACE FUNCTION public.loc_contrato_salvar(p_id uuid, p_edicao jsonb DEFAULT '{}'::jsonb, p_clausulas jsonb DEFAULT NULL::jsonb, p_resync boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           end $function$
;

CREATE OR REPLACE FUNCTION public.locadora_slug_livre(p_base text, p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_slug text; v_n int := 1;
begin
  if p_base is null or p_base = '' then return null; end if;
  v_slug := p_base;
  while exists (select 1 from public.locadoras
                 where slug = v_slug and (p_id is null or id <> p_id)) loop
    v_n := v_n + 1;
    v_slug := p_base || '-' || v_n;
    if v_n > 500 then
      return p_base || '-' || replace(gen_random_uuid()::text,'-','');
    end if;
  end loop;
  return v_slug;
end $function$
;

CREATE OR REPLACE FUNCTION public.log_impact_event(p_professional_id uuid, p_event_type text, p_source text DEFAULT 'organico'::text, p_report_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                declare
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  v_recentes int;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  begin
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    if p_event_type not in ('card_generated', 'view', 'whatsapp_click', 'call_click') then
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        raise exception 'event_type inválido';
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          end if;

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            if not exists (
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                select 1 from professionals
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     where id = p_professional_id and is_public = true
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       ) then
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           raise exception 'profissional não encontrado ou não público';
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             end if;

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               select count(*) into v_recentes
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   from impact_events
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      where professional_id = p_professional_id
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           and event_type = p_event_type
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                and created_at > now() - interval '1 hour';

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  if v_recentes >= 60 then
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      return;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        end if;

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          insert into impact_events (professional_id, event_type, source, report_id)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            values (p_professional_id, p_event_type, left(coalesce(nullif(p_source, ''), 'organico'), 40), p_report_id);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            end;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            $function$
;

CREATE OR REPLACE FUNCTION public.marcar_resposta_avaliacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.resposta is distinct from old.resposta then
    new.respondido_em := case
      when new.resposta is null or btrim(new.resposta) = '' then null
      else now() end;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.mcp_create_budget(p_raw_key text, p_client_name text, p_items jsonb, p_titulo text DEFAULT NULL::text, p_client_phone text DEFAULT NULL::text, p_local text DEFAULT NULL::text, p_descricao text DEFAULT NULL::text, p_desconto numeric DEFAULT 0, p_prazo text DEFAULT NULL::text, p_validade text DEFAULT NULL::text, p_pagamento text DEFAULT NULL::text, p_garantia text DEFAULT NULL::text, p_observacoes text DEFAULT NULL::text, p_emissao date DEFAULT NULL::date, p_number text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS budgets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_prof      uuid;
  v_row       public.budgets;
  v_name      text;
  v_item      jsonb;
  v_subtotal  numeric := 0;
  v_desconto  numeric;
  v_total     numeric;
  v_number    text;
begin
  v_prof := public._mcp_resolve_identity(p_raw_key, true);

  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    select * into v_row from public.budgets
     where professional_id = v_prof and mcp_idempotency_key = trim(p_idempotency_key);
    if found then
      return v_row;
    end if;
  end if;

  v_name := trim(coalesce(p_client_name, ''));
  if v_name = '' then
    raise exception 'client_name é obrigatório' using errcode = '22023';
  end if;
  if char_length(v_name) > 200 then
    raise exception 'client_name muito longo (máx. 200 caracteres)' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items precisa ser uma lista com pelo menos um item, cada um com "descricao" e "valor"' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if coalesce(trim(v_item->>'descricao'), '') = '' then
      raise exception 'cada item precisa de "descricao" (texto)' using errcode = '22023';
    end if;
    if (v_item->>'valor') is null or (v_item->>'valor') !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'cada item precisa de "valor" (número maior ou igual a zero)' using errcode = '22023';
    end if;
    v_subtotal := v_subtotal + (v_item->>'valor')::numeric;
  end loop;

  v_desconto := coalesce(p_desconto, 0);
  if v_desconto < 0 then
    raise exception 'desconto precisa ser maior ou igual a zero' using errcode = '22023';
  end if;
  v_total := greatest(0, v_subtotal - v_desconto);

  -- RFC-001 M5: p_number IGNORADO. O número nasce no banco.
  v_number := public._budget_next_number(v_prof);

  insert into public.budgets (
    professional_id, number, titulo, client_name, client_phone, local,
    descricao, items, subtotal, desconto, total, prazo, validade,
    pagamento, garantia, observacoes, emissao, mcp_idempotency_key
  ) values (
    v_prof, v_number, nullif(trim(coalesce(p_titulo, '')), ''), v_name,
    nullif(trim(coalesce(p_client_phone, '')), ''),
    nullif(trim(coalesce(p_local, '')), ''),
    nullif(trim(coalesce(p_descricao, '')), ''),
    p_items, v_subtotal, v_desconto, v_total,
    nullif(trim(coalesce(p_prazo, '')), ''),
    nullif(trim(coalesce(p_validade, '')), ''),
    nullif(trim(coalesce(p_pagamento, '')), ''),
    nullif(trim(coalesce(p_garantia, '')), ''),
    nullif(trim(coalesce(p_observacoes, '')), ''),
    coalesce(p_emissao, current_date),
    nullif(trim(coalesce(p_idempotency_key, '')), '')
  )
  returning * into v_row;

  return v_row;
end
$function$
;

CREATE OR REPLACE FUNCTION public.mcp_create_service_report(p_raw_key text, p_client_name text, p_service_description text DEFAULT NULL::text, p_category_key text DEFAULT NULL::text, p_niche text DEFAULT NULL::text, p_service_location text DEFAULT NULL::text, p_valor numeric DEFAULT NULL::numeric, p_service_date date DEFAULT NULL::date)
 RETURNS reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_prof uuid;
  v_row  public.reports;
  v_name text;
begin
  v_prof := public._mcp_resolve_identity(p_raw_key, true);

  v_name := trim(coalesce(p_client_name, ''));
  if v_name = '' then
    raise exception 'client_name é obrigatório' using errcode = '22023';
  end if;
  if char_length(v_name) > 200 then
    raise exception 'client_name muito longo (máx. 200 caracteres)' using errcode = '22023';
  end if;
  if p_valor is not null and p_valor < 0 then
    raise exception 'valor precisa ser maior ou igual a zero' using errcode = '22023';
  end if;

  insert into public.reports (
    professional_id, client_name, service_description,
    category_key, category_label, niche, service_location,
    service_date, valor, payment_status
  ) values (
    v_prof, v_name, nullif(trim(coalesce(p_service_description, '')), ''),
    nullif(trim(coalesce(p_category_key, '')), ''),
    nullif(trim(coalesce(p_category_key, '')), ''),
    coalesce(nullif(trim(coalesce(p_niche, '')), ''), nullif(trim(coalesce(p_category_key, '')), '')),
    nullif(trim(coalesce(p_service_location, '')), ''),
    coalesce(p_service_date, current_date),
    p_valor,
    case when p_valor is not null then 'pendente' else 'nao_cobrado' end
  )
  returning * into v_row;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mcp_generate_key(p_name text DEFAULT 'Chave MCP'::text)
 RETURNS TABLE(id uuid, name text, raw_key text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_raw     text;
  v_hash    text;
  v_id      uuid;
  v_created timestamptz;
  v_name    text;
begin
  if auth.uid() is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;

  v_name := coalesce(nullif(trim(p_name), ''), 'Chave MCP');
  if char_length(v_name) > 80 then
    raise exception 'nome muito longo (máx. 80 caracteres)' using errcode = '22023';
  end if;

  v_raw  := 'fmcp_' || encode(gen_random_bytes(24), 'hex');
  v_hash := encode(digest(v_raw, 'sha256'), 'hex');

  insert into public.mcp_api_keys (professional_id, name, key_hash)
  values (auth.uid(), v_name, v_hash)
  returning mcp_api_keys.id, mcp_api_keys.created_at into v_id, v_created;

  return query select v_id, v_name, v_raw, v_created;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mcp_get_account_usage(p_raw_key text)
 RETURNS TABLE(professional_id uuid, plan text, used_this_month integer, "limit" integer, remaining integer, allowed_to_create boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_prof      uuid;
  v_plan      text;
  v_used      int;
  v_limit     int;
  v_first_day date;
begin
  v_prof := public._mcp_resolve_identity(p_raw_key);

  -- v12.40: Pro vencido conta como grátis (mesma regra da RLS de Contratos)
  v_plan := case when private.is_pro(v_prof) then 'pro' else 'free' end;

  v_first_day := date_trunc('month', now())::date;

  select count(*)::int into v_used
  from public.reports r
  where r.professional_id = v_prof and r.created_at >= v_first_day;

  v_limit := case when v_plan = 'pro' then null else 5 end;

  return query select
    v_prof,
    v_plan,
    v_used,
    v_limit,
    case when v_limit is null then null else greatest(0, v_limit - v_used) end,
    case when v_limit is null then true else v_used < v_limit end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mcp_get_budget(p_raw_key text, p_budget_id uuid)
 RETURNS budgets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_prof uuid;
  v_row  public.budgets;
begin
  v_prof := public._mcp_resolve_identity(p_raw_key);

  if p_budget_id is null then
    raise exception 'orçamento não encontrado' using errcode = 'P0002';
  end if;

  select * into v_row from public.budgets
   where id = p_budget_id and professional_id = v_prof;

  if not found then
    raise exception 'orçamento não encontrado' using errcode = 'P0002';
  end if;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mcp_get_my_profile(p_raw_key text)
 RETURNS professionals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_prof uuid;
  v_row  public.professionals;
begin
  v_prof := public._mcp_resolve_identity(p_raw_key);

  select * into v_row from public.professionals where id = v_prof;

  if not found then
    raise exception 'perfil não encontrado' using errcode = 'P0002';
  end if;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mcp_get_public_profile(p_slug text)
 RETURNS TABLE(id uuid, name text, profissao text, specialty text, niche text, city text, slug text, whatsapp text, bio text, logo_url text, instagram text, pix_key text, pix_tipo text, include_pix boolean, plan text, is_public boolean, portfolio_publico boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
                                                                               declare
                                                                                 v_slug text;
                                                                                 begin
                                                                                   v_slug := trim(coalesce(p_slug, ''));
                                                                                     if v_slug = '' then
                                                                                         raise exception 'slug é obrigatório' using errcode = '22023';
                                                                                           end if;

                                                                                             return query
                                                                                                 select
                                                                                                       p.id, p.name, p.profissao, p.specialty, p.niche,
                                                                                                             p.city, p.slug, p.whatsapp, p.bio, p.logo_url,
                                                                                                                   p.instagram,
                                                                                                                         case when coalesce(p.include_pix, true) then p.pix_key  end,
                                                                                                                               case when coalesce(p.include_pix, true) then p.pix_tipo end,
                                                                                                                                     p.include_pix,
                                                                                                                                           p.plan, p.is_public, p.portfolio_publico, p.created_at
                                                                                                                                               from public.professionals p
                                                                                                                                                   where p.slug = v_slug
                                                                                                                                                         and (
                                                                                                                                                                 p.is_public
                                                                                                                                                                         or exists (select 1 from public.reports r where r.professional_id = p.id and r.is_public)
                                                                                                                                                                               )
                                                                                                                                                                                   limit 1;
                                                                                                                                                                                   end;
                                                                                                                                                                                   $function$
;

CREATE OR REPLACE FUNCTION public.mcp_get_service_report(p_raw_key text, p_report_id uuid)
 RETURNS reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_prof uuid;
  v_row  public.reports;
begin
  v_prof := public._mcp_resolve_identity(p_raw_key);

  if p_report_id is null then
    raise exception 'relatório não encontrado' using errcode = 'P0002';
  end if;

  select * into v_row from public.reports
   where id = p_report_id and professional_id = v_prof;

  if not found then
    raise exception 'relatório não encontrado' using errcode = 'P0002';
  end if;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mcp_list_budgets(p_raw_key text, p_limit integer DEFAULT 5)
 RETURNS SETOF budgets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_prof  uuid;
  v_limit int;
begin
  v_prof  := public._mcp_resolve_identity(p_raw_key);
  v_limit := greatest(1, least(50, coalesce(p_limit, 5)));

  return query
    select * from public.budgets
    where professional_id = v_prof
    order by created_at desc
    limit v_limit;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mcp_list_service_reports(p_raw_key text, p_limit integer DEFAULT 5)
 RETURNS SETOF reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_prof  uuid;
  v_limit int;
begin
  v_prof  := public._mcp_resolve_identity(p_raw_key);
  v_limit := greatest(1, least(50, coalesce(p_limit, 5)));

  return query
    select * from public.reports
    where professional_id = v_prof
    order by created_at desc
    limit v_limit;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mcp_update_my_profile(p_raw_key text, p_name text DEFAULT NULL::text, p_profissao text DEFAULT NULL::text, p_niche text DEFAULT NULL::text, p_bio text DEFAULT NULL::text, p_city text DEFAULT NULL::text)
 RETURNS professionals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_prof      uuid;
  v_row       public.professionals;
  v_name      text;
  v_profissao text;
  v_niche     text;
  v_bio       text;
  v_city      text;
begin
  v_prof := public._mcp_resolve_identity(p_raw_key, true);

  v_name      := nullif(trim(coalesce(p_name, '')), '');
  v_profissao := nullif(trim(coalesce(p_profissao, '')), '');
  v_niche     := nullif(trim(coalesce(p_niche, '')), '');
  v_bio       := nullif(trim(coalesce(p_bio, '')), '');
  v_city      := nullif(trim(coalesce(p_city, '')), '');

  if v_name is not null and char_length(v_name) > 200 then
    raise exception 'name muito longo (máx. 200 caracteres)' using errcode = '22023';
  end if;
  if v_profissao is not null and char_length(v_profissao) > 200 then
    raise exception 'profissao muito longa (máx. 200 caracteres)' using errcode = '22023';
  end if;
  if v_niche is not null and char_length(v_niche) > 200 then
    raise exception 'niche muito longo (máx. 200 caracteres)' using errcode = '22023';
  end if;
  if v_bio is not null and char_length(v_bio) > 1000 then
    raise exception 'bio muito longa (máx. 1000 caracteres)' using errcode = '22023';
  end if;
  if v_city is not null and char_length(v_city) > 200 then
    raise exception 'city muito longa (máx. 200 caracteres)' using errcode = '22023';
  end if;

  if v_name is null and v_profissao is null and v_niche is null and v_bio is null and v_city is null then
    raise exception 'informe pelo menos um campo pra atualizar (name, profissao, niche, bio ou city)' using errcode = '22023';
  end if;

  update public.professionals set
    name      = coalesce(v_name, name),
    profissao = coalesce(v_profissao, profissao),
    niche     = coalesce(v_niche, niche),
    bio       = coalesce(v_bio, bio),
    city      = coalesce(v_city, city)
  where id = v_prof
  returning * into v_row;

  if not found then
    raise exception 'perfil não encontrado' using errcode = 'P0002';
  end if;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.meus_dados()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   $function$
;

CREATE OR REPLACE FUNCTION public.minha_assinatura()
 RETURNS TABLE(status text, ciclo text, valor numeric, proxima_cobranca date, invoice_url text, plano text, plano_expira_em timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select a.status, a.ciclo, a.valor, a.proxima_cobranca, a.invoice_url, p.plan, p.plan_expires_at
  from professionals p
  left join assinaturas a on a.professional_id = p.id
  where p.id = (select auth.uid())
$function$
;

CREATE OR REPLACE FUNCTION public.minhas_metricas(p_dias integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_prof   uuid := auth.uid();
  v_dias   int  := least(greatest(coalesce(p_dias, 30), 7), 90);
  v_ini    timestamptz := now() - make_interval(days => v_dias);
  v_ini_ant timestamptz := now() - make_interval(days => v_dias * 2);
  v_pro    boolean;
  v_atual  jsonb;
  v_ant    jsonb;
  v_origem jsonb;
  v_dia    jsonb;
begin
  if v_prof is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;

  v_pro := private.is_pro(v_prof);

  with ev as (
    select event_type, coalesce(nullif(source, ''), 'direto') as origem, created_at
      from public.impact_events
     where professional_id = v_prof
       and created_at >= v_ini_ant
       and coalesce(source, '') not in ('127.0.0.1', 'interno')
  )
  select
    jsonb_build_object(
      'visualizacoes',    count(*) filter (where event_type = 'view'           and created_at >= v_ini),
      'cliques_whatsapp', count(*) filter (where event_type = 'whatsapp_click' and created_at >= v_ini),
      'cards_gerados',    count(*) filter (where event_type = 'card_generated' and created_at >= v_ini)
    ),
    jsonb_build_object(
      'visualizacoes',    count(*) filter (where event_type = 'view'           and created_at < v_ini),
      'cliques_whatsapp', count(*) filter (where event_type = 'whatsapp_click' and created_at < v_ini)
    )
  into v_atual, v_ant
  from ev;

  if v_pro then
    select coalesce(jsonb_agg(o order by (o->>'visualizacoes')::int desc, (o->>'cliques_whatsapp')::int desc), '[]'::jsonb)
      into v_origem
      from (
        select jsonb_build_object(
                 'origem', coalesce(nullif(source, ''), 'direto'),
                 'visualizacoes',    count(*) filter (where event_type = 'view'),
                 'cliques_whatsapp', count(*) filter (where event_type = 'whatsapp_click')
               ) as o
          from public.impact_events
         where professional_id = v_prof
           and created_at >= v_ini
           and coalesce(source, '') not in ('127.0.0.1', 'interno')
         group by coalesce(nullif(source, ''), 'direto')
      ) s;

    select coalesce(jsonb_agg(jsonb_build_object(
             'dia', d::date,
             'visualizacoes',    coalesce(x.v, 0),
             'cliques_whatsapp', coalesce(x.c, 0)) order by d), '[]'::jsonb)
      into v_dia
      from generate_series((now() at time zone 'America/Sao_Paulo')::date - (v_dias - 1),
                           (now() at time zone 'America/Sao_Paulo')::date, interval '1 day') d
      left join (
        select (created_at at time zone 'America/Sao_Paulo')::date as dia,
               count(*) filter (where event_type = 'view')           as v,
               count(*) filter (where event_type = 'whatsapp_click') as c
          from public.impact_events
         where professional_id = v_prof
           and created_at >= v_ini
           and coalesce(source, '') not in ('127.0.0.1', 'interno')
         group by 1
      ) x on x.dia = d::date;
  end if;

  return jsonb_build_object(
    'dias',      v_dias,
    'pro',       v_pro,
    'atual',     v_atual,
    -- amostra pequena: abaixo de 30 visualizações, taxa e comparação
    -- enganam mais do que informam — a tela avisa em vez de esconder.
    'amostra_pequena', (v_atual->>'visualizacoes')::int < 30,
    'anterior',  case when v_pro then v_ant end,
    'por_origem', v_origem,
    'por_dia',    v_dia
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.next_change_id()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n bigint;
begin
  n := nextval('public.change_id_seq');
  return 'CHANGE-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 4, '0');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.next_snapshot_id()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n integer;
  hoje text := to_char(now(), 'YYYY.MM.DD');
begin
  select count(*) + 1 into n
    from public.project_snapshots
   where created_at::date = now()::date;
  return hoje || '.' || lpad(n::text, 3, '0');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.normalizar_city_slug(p_city text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare s text;
begin
  if p_city is null or btrim(p_city) = '' then return null; end if;

  s := lower(btrim(p_city));

  -- acentos, sem depender da extensao unaccent (que nao esta instalada)
  s := translate(s,
        'áàâãäéèêëíìîïóòôõöúùûüçñ',
        'aaaaaeeeeiiiiooooouuuucn');

  s := regexp_replace(s, '[^a-z0-9]+', '-', 'g');
  s := btrim(s, '-');

  -- sufixo de UF vira lixo para agrupar: "caraguatatuba-sp" e
  -- "caraguatatuba" sao a mesma cidade. A UF mora na coluna `uf`.
  s := regexp_replace(s,
        '-(ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)$',
        '');

  -- Apelidos locais. Lista deliberadamente CURTA e explicita: cada
  -- entrada e um caso visto no banco, nao um palpite. "Caragua" e o
  -- apelido corrente de Caraguatatuba no litoral norte paulista.
  s := case s
         when 'caragua'  then 'caraguatatuba'
         when 'sampa'    then 'sao-paulo'
         when 'sp'       then 'sao-paulo'
         when 'rio'      then 'rio-de-janeiro'
         when 'bh'       then 'belo-horizonte'
         else s
       end;

  return nullif(s, '');
end $function$
;

CREATE OR REPLACE FUNCTION public.obra_contrato_assinar_cliente(p_token text, p_nome text, p_documento text, p_aceite boolean, p_aceite_versao text, p_aceite_texto text, p_traco text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.obra_contrato_cancelar(p_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); c public.obra_contratos;
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  select * into c from public.obra_contratos where id = p_id and professional_id = v_uid for update;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.status not in ('rascunho','aguardando_cliente') then return public._loc_err('estado_invalido'); end if;
  update public.obra_contratos set status = 'cancelado', revogado_em = coalesce(revogado_em, now()), updated_at = now() where id = c.id;
  perform public._oc_evento(c.id, v_uid, 'cancelado', 'contratada', jsonb_build_object('motivo', left(p_motivo, 500)));
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.obra_contrato_criar(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.obra_contrato_enviar(p_id uuid, p_texto text, p_aceite boolean, p_aceite_versao text, p_aceite_texto text, p_traco text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_validade_dias integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.obra_contrato_nova_versao(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.obra_contrato_novo_link(p_id uuid, p_validade_dias integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.obra_contrato_por_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.obra_contrato_recusar(p_token text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare t jsonb; c public.obra_contratos;
begin
  t := public._oc_do_token(p_token, true);
  if (t ->> 'ok')::boolean is not true then return t; end if;
  select * into c from public.obra_contratos where id = (t ->> 'id')::uuid;
  if c.status <> 'aguardando_cliente' then return public._loc_err('estado_invalido'); end if;
  update public.obra_contratos set status = 'recusado', updated_at = now() where id = c.id;
  perform public._oc_evento(c.id, c.professional_id, 'recusado', 'contratante', jsonb_build_object('motivo', left(p_motivo, 500)));
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.obra_contrato_registrar_pdf(p_id uuid, p_path text, p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.obra_contrato_salvar(p_id uuid, p_edicao jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); c public.obra_contratos; d jsonb;
begin
  if v_uid is null then return public._loc_err('nao_autenticado'); end if;
  select * into c from public.obra_contratos where id = p_id and professional_id = v_uid for update;
  if not found then return public._loc_err('nao_encontrado'); end if;
  if c.status <> 'rascunho' then return public._loc_err('nao_editavel'); end if;
  d := public._oc_merge(c.dados, p_edicao);
  update public.obra_contratos set dados = d, updated_at = now() where id = c.id;
  return jsonb_build_object('ok', true, 'dados', d, 'faltam', to_jsonb(public._oc_faltam(d)));
end $function$
;

CREATE OR REPLACE FUNCTION public.obra_resumo(p_token text DEFAULT NULL::text, p_report_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.obras_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
                    begin new.updated_at := now(); return new; end $function$
;

CREATE OR REPLACE FUNCTION public.orcamento_por_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare b public.budgets%rowtype;
begin
  select * into b from public.budgets where approval_token = p_token;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', b.id, 'professional_id', b.professional_id,
    'number', b.number, 'titulo', b.titulo,
    'client_name', b.client_name, 'local', b.local,
    'descricao', b.descricao, 'items', b.items,
    'subtotal', b.subtotal, 'desconto', b.desconto, 'total', b.total,
    'prazo', b.prazo, 'validade', b.validade, 'pagamento', b.pagamento,
    'garantia', b.garantia, 'observacoes', b.observacoes,
    'emissao', b.emissao, 'status', b.status,
    'approved_at', b.approved_at, 'approval_note', b.approval_note,
    'client_signature', b.client_signature,
    'linked_report_id', b.linked_report_id,
    'created_at', b.created_at
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.orcamento_publico(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare b public.budgets%rowtype;
begin
  select * into b from public.budgets where id = p_id and is_public;
    if not found then return null; end if;
      return jsonb_build_object(
          'id', b.id, 'professional_id', b.professional_id,
              'number', b.number, 'titulo', b.titulo,
                  'client_name', b.client_name, 'local', b.local,
                      'descricao', b.descricao, 'items', b.items,
                          'subtotal', b.subtotal, 'desconto', b.desconto, 'total', b.total,
                              'prazo', b.prazo, 'validade', b.validade, 'pagamento', b.pagamento,
                                  'garantia', b.garantia, 'observacoes', b.observacoes,
                                      'emissao', b.emissao, 'status', b.status, 'is_public', b.is_public,
                                          'approved_at', b.approved_at, 'approval_note', b.approval_note,
                                              'client_signature', b.client_signature,
                                                  'linked_report_id', b.linked_report_id,
                                                      'created_at', b.created_at, 'updated_at', b.updated_at
                                                        );
                                                        end $function$
;

CREATE OR REPLACE FUNCTION public.plano_ciclo_diario()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_avisos     int := 0;
  v_rebaixados int := 0;
  r            record;
  v_dias       int;
begin
  -- Avisos: Pro que termina nos próximos 5 dias. Um aviso por dia.
  for r in
    select id, plan_expires_at
      from public.professionals
     where plan = 'pro'
       and plan_expires_at is not null
       and plan_expires_at > now()
       and plan_expires_at <= now() + interval '5 days'
  loop
    v_dias := greatest(1, ceil(extract(epoch from (r.plan_expires_at - now())) / 86400)::int);
    insert into public.notificacoes (professional_id, tipo, titulo, mensagem, link, chave)
    values (
      r.id, 'pro_vencendo',
      case when v_dias = 1 then 'Seu Pro termina amanhã'
           else 'Seu Pro termina em ' || v_dias || ' dias' end,
      'O plano Pro vale até ' || to_char(r.plan_expires_at at time zone 'America/Sao_Paulo', 'DD/MM') ||
      '. Depois disso a conta volta para o plano grátis — seus serviços, orçamentos e contratos continuam salvos.',
      'planos.html',
      'pro_vencendo:' || r.id || ':' || (now() at time zone 'America/Sao_Paulo')::date
    )
    on conflict (chave) do nothing;
    if found then v_avisos := v_avisos + 1; end if;
  end loop;

  -- Volta ao grátis: prazo passou. plan_expires_at fica como histórico.
  for r in
    update public.professionals
       set plan = 'free'
     where plan = 'pro'
       and plan_expires_at is not null
       and plan_expires_at <= now()
    returning id, plan_expires_at
  loop
    v_rebaixados := v_rebaixados + 1;
    insert into public.notificacoes (professional_id, tipo, titulo, mensagem, link, chave)
    values (
      r.id, 'pro_encerrado',
      'Sua conta voltou para o plano grátis',
      'O Pro terminou em ' || to_char(r.plan_expires_at at time zone 'America/Sao_Paulo', 'DD/MM') ||
      '. Nada foi apagado: seus dados continuam aqui. Para voltar ao Pro, é só ativar de novo em Planos.',
      'planos.html',
      'pro_encerrado:' || r.id || ':' || r.plan_expires_at::date
    )
    on conflict (chave) do nothing;
  end loop;

  return jsonb_build_object('avisos', v_avisos, 'rebaixados', v_rebaixados, 'em', now());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.professional_pix_publico(p_professional_id uuid)
 RETURNS TABLE(id uuid, name text, profissao text, city text, whatsapp text, logo_url text, pix_key text, pix_tipo text, include_pix boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  return query
      select p.id, p.name, p.profissao, p.city, p.whatsapp, p.logo_url,
                 case when coalesce(p.include_pix, true) then p.pix_key  end,
                            case when coalesce(p.include_pix, true) then p.pix_tipo end,
                                       p.include_pix
                                           from public.professionals p
                                               where p.id = p_professional_id
                                                     and (
                                                             p.is_public
                                                                     or exists (select 1 from public.reports r where r.professional_id = p.id and r.is_public)
                                                                           )
                                                                               limit 1;
                                                                               end;
                                                                               $function$
;

CREATE OR REPLACE FUNCTION public.recalc_locadora_publica(p_loc uuid)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public', 'pg_temp'
AS $function$
  update public.locadoras set is_public = exists (
    select 1 from public.equipamentos
     where locadora_id = p_loc and is_public and ativo)
   where id = p_loc;
$function$
;

CREATE OR REPLACE FUNCTION public.registrar_aceite(p_documento text, p_versao text, p_aceito boolean DEFAULT true, p_origem text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                                                                                                                                                               $function$
;

CREATE OR REPLACE FUNCTION public.registrar_aceite_portfolio()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.portfolio_publico and not old.portfolio_publico then
    new.portfolio_aceito_em := now();
  elsif not new.portfolio_publico then
    new.portfolio_aceito_em := null;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.registrar_acesso()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                                                                                                                 $function$
;

CREATE OR REPLACE FUNCTION public.registrar_pedido_titular(p_tipo text, p_contato text DEFAULT NULL::text, p_detalhe text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                                                                                                                                                                                                                                                                                                                   $function$
;

CREATE OR REPLACE FUNCTION public.relatorio_do_orcamento(p_budget_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
                                                        declare r public.reports%rowtype;
                                                        begin
                                                          if not exists (select 1 from public.budgets b where b.id = p_budget_id and b.is_public) then
                                                              return null;
                                                                end if;

                                                                  select * into r from public.reports
                                                                     where is_public
                                                                          and (linked_budget_id = p_budget_id
                                                                                    or id = (select b.linked_report_id from public.budgets b where b.id = p_budget_id))
                                                                                       order by created_at desc
                                                                                          limit 1;
                                                                                            if not found then return null; end if;

                                                                                              return jsonb_build_object(
                                                                                                  'id', r.id, 'professional_id', r.professional_id,
                                                                                                      'client_name', r.client_name, 'cliente_curto', r.cliente_curto,
                                                                                                          'category_key', r.category_key, 'category_label', r.category_label,
                                                                                                              'niche', r.niche, 'service_date', r.service_date,
                                                                                                                  'service_location', r.service_location,
                                                                                                                      'service_description', r.service_description,
                                                                                                                          'photos', r.photos, 'is_public', r.is_public,
                                                                                                                              'rating', r.rating, 'rating_comment', r.rating_comment,
                                                                                                                                  'rating_used', r.rating_used, 'portfolio_ok', r.portfolio_ok,
                                                                                                                                      'linked_budget_id', r.linked_budget_id,
                                                                                                                                          'valor', r.valor, 'payment_status', r.payment_status,
                                                                                                                                              'paid_at', r.paid_at, 'client_paid_claim_at', r.client_paid_claim_at,
                                                                                                                                                  'created_at', r.created_at, 'updated_at', r.updated_at
                                                                                                                                                    );
                                                                                                                                                    end $function$
;

CREATE OR REPLACE FUNCTION public.report_por_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r public.reports%rowtype;
begin
  select * into r from public.reports where rating_token = p_token;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', r.id, 'professional_id', r.professional_id,
    'client_name', r.client_name,
    'category_key', r.category_key, 'category_label', r.category_label,
    'niche', r.niche, 'service_date', r.service_date,
    'service_location', r.service_location,
    'service_description', r.service_description,
    'photos', r.photos, 'valor', r.valor,
    'payment_status', r.payment_status,
    'client_paid_claim_at', r.client_paid_claim_at,
    'rating', r.rating, 'rating_comment', r.rating_comment,
    'rating_used', r.rating_used,
    'linked_budget_id', r.linked_budget_id,
    'created_at', r.created_at
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.reports_obra_dono()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
                    begin
                      if new.obra_id is not null and not exists (
                          select 1 from public.obras o where o.id = new.obra_id and o.professional_id = new.professional_id
                            ) then
                                raise exception 'obra_invalida' using errcode = '23514';
                                  end if;
                                    return new;
                                    end $function$
;

CREATE OR REPLACE FUNCTION public.sanear_insert_professional()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
        begin
          if private.chamada_de_usuario() then
              new.plan            := 'free';
                  new.plan_expires_at := null;
                      new.is_public       := false;
                        end if;
                          return new;
                          end $function$
;

CREATE OR REPLACE FUNCTION public.selo_por_ref(p_ref_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
                                                                                                                                                      select jsonb_build_object('hash', d.hash, 'tipo', d.tipo, 'created_at', d.created_at)
                                                                                                                                                          from public.document_hashes d
                                                                                                                                                             where d.ref_id = p_ref_id
                                                                                                                                                                order by d.created_at desc
                                                                                                                                                                   limit 1;
                                                                                                                                                                   $function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin new.updated_at = now(); return new; end $function$
;

CREATE OR REPLACE FUNCTION public.slug_atual(p_slug text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
                                      select p.slug
                                          from public.professional_slug_antigos a
                                              join public.professionals p on p.id = a.professional_id
                                                 where a.slug = p_slug and p.slug is not null
                                                    limit 1;
                                                    $function$
;

CREATE OR REPLACE FUNCTION public.slug_livre(p_base text, p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_slug text; v_n int := 1;
begin
  if p_base is null or p_base = '' then return null; end if;
  v_slug := p_base;
  while exists (select 1 from public.professionals
                 where slug = v_slug and (p_id is null or id <> p_id)) loop
    v_n := v_n + 1;
    v_slug := p_base || '-' || v_n;
    if v_n > 500 then
      return p_base || '-' || replace(gen_random_uuid()::text, '-', '');
    end if;
  end loop;
  return v_slug;
end $function$
;

CREATE OR REPLACE FUNCTION public.slugify(txt text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select nullif(
    btrim(
      left(
        regexp_replace(
          translate(lower(txt),
            'áàâãäéèêëíìîïóòôõöúùûüçñ',
            'aaaaaeeeeiiiiooooouuuucn'),
          '[^a-z0-9]+', '-', 'g'),
        60),
      '-'),
    '');
$function$
;

CREATE OR REPLACE FUNCTION public.studio_compartilhado(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'nao_autenticado'); end if;
  update public.studio_videos set compartilhado_em = coalesce(compartilhado_em, now())
   where id = p_id and professional_id = auth.uid() and gerado_em is not null;
  if not found then return jsonb_build_object('ok', false, 'error', 'nao_encontrado'); end if;
  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_exportar(p_id uuid, p_formato text, p_duracao_ms integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_prof uuid := auth.uid();
  v      public.studio_videos%rowtype;
  v_sit  text;
  v_res  jsonb;
  v_pro  boolean;
begin
  if v_prof is null then return jsonb_build_object('ok', false, 'error', 'nao_autenticado'); end if;
  if p_formato not in ('mp4', 'webm', 'carrossel') then return jsonb_build_object('ok', false, 'error', 'formato_invalido'); end if;
  if p_duracao_ms is null or p_duracao_ms not between 1000 and 120000 then
    return jsonb_build_object('ok', false, 'error', 'duracao_invalida');
  end if;

  select * into v from public.studio_videos where id = p_id and professional_id = v_prof for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'nao_encontrado'); end if;

  v_sit := private.studio_report_elegivel(v_prof, v.report_id);
  if v_sit <> 'ok' then return jsonb_build_object('ok', false, 'error', v_sit); end if;
  -- o QR e o link levam ao perfil: perfil oculto ou sem endereço não tem para onde levar
  if not exists (select 1 from public.professionals where id = v_prof and is_public and coalesce(slug, '') <> '') then
    return jsonb_build_object('ok', false, 'error', 'perfil_privado');
  end if;
  if private.studio_roteiro_valido(v.roteiro, (select photos from public.reports where id = v.report_id)) <> 'ok' then
    return jsonb_build_object('ok', false, 'error', 'foto_fora_do_servico');   -- foto saiu do serviço depois de salvar
  end if;

  v_pro := private.is_pro(v_prof);
  if not v_pro and (v.modelo <> 'classico' or not v.marca) then   -- o Pro venceu entre salvar e gerar
    return jsonb_build_object('ok', false, 'error', 'pro_necessario');
  end if;

  if v.gerado_em is null then
    v_res := private.midia_reservar(v_prof, 'studio_video', 1, v.id::text, 0);
    if not (v_res->>'ok')::boolean then return v_res; end if;
  end if;

  update public.studio_videos
     set gerado_em = coalesce(gerado_em, now()), exportacoes = exportacoes + 1,
         formato = p_formato, duracao_ms = p_duracao_ms, atualizado_em = now()
   where id = v.id;

  return jsonb_build_object('ok', true, 'codigo', v.codigo, 'origem', 'studio_' || v.codigo,
                            'primeira_vez', v.gerado_em is null,
                            'cota', private.midia_situacao(v_prof, 'studio_video'));
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_fontes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_prof uuid := auth.uid();
  v_p    record;
begin
  if v_prof is null then return jsonb_build_object('ok', false, 'error', 'nao_autenticado'); end if;
  select id, name, profissao, city, uf, slug, logo_url, is_public, portfolio_publico, niche
    into v_p from public.professionals where id = v_prof;
  if not found then return jsonb_build_object('ok', false, 'error', 'perfil_nao_encontrado'); end if;

  return jsonb_build_object(
    'ok', true,
    'perfil', jsonb_build_object('id', v_p.id, 'nome', v_p.name, 'profissao', v_p.profissao, 'cidade', v_p.city,
                                 'uf', v_p.uf, 'slug', v_p.slug, 'foto', v_p.logo_url, 'publico', v_p.is_public,
                                 'portfolio_publico', coalesce(v_p.portfolio_publico, false), 'nicho', v_p.niche),
    'cota', private.midia_situacao(v_prof, 'studio_video'),
    'servicos_concluidos', (select count(*) from public.reports where professional_id = v_prof and tipo = 'servico' and arquivado_em is null),
    'servicos', coalesce((
      select jsonb_agg(s order by s->>'data' desc nulls last)
      from (
        select jsonb_build_object(
          'id', r.id,
          'titulo', coalesce(nullif(r.titulo_publico, ''), r.category_label, 'Serviço'),
          'categoria', r.category_label,
          'data', coalesce(r.service_date::text, r.created_at::date::text),
          'situacao', private.studio_report_elegivel(v_prof, r.id),
          'fotos', case when private.studio_report_elegivel(v_prof, r.id) = 'ok' then r.photos else '[]'::jsonb end,
          'total_fotos', jsonb_array_length(coalesce(r.photos, '[]'::jsonb)),
          'avaliacao', (select jsonb_build_object('nota', a.nota, 'comentario', left(a.comentario, 180),
                                                  'autor', coalesce(nullif(a.nome_avaliador_curto, ''), 'Cliente'))
                          from public.avaliacoes a
                         where a.report_id = r.id and r.is_public and a.nota between 1 and 5
                         order by a.created_at desc limit 1)
        ) as s
        from public.reports r
        where r.professional_id = v_prof and r.tipo = 'servico' and r.arquivado_em is null
          and jsonb_array_length(coalesce(r.photos, '[]'::jsonb)) > 0
        order by coalesce(r.service_date, r.created_at::date) desc
        limit 60
      ) x), '[]'::jsonb)
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.studio_meus()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'codigo', v.codigo, 'report_id', v.report_id, 'modelo', v.modelo, 'trilha', v.trilha,
           'roteiro', v.roteiro, 'marca', v.marca, 'formato', v.formato, 'duracao_ms', v.duracao_ms,
           'gerado_em', v.gerado_em, 'compartilhado_em', v.compartilhado_em, 'criado_em', v.criado_em,
           'visitas',  coalesce(e.visitas, 0), 'whatsapp', coalesce(e.whatsapp, 0), 'ligacoes', coalesce(e.ligacoes, 0))
         order by v.criado_em desc), '[]'::jsonb)
  from public.studio_videos v
  left join lateral (
    select count(*) filter (where ie.event_type = 'view')           as visitas,
           count(*) filter (where ie.event_type = 'whatsapp_click') as whatsapp,
           count(*) filter (where ie.event_type = 'call_click')     as ligacoes
      from public.impact_events ie
     where ie.professional_id = v.professional_id and ie.source = 'studio_' || v.codigo
  ) e on true
  where v.professional_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.studio_salvar(p_id uuid, p_report_id uuid, p_modelo text, p_trilha text, p_roteiro jsonb, p_marca boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_prof   uuid := auth.uid();
  v_pro    boolean;
  v_sit    text;
  v_fotos  jsonb;
  v_val    text;
  v_cod    text;
  v_id     uuid;
  v_total  integer;
begin
  if v_prof is null then return jsonb_build_object('ok', false, 'error', 'nao_autenticado'); end if;
  v_pro := private.is_pro(v_prof);

  v_sit := private.studio_report_elegivel(v_prof, p_report_id);
  if v_sit is null then return jsonb_build_object('ok', false, 'error', 'perfil_nao_encontrado'); end if;
  if v_sit <> 'ok' then return jsonb_build_object('ok', false, 'error', v_sit); end if;

  if p_modelo not in ('classico', 'impacto', 'editorial') then return jsonb_build_object('ok', false, 'error', 'modelo_invalido'); end if;
  if p_trilha not in ('leve', 'ritmo', 'calma', 'nenhuma') then return jsonb_build_object('ok', false, 'error', 'trilha_invalida'); end if;
  if not v_pro and p_modelo <> 'classico' then return jsonb_build_object('ok', false, 'error', 'pro_necessario'); end if;
  if not v_pro and coalesce(p_marca, true) = false then return jsonb_build_object('ok', false, 'error', 'pro_necessario'); end if;
  if not v_pro and p_roteiro ? 'acento' and jsonb_typeof(p_roteiro->'acento') <> 'null' then
    return jsonb_build_object('ok', false, 'error', 'pro_necessario');
  end if;

  select photos into v_fotos from public.reports where id = p_report_id;
  v_val := private.studio_roteiro_valido(p_roteiro, v_fotos);
  if v_val <> 'ok' then return jsonb_build_object('ok', false, 'error', v_val); end if;

  if p_id is null then
    select count(*) into v_total from public.studio_videos where professional_id = v_prof;
    if v_total >= 300 then return jsonb_build_object('ok', false, 'error', 'limite_de_videos'); end if;
    loop
      v_cod := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
      exit when not exists (select 1 from public.studio_videos where codigo = v_cod);
    end loop;
    insert into public.studio_videos (professional_id, report_id, codigo, modelo, trilha, roteiro, marca)
    values (v_prof, p_report_id, v_cod, p_modelo, p_trilha, p_roteiro, coalesce(p_marca, true))
    returning id into v_id;
  else
    -- 1 vídeo = 1 serviço: depois de gerado, o vídeo pode ser ajustado, mas
    -- não trocar de serviço (senão um vídeo da cota viraria vídeos ilimitados)
    if exists (select 1 from public.studio_videos where id = p_id and professional_id = v_prof
                and gerado_em is not null and report_id <> p_report_id) then
      return jsonb_build_object('ok', false, 'error', 'servico_diferente');
    end if;
    update public.studio_videos
       set report_id = p_report_id, modelo = p_modelo, trilha = p_trilha, roteiro = p_roteiro,
           marca = coalesce(p_marca, true), atualizado_em = now()
     where id = p_id and professional_id = v_prof
    returning id, codigo into v_id, v_cod;
    if v_id is null then return jsonb_build_object('ok', false, 'error', 'nao_encontrado'); end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'codigo', v_cod);
end $function$
;

CREATE OR REPLACE FUNCTION public.submit_rating(p_token text, p_nota smallint, p_comentario text DEFAULT NULL::text, p_nome text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_report public.reports%rowtype;
begin
  if p_nota is null or p_nota < 1 or p_nota > 5 then
    return jsonb_build_object('ok', false, 'error', 'nota_invalida');
  end if;

  select * into v_report from public.reports
   where rating_token = p_token for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'nao_encontrado');
  end if;
  if v_report.rating_used then
    return jsonb_build_object('ok', false, 'error', 'ja_avaliado');
  end if;

  update public.reports
     set rating = p_nota,
         rating_comment = nullif(btrim(p_comentario), ''),
         rating_used = true
   where id = v_report.id;

  insert into public.avaliacoes
    (professional_id, report_id, nota, comentario, nome_avaliador)
  values
    (v_report.professional_id, v_report.id, p_nota,
     nullif(btrim(p_comentario), ''), nullif(btrim(p_nome), ''));

  return jsonb_build_object('ok', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_avaliacoes_nome_curto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    begin
      new.nome_avaliador_curto := case
          when coalesce(btrim(new.nome_avaliador), '') = '' then null
              else private.nome_curto(new.nome_avaliador)
                end;
                  return new;
                  end $function$
;

CREATE OR REPLACE FUNCTION public.trg_cidade()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r record;
begin
  select * into r from public.cidade_partes(new.city);
  new.city_slug := r.city_slug;
  new.uf        := r.uf;
  -- v12.27 · sem UF escrita: só as cidades que não existem em outro estado
  if new.uf is null and new.city_slug in ('caraguatatuba', 'ilhabela', 'ubatuba', 'cajamar', 'guarulhos') then
    new.uf := 'SP';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_equip_publica()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.recalc_locadora_publica(coalesce(new.locadora_id, old.locadora_id));
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_equipamentos()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_cid text;
begin
  if new.slug is null and coalesce(btrim(new.nome),'') <> '' then
    select l.city_slug into v_cid from public.locadoras l where l.id = new.locadora_id;
    new.slug := public.equip_slug_livre(
      public.slugify(concat_ws(' ', new.nome, new.marca, v_cid)));
  end if;
  new.updated_at := now();
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_guardar_slug_antigo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
        begin
          if old.slug is not null and new.slug is distinct from old.slug then
              insert into public.professional_slug_antigos (slug, professional_id)
                  values (old.slug, old.id)
                      on conflict (slug) do update set professional_id = excluded.professional_id, trocado_em = now();
                        end if;
                          if new.slug is not null then
                              delete from public.professional_slug_antigos where slug = new.slug;
                                end if;
                                  return new;
                                  end $function$
;

CREATE OR REPLACE FUNCTION public.trg_locacao_contratos_imutavel()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'DELETE' then
    if nullif(current_setting('request.jwt.claims', true), '') is not null then
      raise exception 'Contrato de locação não pode ser apagado. Antes do aceite, use cancelar.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if new.status is not distinct from old.status then
    raise exception 'Contrato de locação só muda por transição de status.' using errcode = '42501';
  end if;

  if not ((old.status = 'emitido' and new.status in ('aceito','cancelado','substituido'))
       or (old.status = 'aceito'  and new.status = 'substituido')) then
    raise exception 'Transição inválida: % → %', old.status, new.status using errcode = '42501';
  end if;

  if new.id               is distinct from old.id
  or new.locadora_id      is distinct from old.locadora_id
  or new.locacao_id       is distinct from old.locacao_id
  or new.ano              is distinct from old.ano
  or new.seq              is distinct from old.seq
  or new.numero           is distinct from old.numero
  or new.versao           is distinct from old.versao
  or new.token            is distinct from old.token
  or new.conteudo         is distinct from old.conteudo
  or new.hash             is distinct from old.hash
  or new.hash_id          is distinct from old.hash_id
  or new.resumo_economico is distinct from old.resumo_economico
  or new.emitido_em       is distinct from old.emitido_em then
    raise exception 'O conteúdo do contrato é imutável depois de emitido.' using errcode = '42501';
  end if;

  if old.aceito_em is not null and (
       new.aceito_em         is distinct from old.aceito_em
    or new.aceite_nome       is distinct from old.aceite_nome
    or new.aceite_documento  is distinct from old.aceite_documento
    or new.aceite_ip         is distinct from old.aceite_ip
    or new.aceite_user_agent is distinct from old.aceite_user_agent
    or new.aceite_registro   is distinct from old.aceite_registro
    or new.aceite_hash       is distinct from old.aceite_hash
    or new.aceite_hash_id    is distinct from old.aceite_hash_id) then
    raise exception 'O registro de aceite é imutável.' using errcode = '42501';
  end if;

  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_locacoes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.data_devolucao is not null and new.status in ('em_andamento','atrasada') then
    new.status := 'devolvida';
  elsif new.status = 'em_andamento' and new.data_prevista_devolucao < current_date then
    new.status := 'atrasada';
  elsif new.status = 'atrasada' and new.data_prevista_devolucao >= current_date then
    new.status := 'em_andamento';
  end if;
  new.updated_at := now();
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_locadoras()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.slug is null and coalesce(btrim(new.nome),'') <> '' then
    new.slug := public.locadora_slug_livre(
      public.slugify(concat_ws(' ', new.nome, new.city)), new.id);
  end if;
  new.updated_at := now();
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_prof_cidades()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
                              declare
                                v text[] := array[]::text[];
                                  c text;
                                  begin
                                    foreach c in array coalesce(new.cidades_atendidas, array[]::text[]) loop
                                        c := nullif(btrim(regexp_replace(
                                                   translate(lower(btrim(coalesce(c, ''))), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
                                                              '[^a-z0-9]+', '-', 'g'), '-'), '');
                                                                  continue when c is null or c = new.city_slug or c = any(v);
                                                                      v := v || c;
                                                                          exit when cardinality(v) >= 8;
                                                                            end loop;
                                                                              new.cidades_atendidas := v;
                                                                                new.cidades := (case when coalesce(new.city_slug, '') <> '' then array[new.city_slug] else array[]::text[] end) || v;
                                                                                  return new;
                                                                                  end $function$
;

CREATE OR REPLACE FUNCTION public.trg_prof_nichos()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_lista  jsonb := '[]'::jsonb;
  v_vistos text[] := array[]::text[];
  e        jsonb;
  v_rot    text;
  v_nicho  text;
begin
  new.niche := public.fieldo_chave_categoria(new.niche);  -- v12.27
  if new.niche is not null and btrim(new.niche) <> '' then
    v_vistos := array[new.niche];
  end if;
  if jsonb_typeof(new.outras_profissoes) = 'array' then
    for e in select value from jsonb_array_elements(new.outras_profissoes) loop
      continue when jsonb_typeof(e) <> 'object';
      v_rot   := left(btrim(regexp_replace(coalesce(e->>'rotulo', ''), '\s+', ' ', 'g')), 60);
      v_nicho := left(lower(btrim(coalesce(e->>'nicho', ''))), 40);
      continue when v_rot = '' or v_nicho !~ '^[a-z0-9][a-z0-9-]*$';
      continue when v_nicho = any(v_vistos);
      v_vistos := v_vistos || v_nicho;
      v_lista  := v_lista || jsonb_build_array(jsonb_build_object('rotulo', v_rot, 'nicho', v_nicho));
    end loop;
  end if;
  new.outras_profissoes := v_lista;
  new.nichos := v_vistos;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_professionals_slug()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.slug is null
     and coalesce(btrim(new.name), '') <> ''
     and coalesce(btrim(new.profissao), '') <> ''
  then
    new.slug := public.slug_livre(
      public.slugify(concat_ws(' ', new.name, new.profissao, new.city)), new.id);
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_reports_cliente_curto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.cliente_curto := private.nome_curto(new.client_name);
    return new;
    end $function$
;

CREATE OR REPLACE FUNCTION public.trg_reports_titulo_publico()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.titulo_publico := public.fieldo_titulo_servico(new.service_description);
  -- Só na criação: depois disso quem decide é o profissional.
  if tg_op = 'INSERT' and new.tipo = 'servico'
     and public.fieldo_eh_foto_de_trabalho(new.service_description, coalesce(new.client_name, new.cliente_curto)) then
    new.tipo := 'portfolio';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_selo_contrato_locacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.tipo in ('contrato_locacao','aceite_locacao')
       and current_user in ('anon','authenticated') then
      raise exception 'Selo de contrato de locação só é emitido pelo sistema.' using errcode = '42501';
    end if;
    return new;
  end if;

  if (old.tipo in ('contrato_locacao','aceite_locacao')
      or (tg_op = 'UPDATE' and new.tipo in ('contrato_locacao','aceite_locacao')))
     and nullif(current_setting('request.jwt.claims', true), '') is not null then
    raise exception 'Selo de contrato de locação é permanente.' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $function$
;

CREATE OR REPLACE FUNCTION public.verificar_hash(p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.verificar_pdf(p_pdf_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$
;
