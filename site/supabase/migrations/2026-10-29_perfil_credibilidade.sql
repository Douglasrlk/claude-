-- ============================================================
-- Fieldo · v12.13 · Campos de credibilidade do profissional
-- ------------------------------------------------------------
-- Dois tipos de informação, com regras diferentes:
--
-- 1. CONFERIDA (só o servidor grava): CNPJ e o que a Receita
--    Federal diz dele — nome da empresa, situação, data de abertura
--    e quando foi conferido. O papel `authenticated` NÃO recebe
--    UPDATE nessas colunas: o profissional não consegue escrever
--    "CNPJ ativo" à mão. Quem grava é a Edge Function verificar-cnpj,
--    depois de consultar a Receita.
--
-- 2. DECLARADA (o profissional preenche): desde quando atua, garantia,
--    formas de pagamento, se atende urgência e registros profissionais
--    (NR-10, CREA…). O perfil mostra como "informado pelo profissional".
-- ============================================================

alter table public.professionals
  add column if not exists cnpj                text,
  add column if not exists empresa_nome        text,
  add column if not exists cnpj_situacao       text,
  add column if not exists cnpj_abertura       date,
  add column if not exists cnpj_verificado_em  timestamptz,
  add column if not exists atua_desde          smallint,
  add column if not exists garantia            text,
  add column if not exists formas_pagamento    text[],
  add column if not exists atende_urgencia     boolean not null default false,
  add column if not exists registros           text;

alter table public.professionals
  drop constraint if exists prof_cnpj_formato,
  add  constraint prof_cnpj_formato check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  drop constraint if exists prof_atua_desde_faixa,
  add  constraint prof_atua_desde_faixa check (atua_desde is null or atua_desde between 1950 and 2100),
  drop constraint if exists prof_garantia_tam,
  add  constraint prof_garantia_tam check (garantia is null or char_length(garantia) <= 60),
  drop constraint if exists prof_registros_tam,
  add  constraint prof_registros_tam check (registros is null or char_length(registros) <= 200),
  drop constraint if exists prof_pagamentos_validos,
  add  constraint prof_pagamentos_validos check (
    formas_pagamento is null or formas_pagamento <@ array['pix','dinheiro','cartao_credito','cartao_debito','boleto','transferencia']::text[]
  );

create unique index if not exists professionals_cnpj_uk on public.professionals (cnpj) where cnpj is not null;

-- Visitante lê tudo que vai para o perfil público
grant select (cnpj, empresa_nome, cnpj_situacao, cnpj_abertura, cnpj_verificado_em,
              atua_desde, garantia, formas_pagamento, atende_urgencia, registros)
  on public.professionals to anon, authenticated;

-- O dono edita SÓ os campos declarados (o CNPJ vem do servidor)
grant update (atua_desde, garantia, formas_pagamento, atende_urgencia, registros)
  on public.professionals to authenticated;

-- A view do perfil (usada pelo HTML servido ao Google) ganha os campos
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
    round(avg(a.nota) FILTER (WHERE ar.is_public), 1) AS media_geral,
    count(DISTINCT a.id) FILTER (WHERE ar.is_public) AS total_geral,
    count(DISTINCT r.id) AS total_servicos_confirmados,
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
    p.registros
   FROM professionals p
     LEFT JOIN avaliacoes a ON a.professional_id = p.id
     LEFT JOIN reports ar ON ar.id = a.report_id
     LEFT JOIN reports r ON r.professional_id = p.id AND r.is_public
  WHERE p.is_public
  GROUP BY p.id;
