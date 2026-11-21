-- Fieldo · v12.28 · Fase 3 da auditoria SEO/GEO (04/11) · SEO local
--
-- O QUE ESTAVA ERRADO
--   Nenhum perfil em São Sebastião, Ilhabela ou Ubatuba. Quem mora em
--   Caraguatatuba e atende a região só podia dizer isso num campo de
--   texto livre ("Também atende"), que as páginas "eletricista-em-
--   ubatuba" não leem. Resultado: zero página nas três cidades.
--
-- O QUE MUDA
--   1. professionals.cidades_atendidas: as cidades que a pessoa marca
--      no Editar perfil (por enquanto, as quatro do Litoral Norte).
--   2. professionals.cidades: a cidade principal + as atendidas, mantida
--      pelo banco. É por ela que as páginas por cidade, o sitemap e a
--      página do Litoral Norte filtram. A página só nasce com 3
--      profissionais reais que atendem a cidade (regra de sempre).
--   3. Os 2 perfis que escreveram "Ubatuba é São Sebastião" no texto
--      livre têm as duas cidades marcadas, e o texto, que só repetia
--      as cidades, fica vazio. Nada mais é tocado.
--   4. professional_stats ganha as duas colunas no fim.
--
-- Nenhum perfil muda de data. Pode rodar de novo sem problema.
-- Depende do SQL das fases 1 e 2 (coluna indexavel da vista).

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'professional_stats' and column_name = 'indexavel') then
    raise exception 'Rode antes o SQL das fases 1 e 2 (a vista ainda não tem a coluna indexavel).';
  end if;
end $$;

alter table public.professionals
  add column if not exists cidades_atendidas text[] not null default '{}',
  add column if not exists cidades text[] not null default '{}';

-- Limpa o que chega (formato de chave, repetida, igual à principal; no
-- máximo 8) e recalcula `cidades`. Roda depois de trg_prof_cidade (a
-- ordem dos gatilhos é alfabética), que é quem calcula city_slug.
create or replace function public.trg_prof_cidades() returns trigger
language plpgsql set search_path = public, pg_temp as $$
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
end $$;

drop trigger if exists trg_prof_cidades on public.professionals;
create trigger trg_prof_cidades before insert or update of city, cidades_atendidas on public.professionals
  for each row execute function public.trg_prof_cidades();

create index if not exists professionals_cidades_gin on public.professionals using gin (cidades);

grant select (cidades_atendidas, cidades) on public.professionals to anon, authenticated;
grant insert (cidades_atendidas), update (cidades_atendidas) on public.professionals to authenticated;

-- O que já existe: `cidades` = a principal; quem escreveu só nomes das
-- quatro cidades no texto livre ganha as cidades marcadas.
alter table public.professionals disable trigger trg_prof_updated;
update public.professionals p
   set cidades_atendidas = x.lista,
       area_atendimento  = ''
  from (
    select id, array(
             select s from (values
               ('caraguatatuba', 'caraguatatuba'), ('sao-sebastiao', 'sao sebastiao'),
               ('ilhabela', 'ilhabela'), ('ubatuba', 'ubatuba')) t(s, nome)
             where translate(lower(area_atendimento), 'áàâãéêíóôõúç', 'aaaaeeiooouc') like '%' || nome || '%'
           ) as lista
      from public.professionals
     where cardinality(cidades_atendidas) = 0
       and nullif(btrim(area_atendimento), '') is not null
       -- só quando o texto é SÓ nomes dessas cidades e ligações (e, é, ",", "/")
       and btrim(regexp_replace(
             translate(lower(area_atendimento), 'áàâãéêíóôõúç', 'aaaaeeiooouc'),
             'caraguatatuba|sao sebastiao|ilhabela|ubatuba|\me\M|[,/;&-]|\s+', ' ', 'g')) = ''
  ) x
 where p.id = x.id and cardinality(x.lista) > 0;
update public.professionals set cidades_atendidas = cidades_atendidas
 where cidades = '{}'::text[] or cidades is null or cidades[1] is distinct from city_slug;
alter table public.professionals enable trigger trg_prof_updated;

-- A vista: igual à da v12.26, com as duas colunas no fim.
-- Se o SQL da v12.30 já rodou, a vista já tem estas colunas e mais uma
-- (tem_whatsapp): recriar daqui apagaria a coluna e o Postgres recusa.
-- Aí pula.
do $vista$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'professional_stats' and column_name = 'tem_whatsapp') then
    raise notice 'professional_stats já está na v12.30: não recria';
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
      OR (char_length(btrim(coalesce(p.bio, ''))) >= 150 AND fotos.n >= 6)) AS indexavel,
    p.cidades_atendidas,
    p.cidades
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

-- conferência: deve voltar "pronto"; perfis_com_cidades = todos os que
-- têm cidade; atendem_mais_de_uma = quantos marcaram outra cidade
select case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'professional_stats' and column_name = 'cidades')
             and exists (select 1 from pg_trigger where tgname = 'trg_prof_cidades')
            then 'pronto' else 'faltou algo' end as resultado,
       (select count(*) from public.professionals where cardinality(cidades) > 0) as perfis_com_cidades,
       (select count(*) from public.professionals where cardinality(cidades_atendidas) > 0) as atendem_mais_de_uma;
