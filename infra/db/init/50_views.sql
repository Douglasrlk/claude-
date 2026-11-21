-- Fieldo · baseline extraída do catálogo de produção (projeto jrsctnncoljdcvdofxsg, PG 17)
-- Gerado em 2026-11-21. NÃO editar à mão: regenerar a partir do banco.
-- Parte: views

CREATE OR REPLACE VIEW public.professional_stats AS
 SELECT p.id,
    p.name,
    p.profissao,
    p.specialty,
    p.city,
    p.slug,
    p.logo_url,
    p.plan,
    p.is_public AS active,
    round(avg(a.nota) FILTER (WHERE (ar.is_public AND (ar.tipo = 'servico'::text))), 1) AS media_geral,
    count(DISTINCT a.id) FILTER (WHERE (ar.is_public AND (ar.tipo = 'servico'::text))) AS total_geral,
    count(DISTINCT r.id) FILTER (WHERE (r.tipo = 'servico'::text)) AS total_servicos_confirmados,
        CASE
            WHEN p.portfolio_publico THEN ( SELECT (rr.photos ->> 0)
               FROM reports rr
              WHERE ((rr.professional_id = p.id) AND rr.is_public AND rr.portfolio_ok AND (jsonb_array_length(COALESCE(rr.photos, '[]'::jsonb)) > 0))
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
    ((count(DISTINCT r.id) FILTER (WHERE (r.tipo = 'servico'::text)) >= 3) OR ((char_length(btrim(COALESCE(p.bio, ''::text))) >= 150) AND (fotos.n >= 6))) AS indexavel,
    p.cidades_atendidas,
    p.cidades,
    (NULLIF(btrim(COALESCE(p.whatsapp, ''::text)), ''::text) IS NOT NULL) AS tem_whatsapp
   FROM ((((professionals p
     LEFT JOIN avaliacoes a ON ((a.professional_id = p.id)))
     LEFT JOIN reports ar ON ((ar.id = a.report_id)))
     LEFT JOIN reports r ON (((r.professional_id = p.id) AND r.is_public)))
     CROSS JOIN LATERAL ( SELECT (
                CASE
                    WHEN p.portfolio_publico THEN COALESCE(( SELECT sum(
                            CASE
                                WHEN (jsonb_typeof(rf.photos) = 'array'::text) THEN jsonb_array_length(rf.photos)
                                ELSE 0
                            END) AS sum
                       FROM reports rf
                      WHERE ((rf.professional_id = p.id) AND rf.is_public AND rf.portfolio_ok)), (0)::bigint)
                    ELSE (0)::bigint
                END)::integer AS n) fotos)
  WHERE p.is_public
  GROUP BY p.id, fotos.n;

CREATE OR REPLACE VIEW public.vw_avaliacoes_publicas WITH (security_invoker=true) AS
 SELECT a.id,
    a.professional_id,
    a.report_id,
    a.nota,
    a.comentario,
    a.nome_avaliador_curto AS nome_avaliador,
    a.resposta,
    a.respondido_em,
    a.created_at
   FROM ((avaliacoes a
     JOIN reports r ON (((r.id = a.report_id) AND r.is_public)))
     JOIN professionals p ON (((p.id = a.professional_id) AND p.is_public)));

CREATE OR REPLACE VIEW public.vw_selos_publicos WITH (security_invoker=true) AS
 SELECT h.id,
    h.professional_id,
    h.tipo,
    h.created_at
   FROM (document_hashes h
     JOIN professionals p ON (((p.id = h.professional_id) AND p.is_public)));

CREATE OR REPLACE VIEW public.catalogo_publico WITH (security_invoker=true) AS
 SELECT e.id,
    e.slug,
    e.nome,
    e.marca,
    e.modelo,
    e.descricao,
    e.specs,
    e.fotos,
    e.preco_dia,
    e.preco_semana,
    e.preco_mes,
    e.caucao,
    e.quantidade,
    e.updated_at,
    c.slug AS categoria_slug,
    c.nome AS categoria_nome,
    c.emoji AS categoria_emoji,
    l.id AS locadora_id,
    l.nome AS locadora_nome,
    l.slug AS locadora_slug,
    l.whatsapp,
    l.entrega,
    l.raio_entrega_km,
    l.city,
    l.city_slug,
    l.uf,
    equip_disponivel(e.id, CURRENT_DATE, CURRENT_DATE) AS disponivel_hoje
   FROM ((equipamentos e
     JOIN equipamento_categorias c ON ((c.id = e.categoria_id)))
     JOIN locadoras l ON ((l.id = e.locadora_id)))
  WHERE (e.is_public AND e.ativo AND c.aprovada AND l.is_public);

CREATE OR REPLACE VIEW public.catalogo_hubs WITH (security_invoker=true) AS
 SELECT categoria_slug,
    categoria_nome,
    categoria_emoji,
    city_slug,
    city,
    uf,
    (count(*))::integer AS total,
    min(preco_dia) AS preco_min,
    max(preco_dia) AS preco_max,
    (sum(disponivel_hoje))::integer AS disponiveis,
    max(updated_at) AS updated_at
   FROM catalogo_publico
  WHERE (city_slug IS NOT NULL)
  GROUP BY categoria_slug, categoria_nome, categoria_emoji, city_slug, city, uf;

CREATE OR REPLACE VIEW public.locadoras_publicas WITH (security_invoker=true) AS
 SELECT l.id,
    l.nome,
    l.slug,
    l.city,
    l.city_slug,
    l.uf,
    l.bio,
    l.logo_url,
    l.whatsapp,
    l.instagram,
    l.entrega,
    l.raio_entrega_km,
    l.horario,
    l.endereco,
    l.created_at,
    l.updated_at,
    (count(e.id))::integer AS total_equipamentos
   FROM (locadoras l
     LEFT JOIN equipamentos e ON (((e.locadora_id = l.id) AND e.is_public AND e.ativo)))
  WHERE l.is_public
  GROUP BY l.id;

CREATE OR REPLACE VIEW public.vw_portfolio_publico WITH (security_invoker=true) AS
 SELECT r.id,
    r.professional_id,
    r.category_key,
    r.category_label,
    r.niche,
    r.service_date,
    r.rating,
    r.portfolio_ok,
    r.created_at,
        CASE
            WHEN (p.portfolio_publico AND r.portfolio_ok) THEN COALESCE(r.photos, '[]'::jsonb)
            ELSE '[]'::jsonb
        END AS photos,
    r.titulo_publico
   FROM (reports r
     JOIN professionals p ON ((p.id = r.professional_id)))
  WHERE (r.is_public AND p.is_public);
