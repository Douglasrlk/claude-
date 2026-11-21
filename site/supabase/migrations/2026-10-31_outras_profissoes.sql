-- Fieldo · v12.25 · mais de uma profissão no mesmo perfil (31/10)
--
-- Pedido de quem se cadastrou: "não dá pra adicionar mais profissões?".
-- Até aqui o perfil tinha UMA profissão (profissao + niche). Quem é
-- eletricista e também instala ar-condicionado só aparecia numa busca.
--
-- Desenho:
--   · profissao + niche continuam sendo a profissão PRINCIPAL (título do
--     Google, endereço do perfil, tudo o que já existe não muda);
--   · outras_profissoes = até 3 a mais, [{ "rotulo": "...", "nicho": "..." }],
--     no mesmo formato que o cadastro já usa para a principal (o texto que
--     a pessoa escolheu + a chave do catálogo);
--   · nichos = todas as chaves (principal + outras), mantida pelo banco.
--     É por ela que a busca e as páginas /pedreiro-em-cidade filtram.
--
-- Pode rodar de novo sem problema.

begin;

alter table public.professionals
  add column if not exists outras_profissoes jsonb not null default '[]'::jsonb,
  add column if not exists nichos text[] not null default '{}';

alter table public.professionals drop constraint if exists professionals_outras_profissoes_check;
alter table public.professionals add constraint professionals_outras_profissoes_check
  check (jsonb_typeof(outras_profissoes) = 'array' and jsonb_array_length(outras_profissoes) <= 3);

-- Limpa o que chega (texto vazio, chave estranha, repetida ou igual à
-- principal) e recalcula nichos. Quem escreve é a própria pessoa, pelo
-- app: o banco não confia no formato.
create or replace function public.trg_prof_nichos() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_lista  jsonb := '[]'::jsonb;
  v_vistos text[] := array[]::text[];
  e        jsonb;
  v_rot    text;
  v_nicho  text;
begin
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

drop trigger if exists trg_prof_nichos on public.professionals;
create trigger trg_prof_nichos before insert or update of niche, outras_profissoes on public.professionals
  for each row execute function public.trg_prof_nichos();

create index if not exists professionals_nichos_gin on public.professionals using gin (nichos);

-- A pessoa escreve as outras profissões; nichos é só do banco.
grant select (outras_profissoes, nichos) on public.professionals to anon, authenticated;
grant insert (outras_profissoes), update (outras_profissoes) on public.professionals to authenticated;

-- Perfis que já existem: nichos = a profissão principal. Sem mexer em
-- updated_at (senão o sitemap diria ao Google que todo perfil mudou hoje).
alter table public.professionals disable trigger trg_prof_updated;
update public.professionals
   set nichos = case when niche is null or btrim(niche) = '' then '{}'::text[] else array[niche] end
 where nichos = '{}'::text[] or nichos is null;
alter table public.professionals enable trigger trg_prof_updated;

-- A vista pública ganha as duas colunas no fim (o resto fica igual).
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
    p.registros,
    p.outras_profissoes,
    p.nichos
   FROM professionals p
     LEFT JOIN avaliacoes a ON a.professional_id = p.id
     LEFT JOIN reports ar ON ar.id = a.report_id
     LEFT JOIN reports r ON r.professional_id = p.id AND r.is_public
  WHERE p.is_public
  GROUP BY p.id;

commit;

-- conferência: deve voltar "pronto" e quantos perfis já têm nichos
select case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'professional_stats' and column_name = 'nichos')
             and exists (select 1 from pg_trigger where tgname = 'trg_prof_nichos')
       then 'pronto' else 'faltou algo' end as resultado,
       (select count(*) from public.professionals where cardinality(nichos) > 0) as perfis_com_profissao;
