-- Fieldo · v12.30 · Fase 5 da auditoria SEO/GEO (04/11) · conversão
--
-- O QUE MUDA
--   1. professionals.aceita_ligacao: caixa "Aceito ligações neste número"
--      no Meu perfil, desligada para todo mundo. Marcada, o perfil ganha
--      o botão "Ligar" ao lado do WhatsApp (mesmo número). Decisão do
--      dono (04/11): só para quem ativar.
--   2. budgets.origem: "De onde veio este cliente?" no orçamento
--      (fieldo, indicacao, redes, ja_cliente, outro). Opcional; é a
--      primeira medida de quantos orçamentos o site gera (achado P14).
--   3. impact_events aceita 'call_click' (clique no "Ligar"), com o mesmo
--      limite por hora que os outros eventos.
--   4. professional_stats ganha tem_whatsapp (sim/não, nunca o número),
--      para o Explorar e as listas mostrarem primeiro quem dá para chamar
--      (achado P15).
--
-- Nada é apagado, nenhum perfil muda de data. Pode rodar de novo.
-- Depende do SQL da fase 3 (coluna cidades da vista).

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'professional_stats' and column_name = 'cidades') then
    raise exception 'Rode antes o SQL da fase 3 (a vista ainda não tem a coluna cidades).';
  end if;
end $$;

-- 1. Ligar, só para quem ativar
alter table public.professionals add column if not exists aceita_ligacao boolean not null default false;
grant select (aceita_ligacao) on public.professionals to anon, authenticated;
grant insert (aceita_ligacao), update (aceita_ligacao) on public.professionals to authenticated;

-- 2. De onde veio o cliente do orçamento
alter table public.budgets add column if not exists origem text;
alter table public.budgets drop constraint if exists budgets_origem_check;
alter table public.budgets add constraint budgets_origem_check
  check (origem is null or origem in ('fieldo', 'indicacao', 'redes', 'ja_cliente', 'outro'));

-- 3. Clique no "Ligar"
alter table public.impact_events drop constraint if exists impact_events_event_type_check;
alter table public.impact_events add constraint impact_events_event_type_check
  check (event_type in ('card_generated', 'view', 'whatsapp_click', 'call_click'));

create or replace function public.log_impact_event(p_professional_id uuid, p_event_type text,
  p_source text default 'organico', p_report_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

-- 4. A vista: igual à da v12.28, com tem_whatsapp no fim.
create or replace view public.professional_stats as
 SELECT p.id,
    p.name,
    p.profissao,
    p.specialty,
    p.city,
    p.slug,
    p.logo_url,
    p.plan,
    p.is_public AS active,
    round(avg(a.nota) FILTER (WHERE ar.is_public AND ar.tipo = 'servico'), 1) AS media_geral,
    count(DISTINCT a.id) FILTER (WHERE ar.is_public AND ar.tipo = 'servico') AS total_geral,
    count(DISTINCT r.id) FILTER (WHERE r.tipo = 'servico') AS total_servicos_confirmados,
        CASE
            WHEN p.portfolio_publico THEN ( SELECT rr.photos ->> 0
               FROM reports rr
              WHERE rr.professional_id = p.id AND rr.is_public AND rr.portfolio_ok AND jsonb_array_length(COALESCE(rr.photos, '[]'::jsonb)) > 0
              ORDER BY rr.created_at DESC
             LIMIT 1)
            ELSE NULL::text
        END AS foto_capa,
    p.created_at,
    p.niche,
    p.bio,
    p.city_slug,
    p.uf,
    GREATEST(p.updated_at, max(GREATEST(r.updated_at, r.created_at)), max(a.created_at) FILTER (WHERE ar.is_public)) AS last_public_change,
    p.area_atendimento,
    p.tipo_atendimento,
    p.cnpj,
    p.empresa_nome,
    p.cnpj_situacao,
    p.cnpj_abertura,
    p.cnpj_verificado_em,
    p.atua_desde,
    p.garantia,
    p.formas_pagamento,
    p.atende_urgencia,
    p.registros,
    p.outras_profissoes,
    p.nichos,
    fotos.n AS total_fotos_trabalho,
    (count(DISTINCT r.id) FILTER (WHERE r.tipo = 'servico') >= 3
      OR (char_length(btrim(coalesce(p.bio, ''))) >= 150 AND fotos.n >= 6)) AS indexavel,
    p.cidades_atendidas,
    p.cidades,
    (nullif(btrim(coalesce(p.whatsapp, '')), '') IS NOT NULL) AS tem_whatsapp
   FROM professionals p
     LEFT JOIN avaliacoes a ON a.professional_id = p.id
     LEFT JOIN reports ar ON ar.id = a.report_id
     LEFT JOIN reports r ON r.professional_id = p.id AND r.is_public
     CROSS JOIN LATERAL (
       SELECT CASE WHEN p.portfolio_publico THEN COALESCE((
                SELECT sum(CASE WHEN jsonb_typeof(rf.photos) = 'array' THEN jsonb_array_length(rf.photos) ELSE 0 END)
                  FROM reports rf
                 WHERE rf.professional_id = p.id AND rf.is_public AND rf.portfolio_ok), 0)
              ELSE 0 END::integer AS n
     ) fotos
  WHERE p.is_public
  GROUP BY p.id, fotos.n;

commit;

-- conferência: deve voltar "pronto", ligacao_ativada = 0 (ninguém
-- marcou ainda) e com_whatsapp = perfis públicos com WhatsApp.
select case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'professional_stats' and column_name = 'tem_whatsapp')
             and exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'budgets' and column_name = 'origem')
             and exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'professionals' and column_name = 'aceita_ligacao')
            then 'pronto' else 'faltou algo' end as resultado,
       (select count(*) from public.professionals where aceita_ligacao) as ligacao_ativada,
       (select count(*) from public.professional_stats where tem_whatsapp) as com_whatsapp;
