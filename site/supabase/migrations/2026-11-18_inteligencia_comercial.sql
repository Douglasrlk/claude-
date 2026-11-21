-- Fieldo · v12.40 · Inteligência Comercial do profissional (18/11/2026)
--
-- Entrega 3 da auditoria de 18/11. O dado já era coletado em impact_events
-- (visualização do perfil, clique no WhatsApp, card gerado, com a origem),
-- mas só o fundador via, agregado, no admin-analytics. Agora o próprio
-- profissional vê o DELE.
--
-- Segurança: SECURITY INVOKER. Quem filtra é a RLS que já existe em
-- impact_events (impact_events_select_owner: professional_id = auth.uid()).
-- A função não ganha nenhum acesso que a sessão do profissional não tenha.
--
-- Plano: o total (visualizações e cliques) é para todos — é o que mostra
-- que o perfil funciona. O detalhe (de onde vieram, dia a dia, comparação
-- com o período anterior) é do Pro, pela mesma regra de private.is_pro().
--
-- Fora da conta: origem '127.0.0.1' (teste local) e 'interno' (o próprio
-- app). Não são clientes.

create or replace function public.minhas_metricas(p_dias int default 30)
 returns jsonb
 language plpgsql
 stable
 security invoker
 set search_path to 'public', 'pg_temp'
as $function$
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
$function$;

revoke all on function public.minhas_metricas(int) from public, anon;
grant execute on function public.minhas_metricas(int) to authenticated;
