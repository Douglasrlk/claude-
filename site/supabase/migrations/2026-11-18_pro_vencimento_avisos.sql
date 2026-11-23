-- Fieldo · v12.40 · Pro com prazo de verdade, avisos e volta ao grátis (18/11/2026)
--
-- Achado da auditoria de 18/11 (reconciliação do Freemium):
--   * private.is_pro() — usado pela RLS de Contratos — já respeitava
--     plan_expires_at. Mas a cota do Assistente (_assistant_check_and_bump_usage)
--     e o limite de relatórios do MCP (mcp_get_account_usage) olhavam só
--     plan = 'pro'. Resultado: Pro vencido continuava com 300 mensagens/mês e
--     relatórios sem limite. Agora as duas usam private.is_pro().
--   * Ninguém rebaixava plan para 'free' quando o prazo passava. O webhook diz
--     "quem tira o Pro é o vencimento natural da data" — e a data não tirava
--     nada da coluna. Agora um job diário faz isso.
--   * Pro concedido à mão ficava com plan_expires_at nulo = Pro para sempre.
--
-- Decisão do dono (18/11): Pro concedido = 30 dias + 5 dias de acréscimo
-- com aviso do sistema; depois disso a conta volta ao grátis. A regra de
-- aviso (últimos 5 dias) e de volta ao grátis vale para TODO Pro com prazo:
-- assinatura, licença de revenda ou concessão manual. Dados do profissional
-- não são apagados — só o plano muda.

-- ── 1. notificações do sistema para o profissional ──────────────────
create table if not exists public.notificacoes (
  id              uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  tipo            text not null check (tipo in ('pro_vencendo', 'pro_encerrado', 'sistema')),
  titulo          text not null,
  mensagem        text not null,
  link            text,
  chave           text not null unique,          -- idempotência do job diário
  criada_em       timestamptz not null default now(),
  lida_em         timestamptz
);

create index if not exists notificacoes_prof_idx
  on public.notificacoes (professional_id, criada_em desc);

alter table public.notificacoes enable row level security;

drop policy if exists notificacoes_select_own on public.notificacoes;
create policy notificacoes_select_own on public.notificacoes
  for select to authenticated
  using (professional_id = (select auth.uid()));

drop policy if exists notificacoes_marcar_lida on public.notificacoes;
create policy notificacoes_marcar_lida on public.notificacoes
  for update to authenticated
  using (professional_id = (select auth.uid()))
  with check (professional_id = (select auth.uid()));

-- O profissional só lê e marca como lida. Quem escreve é o job (postgres).
revoke all on public.notificacoes from anon, authenticated;
grant select on public.notificacoes to authenticated;
grant update (lida_em) on public.notificacoes to authenticated;

-- ── 2. cota do Assistente respeita o vencimento ─────────────────────
create or replace function public._assistant_check_and_bump_usage()
 returns table(mensagens_restantes integer, limite integer)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
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
$function$;

-- ── 3. limite de relatórios do MCP respeita o vencimento ────────────
create or replace function public.mcp_get_account_usage(p_raw_key text)
 returns table(professional_id uuid, plan text, used_this_month integer, "limit" integer, remaining integer, allowed_to_create boolean)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
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
$function$;

-- ── 4. job diário: avisa nos últimos 5 dias e devolve ao grátis ─────
create or replace function public.plano_ciclo_diario()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
$function$;

revoke all on function public.plano_ciclo_diario() from public, anon, authenticated;

-- 06:41 de Brasília (09:41 UTC), todo dia.
select cron.unschedule('plano-ciclo-diario')
 where exists (select 1 from cron.job where jobname = 'plano-ciclo-diario');
select cron.schedule('plano-ciclo-diario', '41 9 * * *', $$ select public.plano_ciclo_diario(); $$);
