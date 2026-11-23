-- ============================================================
-- Fieldo · v12.18 · Correções da auditoria do Fieldo Engenharia
-- ------------------------------------------------------------
-- 1. Assistente: devolver a mensagem quando a IA falha.
--    A cota é debitada ANTES de chamar a Anthropic (certo: nunca gastar
--    token de quem já estourou). Mas quando a chamada falha (chave
--    inválida desde 16/10), o profissional perdia a mensagem sem
--    resposta. A devolução só pode ser feita pelo servidor (service_role):
--    se o usuário pudesse chamá-la, devolveria mensagens a si mesmo e
--    teria assistente ilimitado.
-- 2. Council: mesma coisa para a cota mensal (50). Outubro gastou 29
--    consultas que falharam sem nenhum token consumido.
-- 3. Council: não pedir parecer de novo para o mesmo problema na mesma
--    página (o Integrity Agent abre um incidente a cada 3 horas
--    enquanto o problema dura).
-- ============================================================

create or replace function public._assistant_refund_usage(p_prof uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.assistant_usage
     set message_count = greatest(0, message_count - 1)
   where professional_id = p_prof
     and month_start = date_trunc('month', now())::date
     and message_count > 0;
end $$;
revoke all on function public._assistant_refund_usage(uuid) from public, anon, authenticated;
grant execute on function public._assistant_refund_usage(uuid) to service_role;

create or replace function public._council_refund_budget()
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.council_budget
     set calls_used = greatest(0, calls_used - 1)
   where month_start = date_trunc('month', now())::date;
end $$;
revoke all on function public._council_refund_budget() from public, anon, authenticated;
grant execute on function public._council_refund_budget() to service_role;

-- Agendador do Council: pula incidente cujo problema (mesma página, mesmo
-- resumo) já tem parecer concluído nos últimos 7 dias.
create or replace function public._council_revisar_incidentes_pendentes()
returns integer
language plpgsql security definer set search_path to 'public', 'vault' as $function$
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
$function$;
revoke all on function public._council_revisar_incidentes_pendentes() from public, anon, authenticated;

-- Devolve a cota de outubro gasta em chamadas que a Anthropic recusou
-- (chave inválida): nenhuma delas consumiu token.
update public.council_budget b
   set calls_used = greatest(0, b.calls_used - (
         select count(*) from public.council_reviews c
          where c.status = 'falhou'
            and c.error like 'API da Anthropic: invalid x-api-key%'
            and c.requested_at >= b.month_start
            and c.requested_at < (b.month_start + interval '1 month')))
 where b.month_start = date_trunc('month', now())::date;
