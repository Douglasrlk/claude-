-- Fieldo · v12.26 · Fase 1 da auditoria SEO/GEO (03/11) · achados P1 e P2
--
-- ═══ P1 · dados de cliente ══════════════════════════════════════════
--
-- O QUE ESTAVA ERRADO
--   A página pública mostra de cada serviço só um título limpo ("Troca de
--   dois disjuntores"). Mas a chave pública (anon), que está em toda
--   página do site, lia a descrição INTEIRA de todos os registros
--   públicos e o primeiro nome do cliente. Essa descrição é a mensagem
--   que o profissional manda ao cliente: valor, saldo de empreitada,
--   "casa da rua 10". Qualquer pessoa conseguia listar isso.
--
-- O QUE MUDA
--   1. reports.titulo_publico: o mesmo título limpo que o site já
--      mostrava, agora calculado pelo banco (mesma regra de
--      tituloServico() em perfil.html / perfil-seo.ts / db.js).
--   2. O anon passa a ler titulo_publico e deixa de ler
--      service_description e cliente_curto.
--   3. vw_portfolio_publico perde cliente_curto (ninguém no site usa a
--      coluna, e sem isso a vista quebraria para o anon).
--
-- O QUE NÃO MUDA
--   · O dono continua vendo tudo (authenticated, só os próprios).
--   · O cliente continua vendo o relatório inteiro pelo link com token
--     (report_por_token, que roda com os direitos do banco).
--   · updated_at dos relatórios não é tocado (o sitemap não diria ao
--     Google que todo perfil mudou hoje).
--
-- ═══ P2 · fotos de trabalho não são serviço ═════════════════════════
--
--   30 dos 61 registros eram "Subir google" / "Teste" (cliente "Subir
--   G."): fotos de trabalhos postadas pelo fluxo de relatório. Contavam
--   como serviço verificado, levavam 8 de 10 perfis ao Google e 6
--   avaliações presas a eles entravam nas estrelas.
--   4. reports.tipo: 'servico' (padrão) ou 'portfolio'. Os 30 viram
--      'portfolio'; as fotos continuam na galeria do perfil.
--   5. professional_stats: serviços, nota e nº de avaliações contam só
--      'servico'; ganha total_fotos_trabalho e indexavel (a regra que
--      você escolheu: 3 serviços reais, OU biografia de 150+ letras e
--      6+ fotos de trabalho visíveis). perfil-seo, sitemap, páginas por
--      cidade, Explorar e a home passam a usar `indexavel`.
--   6. Avaliação presa a foto de trabalho sai da página pública (o anon
--      não lê mais). Nada é apagado: o dono continua vendo.
--
-- ORDEM: publique o site v12.26 ANTES de rodar este SQL. O site novo
-- funciona com e sem ele; o site antigo, depois dele, perderia a lista
-- de serviços nos perfis.
--
-- Pode rodar de novo sem problema.

begin;

-- ── 1. Título público de um serviço ─────────────────────────────────
-- Uma linha que diz o que foi feito: a primeira frase (das 8 primeiras
-- linhas) que não fale de dinheiro, pulando cabeçalhos genéricos e
-- saudações; valores entre parênteses saem. Nada aproveitável → null
-- (o site mostra "Serviço de <categoria>").
create or replace function public.fieldo_titulo_servico(p_desc text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
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
end $$;

-- ── 2. A coluna e quem a mantém ─────────────────────────────────────
alter table public.reports add column if not exists titulo_publico text;

alter table public.reports add column if not exists tipo text not null default 'servico';
alter table public.reports drop constraint if exists reports_tipo_check;
alter table public.reports add constraint reports_tipo_check check (tipo in ('servico', 'portfolio'));

-- Registro só de fotos, do jeito que eles vêm sendo feitos hoje (texto
-- "Subir google"/"Teste", cliente "Subir G…"/"Teste"). Mesma regra do
-- acerto dos antigos, lá embaixo.
create or replace function public.fieldo_eh_foto_de_trabalho(p_desc text, p_cliente text)
returns boolean language sql immutable set search_path = pg_catalog, pg_temp as $$
  select coalesce(p_desc ~* '^\s*(teste|subir google|test)\s*$', false)
      or coalesce(p_cliente ~* '^\s*(teste|subir\s+g\S*)(\s+\d+)?\s*$', false)
$$;

create or replace function public.trg_reports_titulo_publico() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.titulo_publico := public.fieldo_titulo_servico(new.service_description);
  -- Só na criação: depois disso quem decide é o profissional.
  if tg_op = 'INSERT' and new.tipo = 'servico'
     and public.fieldo_eh_foto_de_trabalho(new.service_description, coalesce(new.client_name, new.cliente_curto)) then
    new.tipo := 'portfolio';
  end if;
  return new;
end $$;

drop trigger if exists trg_rep_titulo_publico on public.reports;
create trigger trg_rep_titulo_publico
  before insert or update of service_description on public.reports
  for each row execute function public.trg_reports_titulo_publico();

-- Registros que já existem. Sem mexer em updated_at.
alter table public.reports disable trigger trg_rep_updated;
update public.reports
   set titulo_publico = public.fieldo_titulo_servico(service_description)
 where titulo_publico is distinct from public.fieldo_titulo_servico(service_description);
update public.reports
   set tipo = 'portfolio'
 where tipo = 'servico'
   and public.fieldo_eh_foto_de_trabalho(service_description, coalesce(client_name, cliente_curto));
alter table public.reports enable trigger trg_rep_updated;

-- ── 3. Quem lê o quê ────────────────────────────────────────────────
grant select (titulo_publico, tipo) on public.reports to anon, authenticated;
grant update (tipo) on public.reports to authenticated;
revoke select (service_description, cliente_curto) on public.reports from anon;

-- A vista de portfólio sem o nome do cliente (DROP + CREATE: uma vista
-- não perde coluna com CREATE OR REPLACE).
drop view if exists public.vw_portfolio_publico;
create view public.vw_portfolio_publico with (security_invoker = true) as
 select r.id,
    r.professional_id,
    r.category_key,
    r.category_label,
    r.niche,
    r.service_date,
    r.rating,
    r.portfolio_ok,
    r.created_at,
        case
            when (p.portfolio_publico and r.portfolio_ok) then coalesce(r.photos, '[]'::jsonb)
            else '[]'::jsonb
        end as photos,
    r.titulo_publico
   from (public.reports r
     join public.professionals p on ((p.id = r.professional_id)))
  where (r.is_public and p.is_public);
grant select on public.vw_portfolio_publico to anon, authenticated;

-- ── 6. Avaliação pública só de serviço ──────────────────────────────
drop policy if exists aval_select_publico on public.avaliacoes;
create policy aval_select_publico on public.avaliacoes for select to anon
  using (exists (select 1 from public.reports r
                  where r.id = avaliacoes.report_id and r.is_public and r.tipo = 'servico'));

-- ── 5. A vista pública: conta só serviço; ganha fotos e `indexavel` ──
-- Igual à da v12.25, com três mudanças: os FILTER de nota/avaliações/
-- serviços pedem tipo = 'servico', e duas colunas novas no fim.
-- Se o SQL da v12.28 já rodou, a vista já tem estas colunas e mais duas
-- (cidades): recriar daqui apagaria colunas e o Postgres recusa. Aí pula.
do $vista$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'professional_stats' and column_name = 'cidades') then
    raise notice 'professional_stats já está na v12.28: não recria';
  else
    execute $v$
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
      OR (char_length(btrim(coalesce(p.bio, ''))) >= 150 AND fotos.n >= 6)) AS indexavel
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
    $v$;
  end if;
end $vista$;

commit;

-- conferência: deve voltar "pronto" e os números novos
select case when has_column_privilege('anon', 'public.reports', 'titulo_publico', 'select')
             and not has_column_privilege('anon', 'public.reports', 'service_description', 'select')
             and not has_column_privilege('anon', 'public.reports', 'cliente_curto', 'select')
             and exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'professional_stats' and column_name = 'indexavel')
            then 'pronto' else 'faltou algo' end as resultado,
       (select count(*) from public.reports where titulo_publico is not null) as com_titulo,
       (select count(*) from public.reports where tipo = 'portfolio') as fotos_de_trabalho,
       (select count(*) from public.professional_stats where indexavel) as perfis_no_google;
