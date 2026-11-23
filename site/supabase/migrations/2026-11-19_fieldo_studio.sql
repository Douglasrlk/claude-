-- Fieldo · v12.41 · Fieldo Studio + núcleo de mídia (19/11/2026)
--
-- Entrega 5, fatias 1 e 3 da arquitetura: o núcleo comum de mídia
-- (cotas, uso, rastreio) e o Studio, que faz o vídeo NO CELULAR do
-- profissional. O servidor não renderiza nem guarda vídeo: guarda o
-- roteiro (quais fotos, que textos, qual modelo) e conta o uso.
--
-- Regras que este arquivo garante no banco, não só na tela:
--   1. CONSENTIMENTO. Só entra foto de serviço público, com portfólio
--      aceito no serviço (reports.portfolio_ok) e no perfil
--      (professionals.portfolio_publico). Conferido ao salvar E de novo
--      a cada exportação: se o consentimento cair depois, o vídeo para.
--   2. COTA. Free: 2 vídeos novos por mês (fuso de São Paulo). Pro: sem
--      limite. Regerar o mesmo vídeo não conta de novo. A reserva trava
--      por profissional, então duas abas não furam o limite.
--   3. RASTREIO. Cada vídeo tem um código; o link do perfil no vídeo
--      leva ?src=studio_<código> e a visita cai em impact_events pelo
--      log_impact_event que já existe. Resultado = consulta, sem
--      tabela nova de evento.
--   4. LGPD. Nada do cliente final além do que o perfil público já
--      mostra (avaliação de serviço público, nome curto do avaliador).
--      Apagar o serviço apaga os vídeos dele; apagar a conta, tudo.
--
-- Custo de IA deste módulo: zero. O roteiro é montado por regra no
-- aparelho. midia_uso registra custo_centavos = 0 para o Studio; o campo
-- existe para a curadoria por IA (fatia 4), que usará a mesma reserva.

-- ── 1. núcleo de mídia ──────────────────────────────────────────
create table if not exists public.midia_cotas (
  plano       text not null check (plano in ('free', 'pro')),
  modulo      text not null check (modulo ~ '^[a-z_]{3,40}$'),
  limite_mes  integer check (limite_mes is null or limite_mes >= 0),  -- null = sem limite
  primary key (plano, modulo)
);
alter table public.midia_cotas enable row level security;
revoke all on public.midia_cotas from anon, authenticated;

insert into public.midia_cotas (plano, modulo, limite_mes) values
  ('free', 'studio_video', 2),
  ('pro',  'studio_video', null)
on conflict (plano, modulo) do nothing;

create table if not exists public.midia_uso (
  id              bigint generated always as identity primary key,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  modulo          text not null,
  unidades        integer not null check (unidades > 0),
  custo_centavos  integer not null default 0 check (custo_centavos >= 0),
  ref             text,
  criado_em       timestamptz not null default now()
);
create index if not exists midia_uso_prof_idx on public.midia_uso (professional_id, modulo, criado_em desc);
alter table public.midia_uso enable row level security;
revoke all on public.midia_uso from anon, authenticated;
grant select on public.midia_uso to authenticated;
drop policy if exists midia_uso_select_own on public.midia_uso;
create policy midia_uso_select_own on public.midia_uso
  for select to authenticated using (professional_id = (select auth.uid()));

-- início do mês corrente no fuso do Brasil (a cota vira à meia-noite de SP)
create or replace function private.midia_inicio_mes() returns timestamptz
language sql stable set search_path = public, pg_temp as $$
  select (date_trunc('month', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
$$;

create or replace function private.midia_situacao(p_prof uuid, p_modulo text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_plano  text := case when private.is_pro(p_prof) then 'pro' else 'free' end;
  v_limite integer;
  v_usado  integer;
  v_ini    timestamptz := private.midia_inicio_mes();
begin
  select limite_mes into v_limite from public.midia_cotas where plano = v_plano and modulo = p_modulo;
  if not found then v_limite := 0; end if;   -- módulo sem cota cadastrada: fechado
  select coalesce(sum(unidades), 0) into v_usado
    from public.midia_uso where professional_id = p_prof and modulo = p_modulo and criado_em >= v_ini;
  return jsonb_build_object(
    'plano', v_plano, 'limite', v_limite, 'usado', v_usado,
    'restante', case when v_limite is null then null else greatest(v_limite - v_usado, 0) end,
    'renova_em', (v_ini at time zone 'America/Sao_Paulo' + interval '1 month')::date);
end $$;

-- A reserva: trava por profissional+módulo, confere a cota e grava o uso
-- na mesma transação. Quem chama decide o que é "uma unidade".
create or replace function private.midia_reservar(p_prof uuid, p_modulo text, p_unidades integer,
                                                  p_ref text, p_custo_centavos integer default 0) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sit jsonb;
begin
  if p_unidades is null or p_unidades < 1 then
    return jsonb_build_object('ok', false, 'error', 'unidades_invalidas');
  end if;
  perform pg_advisory_xact_lock(hashtext('midia:' || p_prof::text || ':' || p_modulo));
  v_sit := private.midia_situacao(p_prof, p_modulo);
  if (v_sit->>'limite') is not null and (v_sit->>'usado')::int + p_unidades > (v_sit->>'limite')::int then
    return jsonb_build_object('ok', false, 'error', 'cota_esgotada', 'cota', v_sit);
  end if;
  insert into public.midia_uso (professional_id, modulo, unidades, custo_centavos, ref)
  values (p_prof, p_modulo, p_unidades, coalesce(p_custo_centavos, 0), left(p_ref, 80));
  return jsonb_build_object('ok', true, 'cota', private.midia_situacao(p_prof, p_modulo));
end $$;

revoke all on function private.midia_inicio_mes() from public, anon, authenticated;
revoke all on function private.midia_situacao(uuid, text) from public, anon, authenticated;
revoke all on function private.midia_reservar(uuid, text, integer, text, integer) from public, anon, authenticated;

-- ── 2. vídeos do Studio ─────────────────────────────────────────
create table if not exists public.studio_videos (
  id               uuid primary key default gen_random_uuid(),
  professional_id  uuid not null references public.professionals(id) on delete cascade,
  report_id        uuid not null references public.reports(id) on delete cascade,
  codigo           text not null unique check (codigo ~ '^[a-z0-9]{10}$'),
  modelo           text not null check (modelo in ('classico', 'impacto', 'editorial')),
  trilha           text not null check (trilha in ('leve', 'ritmo', 'calma', 'nenhuma')),
  roteiro          jsonb not null,
  marca            boolean not null default true,     -- "feito com Fieldo" no fim
  formato          text check (formato in ('mp4', 'webm', 'carrossel')),
  duracao_ms       integer check (duracao_ms between 1000 and 120000),
  gerado_em        timestamptz,                         -- 1ª exportação (é o que conta na cota)
  exportacoes      integer not null default 0,
  compartilhado_em timestamptz,
  aviso_1d_em      timestamptz,
  aviso_7d_em      timestamptz,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index if not exists studio_videos_prof_idx on public.studio_videos (professional_id, criado_em desc);
create index if not exists studio_videos_avisos_idx on public.studio_videos (gerado_em) where gerado_em is not null;
alter table public.studio_videos enable row level security;
revoke all on public.studio_videos from anon, authenticated;
grant select, delete on public.studio_videos to authenticated;
drop policy if exists studio_videos_select_own on public.studio_videos;
create policy studio_videos_select_own on public.studio_videos
  for select to authenticated using (professional_id = (select auth.uid()));
drop policy if exists studio_videos_delete_own on public.studio_videos;
create policy studio_videos_delete_own on public.studio_videos
  for delete to authenticated using (professional_id = (select auth.uid()));

-- O serviço pode virar vídeo? Mesma regra do portfólio público do perfil.
create or replace function private.studio_report_elegivel(p_prof uuid, p_report uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when r.id is null                         then 'servico_nao_encontrado'
    when not coalesce(p.portfolio_publico, false) then 'portfolio_desligado'
    when not r.is_public or r.tipo <> 'servico' or r.arquivado_em is not null then 'servico_privado'
    when not r.portfolio_ok                   then 'servico_fora_do_portfolio'
    when jsonb_array_length(coalesce(r.photos, '[]'::jsonb)) = 0 then 'sem_fotos'
    else 'ok' end
  from public.professionals p
  left join public.reports r on r.id = p_report and r.professional_id = p.id
  where p.id = p_prof;
$$;
revoke all on function private.studio_report_elegivel(uuid, uuid) from public, anon, authenticated;

-- Valida a forma do roteiro e que toda foto citada é do serviço.
create or replace function private.studio_roteiro_valido(p_roteiro jsonb, p_fotos jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_url text;
  k text;
begin
  if p_roteiro is null or jsonb_typeof(p_roteiro) <> 'object' then return 'roteiro_invalido'; end if;
  if pg_column_size(p_roteiro) > 6000 then return 'roteiro_grande'; end if;
  for k in select jsonb_object_keys(p_roteiro) loop
    if k not in ('v', 'titulo', 'chamada', 'fotos', 'capa', 'antes', 'depois', 'avaliacao', 'acento') then
      return 'roteiro_invalido';
    end if;
  end loop;
  if jsonb_typeof(p_roteiro->'fotos') <> 'array'
     or jsonb_array_length(p_roteiro->'fotos') not between 1 and 8 then return 'fotos_invalidas'; end if;
  for v_url in select jsonb_array_elements_text(p_roteiro->'fotos') loop
    if not (p_fotos ? v_url) then return 'foto_fora_do_servico'; end if;
  end loop;
  foreach k in array array['capa', 'antes', 'depois'] loop
    if p_roteiro ? k and jsonb_typeof(p_roteiro->k) <> 'null' then
      if jsonb_typeof(p_roteiro->k) <> 'string' or not (p_fotos ? (p_roteiro->>k)) then return 'foto_fora_do_servico'; end if;
    end if;
  end loop;
  foreach k in array array['titulo', 'chamada'] loop
    if p_roteiro ? k and jsonb_typeof(p_roteiro->k) <> 'null' then
      if jsonb_typeof(p_roteiro->k) <> 'string' or char_length(p_roteiro->>k) > 60
         or (p_roteiro->>k) ~ '[\u0000-\u001f<>]' then return 'texto_invalido'; end if;
    end if;
  end loop;
  if p_roteiro ? 'avaliacao' and jsonb_typeof(p_roteiro->'avaliacao') not in ('boolean', 'null') then return 'roteiro_invalido'; end if;
  if p_roteiro ? 'acento' and jsonb_typeof(p_roteiro->'acento') <> 'null'
     and coalesce(p_roteiro->>'acento', '') !~ '^#[0-9a-f]{6}$' then return 'roteiro_invalido'; end if;
  return 'ok';
end $$;
revoke all on function private.studio_roteiro_valido(jsonb, jsonb) from public, anon, authenticated;

-- ── 3. funções chamadas pela tela ───────────────────────────────

-- Tudo que a tela precisa para montar um vídeo, num pedido só.
-- SECURITY DEFINER porque usa as regras privadas de elegibilidade e cota;
-- toda leitura é filtrada por auth.uid() — só os dados do próprio.
create or replace function public.studio_fontes() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_prof uuid := auth.uid();
  v_p    record;
begin
  if v_prof is null then return jsonb_build_object('ok', false, 'error', 'nao_autenticado'); end if;
  select id, name, profissao, city, uf, slug, logo_url, is_public, portfolio_publico, niche
    into v_p from public.professionals where id = v_prof;
  if not found then return jsonb_build_object('ok', false, 'error', 'perfil_nao_encontrado'); end if;

  return jsonb_build_object(
    'ok', true,
    'perfil', jsonb_build_object('id', v_p.id, 'nome', v_p.name, 'profissao', v_p.profissao, 'cidade', v_p.city,
                                 'uf', v_p.uf, 'slug', v_p.slug, 'foto', v_p.logo_url, 'publico', v_p.is_public,
                                 'portfolio_publico', coalesce(v_p.portfolio_publico, false), 'nicho', v_p.niche),
    'cota', private.midia_situacao(v_prof, 'studio_video'),
    'servicos_concluidos', (select count(*) from public.reports where professional_id = v_prof and tipo = 'servico' and arquivado_em is null),
    'servicos', coalesce((
      select jsonb_agg(s order by s->>'data' desc nulls last)
      from (
        select jsonb_build_object(
          'id', r.id,
          'titulo', coalesce(nullif(r.titulo_publico, ''), r.category_label, 'Serviço'),
          'categoria', r.category_label,
          'data', coalesce(r.service_date::text, r.created_at::date::text),
          'situacao', private.studio_report_elegivel(v_prof, r.id),
          'fotos', case when private.studio_report_elegivel(v_prof, r.id) = 'ok' then r.photos else '[]'::jsonb end,
          'total_fotos', jsonb_array_length(coalesce(r.photos, '[]'::jsonb)),
          'avaliacao', (select jsonb_build_object('nota', a.nota, 'comentario', left(a.comentario, 180),
                                                  'autor', coalesce(nullif(a.nome_avaliador_curto, ''), 'Cliente'))
                          from public.avaliacoes a
                         where a.report_id = r.id and r.is_public and a.nota between 1 and 5
                         order by a.created_at desc limit 1)
        ) as s
        from public.reports r
        where r.professional_id = v_prof and r.tipo = 'servico' and r.arquivado_em is null
          and jsonb_array_length(coalesce(r.photos, '[]'::jsonb)) > 0
        order by coalesce(r.service_date, r.created_at::date) desc
        limit 60
      ) x), '[]'::jsonb)
  );
end $$;
revoke all on function public.studio_fontes() from public, anon;
grant execute on function public.studio_fontes() to authenticated;

-- Cria ou atualiza o roteiro. Não conta cota (salvar é de graça).
create or replace function public.studio_salvar(p_id uuid, p_report_id uuid, p_modelo text, p_trilha text,
                                                p_roteiro jsonb, p_marca boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prof   uuid := auth.uid();
  v_pro    boolean;
  v_sit    text;
  v_fotos  jsonb;
  v_val    text;
  v_cod    text;
  v_id     uuid;
  v_total  integer;
begin
  if v_prof is null then return jsonb_build_object('ok', false, 'error', 'nao_autenticado'); end if;
  v_pro := private.is_pro(v_prof);

  v_sit := private.studio_report_elegivel(v_prof, p_report_id);
  if v_sit is null then return jsonb_build_object('ok', false, 'error', 'perfil_nao_encontrado'); end if;
  if v_sit <> 'ok' then return jsonb_build_object('ok', false, 'error', v_sit); end if;

  if p_modelo not in ('classico', 'impacto', 'editorial') then return jsonb_build_object('ok', false, 'error', 'modelo_invalido'); end if;
  if p_trilha not in ('leve', 'ritmo', 'calma', 'nenhuma') then return jsonb_build_object('ok', false, 'error', 'trilha_invalida'); end if;
  if not v_pro and p_modelo <> 'classico' then return jsonb_build_object('ok', false, 'error', 'pro_necessario'); end if;
  if not v_pro and coalesce(p_marca, true) = false then return jsonb_build_object('ok', false, 'error', 'pro_necessario'); end if;
  if not v_pro and p_roteiro ? 'acento' and jsonb_typeof(p_roteiro->'acento') <> 'null' then
    return jsonb_build_object('ok', false, 'error', 'pro_necessario');
  end if;

  select photos into v_fotos from public.reports where id = p_report_id;
  v_val := private.studio_roteiro_valido(p_roteiro, v_fotos);
  if v_val <> 'ok' then return jsonb_build_object('ok', false, 'error', v_val); end if;

  if p_id is null then
    select count(*) into v_total from public.studio_videos where professional_id = v_prof;
    if v_total >= 300 then return jsonb_build_object('ok', false, 'error', 'limite_de_videos'); end if;
    loop
      v_cod := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
      exit when not exists (select 1 from public.studio_videos where codigo = v_cod);
    end loop;
    insert into public.studio_videos (professional_id, report_id, codigo, modelo, trilha, roteiro, marca)
    values (v_prof, p_report_id, v_cod, p_modelo, p_trilha, p_roteiro, coalesce(p_marca, true))
    returning id into v_id;
  else
    -- 1 vídeo = 1 serviço: depois de gerado, o vídeo pode ser ajustado, mas
    -- não trocar de serviço (senão um vídeo da cota viraria vídeos ilimitados)
    if exists (select 1 from public.studio_videos where id = p_id and professional_id = v_prof
                and gerado_em is not null and report_id <> p_report_id) then
      return jsonb_build_object('ok', false, 'error', 'servico_diferente');
    end if;
    update public.studio_videos
       set report_id = p_report_id, modelo = p_modelo, trilha = p_trilha, roteiro = p_roteiro,
           marca = coalesce(p_marca, true), atualizado_em = now()
     where id = p_id and professional_id = v_prof
    returning id, codigo into v_id, v_cod;
    if v_id is null then return jsonb_build_object('ok', false, 'error', 'nao_encontrado'); end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'codigo', v_cod);
end $$;
revoke all on function public.studio_salvar(uuid, uuid, text, text, jsonb, boolean) from public, anon;
grant execute on function public.studio_salvar(uuid, uuid, text, text, jsonb, boolean) to authenticated;

-- Chamado ANTES de gravar o arquivo no celular. Reconfere consentimento
-- e plano, e na 1ª vez reserva a cota. Devolve o código de rastreio.
create or replace function public.studio_exportar(p_id uuid, p_formato text, p_duracao_ms integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prof uuid := auth.uid();
  v      public.studio_videos%rowtype;
  v_sit  text;
  v_res  jsonb;
  v_pro  boolean;
begin
  if v_prof is null then return jsonb_build_object('ok', false, 'error', 'nao_autenticado'); end if;
  if p_formato not in ('mp4', 'webm', 'carrossel') then return jsonb_build_object('ok', false, 'error', 'formato_invalido'); end if;
  if p_duracao_ms is null or p_duracao_ms not between 1000 and 120000 then
    return jsonb_build_object('ok', false, 'error', 'duracao_invalida');
  end if;

  select * into v from public.studio_videos where id = p_id and professional_id = v_prof for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'nao_encontrado'); end if;

  v_sit := private.studio_report_elegivel(v_prof, v.report_id);
  if v_sit <> 'ok' then return jsonb_build_object('ok', false, 'error', v_sit); end if;
  -- o QR e o link levam ao perfil: perfil oculto ou sem endereço não tem para onde levar
  if not exists (select 1 from public.professionals where id = v_prof and is_public and coalesce(slug, '') <> '') then
    return jsonb_build_object('ok', false, 'error', 'perfil_privado');
  end if;
  if private.studio_roteiro_valido(v.roteiro, (select photos from public.reports where id = v.report_id)) <> 'ok' then
    return jsonb_build_object('ok', false, 'error', 'foto_fora_do_servico');   -- foto saiu do serviço depois de salvar
  end if;

  v_pro := private.is_pro(v_prof);
  if not v_pro and (v.modelo <> 'classico' or not v.marca) then   -- o Pro venceu entre salvar e gerar
    return jsonb_build_object('ok', false, 'error', 'pro_necessario');
  end if;

  if v.gerado_em is null then
    v_res := private.midia_reservar(v_prof, 'studio_video', 1, v.id::text, 0);
    if not (v_res->>'ok')::boolean then return v_res; end if;
  end if;

  update public.studio_videos
     set gerado_em = coalesce(gerado_em, now()), exportacoes = exportacoes + 1,
         formato = p_formato, duracao_ms = p_duracao_ms, atualizado_em = now()
   where id = v.id;

  return jsonb_build_object('ok', true, 'codigo', v.codigo, 'origem', 'studio_' || v.codigo,
                            'primeira_vez', v.gerado_em is null,
                            'cota', private.midia_situacao(v_prof, 'studio_video'));
end $$;
revoke all on function public.studio_exportar(uuid, text, integer) from public, anon;
grant execute on function public.studio_exportar(uuid, text, integer) to authenticated;

create or replace function public.studio_compartilhado(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'nao_autenticado'); end if;
  update public.studio_videos set compartilhado_em = coalesce(compartilhado_em, now())
   where id = p_id and professional_id = auth.uid() and gerado_em is not null;
  if not found then return jsonb_build_object('ok', false, 'error', 'nao_encontrado'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.studio_compartilhado(uuid) from public, anon;
grant execute on function public.studio_compartilhado(uuid) to authenticated;

-- Os vídeos do profissional e o que cada um rendeu. SECURITY INVOKER:
-- RLS de studio_videos e de impact_events (dono lê os próprios).
create or replace function public.studio_meus() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'codigo', v.codigo, 'report_id', v.report_id, 'modelo', v.modelo, 'trilha', v.trilha,
           'roteiro', v.roteiro, 'marca', v.marca, 'formato', v.formato, 'duracao_ms', v.duracao_ms,
           'gerado_em', v.gerado_em, 'compartilhado_em', v.compartilhado_em, 'criado_em', v.criado_em,
           'visitas',  coalesce(e.visitas, 0), 'whatsapp', coalesce(e.whatsapp, 0), 'ligacoes', coalesce(e.ligacoes, 0))
         order by v.criado_em desc), '[]'::jsonb)
  from public.studio_videos v
  left join lateral (
    select count(*) filter (where ie.event_type = 'view')           as visitas,
           count(*) filter (where ie.event_type = 'whatsapp_click') as whatsapp,
           count(*) filter (where ie.event_type = 'call_click')     as ligacoes
      from public.impact_events ie
     where ie.professional_id = v.professional_id and ie.source = 'studio_' || v.codigo
  ) e on true
  where v.professional_id = auth.uid();
$$;
revoke all on function public.studio_meus() from public, anon;
grant execute on function public.studio_meus() to authenticated;

create index if not exists impact_events_prof_source_idx on public.impact_events (professional_id, source);

-- ── 4. aviso de resultado (o "seu vídeo trouxe…") ───────────────
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.notificacoes'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%tipo%' loop
    execute format('alter table public.notificacoes drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.notificacoes add constraint notificacoes_tipo_check
  check (tipo in ('pro_vencendo', 'pro_encerrado', 'sistema', 'studio_resultado'));

-- Só avisa quando há número real para mostrar. Um aviso por vídeo no
-- 1º dia e outro no 7º; a chave única de notificacoes impede repetição.
create or replace function private.studio_avisos() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  n integer := 0;
  v_txt text;
begin
  for r in
    select v.id, v.professional_id, v.gerado_em, v.aviso_1d_em, v.aviso_7d_em,
           count(*) filter (where ie.event_type = 'view') as visitas,
           count(*) filter (where ie.event_type in ('whatsapp_click', 'call_click')) as contatos
      from public.studio_videos v
      join public.impact_events ie on ie.professional_id = v.professional_id and ie.source = 'studio_' || v.codigo
     where v.gerado_em between now() - interval '9 days' and now() - interval '20 hours'
       and (v.aviso_1d_em is null or (v.aviso_7d_em is null and v.gerado_em <= now() - interval '7 days'))
     group by v.id
  loop
    continue when r.visitas = 0 and r.contatos = 0;
    v_txt := r.visitas || ' visita' || case when r.visitas = 1 then '' else 's' end || ' ao seu perfil';
    if r.contatos > 0 then
      v_txt := v_txt || ' e ' || r.contatos || ' contato' || case when r.contatos = 1 then '' else 's' end || ' pelo WhatsApp ou telefone';
    end if;
    if r.gerado_em > now() - interval '7 days' then
      insert into public.notificacoes (professional_id, tipo, titulo, mensagem, link, chave)
      values (r.professional_id, 'studio_resultado', 'Seu vídeo já está trazendo gente',
              'Desde que você gerou o vídeo: ' || v_txt || '.', 'studio.html?v=' || r.id, 'studio1d:' || r.id)
      on conflict (chave) do nothing;
      update public.studio_videos set aviso_1d_em = now() where id = r.id;
    else
      insert into public.notificacoes (professional_id, tipo, titulo, mensagem, link, chave)
      values (r.professional_id, 'studio_resultado', 'Uma semana do seu vídeo',
              'Em 7 dias, o vídeo trouxe ' || v_txt || '. Que tal fazer outro com o próximo serviço?',
              'studio.html?v=' || r.id, 'studio7d:' || r.id)
      on conflict (chave) do nothing;
      update public.studio_videos set aviso_1d_em = coalesce(aviso_1d_em, now()), aviso_7d_em = now() where id = r.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.studio_avisos() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'studio-avisos-diario') then
      perform cron.unschedule('studio-avisos-diario');
    end if;
    perform cron.schedule('studio-avisos-diario', '23 13 * * *', 'select private.studio_avisos()');
  end if;
end $$;
