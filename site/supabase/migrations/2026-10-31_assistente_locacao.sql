-- Fieldo · v12.24 · assistente de IA na Locação (31/10)
--
-- Decisão do dono: na Locação o assistente só destrava com o plano Pro,
-- e o Pro tem 50 mensagens por mês. O contador do profissional
-- (assistant_usage) tem chave estrangeira para professionals e não aceita
-- uma locadora: por isso a locadora ganha o contador dela.
--
-- Mesmo desenho do contador do profissional: o débito acontece ANTES de
-- chamar a IA, e a devolução (quando a IA não respondeu) só pode ser feita
-- pelo servidor (service role). Pode rodar de novo sem problema.

begin;

create table if not exists public.assistant_usage_locadora (
  locadora_id   uuid primary key references public.locadoras(id) on delete cascade,
  month_start   date not null default (date_trunc('month', now())::date),
  message_count integer not null default 0 check (message_count >= 0)
);
alter table public.assistant_usage_locadora enable row level security;
revoke all on public.assistant_usage_locadora from anon, authenticated;

create or replace function public._assistant_loc_check_and_bump_usage()
returns table(mensagens_restantes integer, limite integer)
language plpgsql security definer set search_path = public, pg_temp as $$
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
end $$;
revoke all on function public._assistant_loc_check_and_bump_usage() from public, anon;
grant execute on function public._assistant_loc_check_and_bump_usage() to authenticated;

create or replace function public._assistant_loc_refund_usage(p_loc uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.assistant_usage_locadora
     set message_count = greatest(0, message_count - 1)
   where locadora_id = p_loc
     and month_start = date_trunc('month', now())::date
     and message_count > 0;
end $$;
revoke all on function public._assistant_loc_refund_usage(uuid) from public, anon, authenticated;
grant execute on function public._assistant_loc_refund_usage(uuid) to service_role;

commit;

-- conferência: deve voltar "pronto"
select case when to_regclass('public.assistant_usage_locadora') is not null
             and exists (select 1 from pg_proc where proname = '_assistant_loc_check_and_bump_usage')
             and exists (select 1 from pg_proc where proname = '_assistant_loc_refund_usage')
       then 'pronto' else 'faltou algo' end as resultado;
