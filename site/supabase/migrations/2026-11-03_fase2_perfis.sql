-- Fieldo · v12.27 · Fase 2 da auditoria SEO/GEO (03/11) · perfis
--
-- Estrutura só (regras que valem para todo mundo, daqui em diante).
-- Correções de perfis específicos ficam em outro arquivo, à parte:
-- 2026-11-03_fase2_correcoes_cadastro.sql.
--
-- 1. A categoria (niche) passa a ser gravada sempre no formato de chave
--    do catálogo: "higienização de estofados" virava uma categoria que
--    nenhuma página "…-em-cidade" reconhece (auditoria, P4). Agora vira
--    "higienizacao-de-estofados". Vale para o que já existe e para o que
--    chegar.
-- 2. UF: o cadastro só pede a cidade, e "Caraguatatuba" sem "- SP"
--    deixava a UF vazia em 100% da base. O Google e as IAs recebiam o
--    endereço sem estado (P13). Para as cidades de nome único no país
--    (Caraguatatuba, Ilhabela, Ubatuba, Cajamar, Guarulhos) a UF é SP.
--    São Sebastião fica de fora de propósito: existe também em Alagoas;
--    ali a UF só entra se a pessoa escrever "São Sebastião - SP".
--
-- Nenhum perfil muda de data (o sitemap não diria ao Google que todos
-- mudaram hoje). Pode rodar de novo sem problema.
-- Depende da v12.25 (coluna nichos). Roda antes ou depois da v12.26.

begin;

-- ── 1. Categoria sempre como chave ──────────────────────────────────
create or replace function public.fieldo_chave_categoria(p text)
returns text language sql immutable set search_path = pg_catalog, pg_temp as $$
  select nullif(btrim(regexp_replace(
           translate(lower(btrim(coalesce(p, ''))),
                     'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
           '[^a-z0-9]+', '-', 'g'), '-'), '')
$$;

-- Igual à da v12.25, com a primeira linha nova (niche normalizado).
create or replace function public.trg_prof_nichos() returns trigger
language plpgsql set search_path = public, pg_temp as $$
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
end $$;

-- ── 2. UF pelas cidades de nome único ───────────────────────────────
create or replace function public.trg_cidade() returns trigger
language plpgsql set search_path = public, pg_temp as $$
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
end $$;

-- ── Acerto do que já existe, sem mexer em updated_at ────────────────
alter table public.professionals disable trigger trg_prof_updated;
update public.professionals set niche = niche
 where niche is not null and niche !~ '^[a-z0-9][a-z0-9-]*$';
update public.professionals set city = city
 where uf is null and city_slug in ('caraguatatuba', 'ilhabela', 'ubatuba', 'cajamar', 'guarulhos');
alter table public.professionals enable trigger trg_prof_updated;

commit;

-- conferência: deve voltar "pronto", 0 categorias fora do formato e
-- quantos perfis ganharam UF
select case when (select count(*) from public.professionals
                   where niche is not null and niche !~ '^[a-z0-9][a-z0-9-]*$') = 0
            then 'pronto' else 'faltou algo' end as resultado,
       (select count(*) from public.professionals where uf = 'SP') as perfis_com_uf;
