-- Fieldo · v12.43 · Vídeo no relatório + Studio v2 (21/11/2026)
--
-- Pedido do dono:
--   · enviar vídeo no relatório para o cliente (até 30 s);
--   · esse vídeo entra no Studio;
--   · música do aparelho e mais 30 trilhas compostas;
--   · tirar do vídeo o link e o QR do perfil, mais opções de encerramento;
--   · ferramentas de edição (ordem e duração das cenas, texto, transição,
--     filtro, corte e velocidade dos clipes, volume).
--
-- O que muda aqui:
--   1. reports.videos (jsonb): até 3 vídeos por relatório, cada um
--      {url, duracao (≤ 30,5 s), capa, w, h}. O limite de 30 s é conferido
--      no aparelho (o banco não abre o arquivo); o tamanho é travado pelo
--      bucket (50 MB).
--   2. Bucket público "videos" (mesmo modelo do "photos": endereço
--      impossível de adivinhar, pasta = id do dono). Só vídeo e a capa JPEG.
--   3. report_por_token devolve os vídeos ao cliente.
--   4. Studio: serviço com só vídeo também pode virar vídeo; o roteiro v2
--      ganha chaves novas, todas opcionais (roteiro v1 continua válido);
--      trilha aceita qualquer id curto (as 33 compostas e "aparelho").
--      A música do aparelho NUNCA sobe: fica só no celular; o banco guarda
--      volume, trecho e o nome do arquivo.
--
-- Idempotente. A parte de storage só roda onde o schema storage já existe.

-- ── 1. vídeos do relatório ───────────────────────────────────────
create or replace function private.report_videos_ok(p jsonb) returns boolean
language plpgsql immutable set search_path = public, pg_temp as $$
declare e jsonb; k text;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 3 or pg_column_size(p) > 4000 then return false; end if;
  for e in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(e) <> 'object' then return false; end if;
    for k in select jsonb_object_keys(e) loop
      if k not in ('url', 'duracao', 'capa', 'w', 'h') then return false; end if;
    end loop;
    if jsonb_typeof(e->'url') <> 'string' or char_length(e->>'url') > 600
       or (e->>'url') !~ '^https?://[^\s"''<>]+$' then return false; end if;
    if jsonb_typeof(e->'duracao') <> 'number' or (e->>'duracao')::numeric <= 0 or (e->>'duracao')::numeric > 30.5 then return false; end if;
    if e ? 'capa' and jsonb_typeof(e->'capa') <> 'null' and (jsonb_typeof(e->'capa') <> 'string'
       or char_length(e->>'capa') > 600 or (e->>'capa') !~ '^https?://[^\s"''<>]+$') then return false; end if;
    foreach k in array array['w', 'h'] loop
      if e ? k and jsonb_typeof(e->k) <> 'null' and (jsonb_typeof(e->k) <> 'number' or (e->>k)::numeric not between 1 and 8192) then return false; end if;
    end loop;
  end loop;
  return true;
end $$;
-- ATENÇÃO: é chamada por CHECK de reports, e CHECK roda com o papel de quem
-- grava. Sem EXECUTE para authenticated, TODO insert em reports falha
-- ("permission denied for function report_videos_ok") — pego no teste local.
-- É validação pura, e o schema private não é exposto pelo PostgREST.
revoke all on function private.report_videos_ok(jsonb) from public;
grant execute on function private.report_videos_ok(jsonb) to anon, authenticated, service_role;

alter table public.reports add column if not exists videos jsonb not null default '[]'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reports_videos_ck') then
    alter table public.reports add constraint reports_videos_ck check (private.report_videos_ok(videos));
  end if;
end $$;
-- authenticated já tem UPDATE de tabela em reports (a RLS limita ao dono);
-- anon não lê a coluna: o cliente recebe os vídeos por report_por_token.

-- ── 2. bucket "videos" ──────────────────────────────────────────
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage ainda não existe: bucket "videos" fica para quando existir';
    return;
  end if;
  execute $q$
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('videos', 'videos', true, 52428800, array['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg'])
    on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
                                   allowed_mime_types = excluded.allowed_mime_types $q$;
  execute 'drop policy if exists vd_write on storage.objects';
  execute $q$
    create policy vd_write on storage.objects for all to authenticated
      using (bucket_id = 'videos' and (storage.foldername(name))[1] = (select auth.uid())::text)
      with check (bucket_id = 'videos' and (storage.foldername(name))[1] = (select auth.uid())::text) $q$;
exception when insufficient_privilege then
  -- no Supabase o postgres pode; no ambiente local quem cria é o db-post (superusuário)
  raise notice 'sem permissão em storage: bucket "videos" não criado por este papel';
end $$;

-- ── 3. o cliente vê os vídeos ────────────────────────────────────
create or replace function public.report_por_token(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare r public.reports%rowtype;
begin
  select * into r from public.reports where rating_token = p_token;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', r.id, 'professional_id', r.professional_id,
    'client_name', r.client_name,
    'category_key', r.category_key, 'category_label', r.category_label,
    'niche', r.niche, 'service_date', r.service_date,
    'service_location', r.service_location,
    'service_description', r.service_description,
    'photos', r.photos, 'videos', coalesce(r.videos, '[]'::jsonb), 'valor', r.valor,
    'payment_status', r.payment_status,
    'client_paid_claim_at', r.client_paid_claim_at,
    'rating', r.rating, 'rating_comment', r.rating_comment,
    'rating_used', r.rating_used,
    'linked_budget_id', r.linked_budget_id,
    'created_at', r.created_at
  );
end $function$;

-- ── 4. Studio ────────────────────────────────────────────────────
alter table public.studio_videos drop constraint if exists studio_videos_trilha_check;
alter table public.studio_videos add constraint studio_videos_trilha_check check (trilha ~ '^[a-z0-9_]{2,32}$');

-- serviço com foto OU vídeo pode virar vídeo (mesmas regras de portfólio)
create or replace function private.studio_report_elegivel(p_prof uuid, p_report uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when r.id is null                         then 'servico_nao_encontrado'
    when not coalesce(p.portfolio_publico, false) then 'portfolio_desligado'
    when not r.is_public or r.tipo <> 'servico' or r.arquivado_em is not null then 'servico_privado'
    when not r.portfolio_ok                   then 'servico_fora_do_portfolio'
    when jsonb_array_length(coalesce(r.photos, '[]'::jsonb)) = 0
     and jsonb_array_length(coalesce(r.videos, '[]'::jsonb)) = 0 then 'sem_fotos'
    else 'ok' end
  from public.professionals p
  left join public.reports r on r.id = p_report and r.professional_id = p.id
  where p.id = p_prof;
$$;
revoke all on function private.studio_report_elegivel(uuid, uuid) from public, anon, authenticated;

create or replace function private.studio_txt_ok(p jsonb, p_max integer) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select p is null or jsonb_typeof(p) = 'null'
      or (jsonb_typeof(p) = 'string' and char_length(p #>> '{}') <= p_max and (p #>> '{}') !~ '[\u0000-\u001f<>]');
$$;
revoke all on function private.studio_txt_ok(jsonb, integer) from public, anon, authenticated;

create or replace function private.studio_num_ok(p jsonb, p_min numeric, p_max numeric) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select p is null or jsonb_typeof(p) = 'null'
      or (jsonb_typeof(p) = 'number' and (p #>> '{}')::numeric between p_min and p_max);
$$;
revoke all on function private.studio_num_ok(jsonb, numeric, numeric) from public, anon, authenticated;

-- Roteiro v2. Toda chave nova é opcional; o v1 passa igual.
create or replace function private.studio_roteiro_valido(p_roteiro jsonb, p_fotos jsonb, p_videos jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_url text; k text; e jsonb; v_urls_video text[]; n_fotos int := 0; n_videos int := 0;
begin
  if p_roteiro is null or jsonb_typeof(p_roteiro) <> 'object' then return 'roteiro_invalido'; end if;
  if pg_column_size(p_roteiro) > 16000 then return 'roteiro_grande'; end if;
  for k in select jsonb_object_keys(p_roteiro) loop
    if k not in ('v', 'titulo', 'chamada', 'fotos', 'capa', 'antes', 'depois', 'avaliacao', 'acento',
                 'videos', 'cenas', 'filtro', 'transicao', 'encerramento', 'musica', 'textoEstilo') then
      return 'roteiro_invalido';
    end if;
  end loop;

  -- fotos (0 a 8) — todas do serviço
  if p_roteiro ? 'fotos' then
    if jsonb_typeof(p_roteiro->'fotos') <> 'array' or jsonb_array_length(p_roteiro->'fotos') > 8 then return 'fotos_invalidas'; end if;
    n_fotos := jsonb_array_length(p_roteiro->'fotos');
    for v_url in select jsonb_array_elements_text(p_roteiro->'fotos') loop
      if not (coalesce(p_fotos, '[]'::jsonb) ? v_url) then return 'foto_fora_do_servico'; end if;
    end loop;
  end if;
  foreach k in array array['capa', 'antes', 'depois'] loop
    if p_roteiro ? k and jsonb_typeof(p_roteiro->k) <> 'null' then
      if jsonb_typeof(p_roteiro->k) <> 'string' or not (coalesce(p_fotos, '[]'::jsonb) ? (p_roteiro->>k)) then return 'foto_fora_do_servico'; end if;
    end if;
  end loop;

  -- clipes (0 a 3) — todos dos vídeos do serviço, até 30 s cada
  select coalesce(array_agg(x->>'url'), '{}') into v_urls_video from jsonb_array_elements(coalesce(p_videos, '[]'::jsonb)) x;
  if p_roteiro ? 'videos' and jsonb_typeof(p_roteiro->'videos') <> 'null' then
    if jsonb_typeof(p_roteiro->'videos') <> 'array' or jsonb_array_length(p_roteiro->'videos') > 3 then return 'roteiro_invalido'; end if;
    n_videos := jsonb_array_length(p_roteiro->'videos');
    for e in select value from jsonb_array_elements(p_roteiro->'videos') loop
      if jsonb_typeof(e) <> 'object' then return 'roteiro_invalido'; end if;
      for k in select jsonb_object_keys(e) loop
        if k not in ('url', 'de', 'ate', 'vel', 'vol') then return 'roteiro_invalido'; end if;
      end loop;
      if jsonb_typeof(e->'url') <> 'string' or not ((e->>'url') = any(v_urls_video)) then return 'foto_fora_do_servico'; end if;
      if not private.studio_num_ok(e->'de', 0, 30.5) or not private.studio_num_ok(e->'ate', 0.3, 30.5)
         or not private.studio_num_ok(e->'vol', 0, 1) then return 'roteiro_invalido'; end if;
      if e ? 'vel' and jsonb_typeof(e->'vel') <> 'null'
         and (jsonb_typeof(e->'vel') <> 'number' or (e->>'vel')::numeric not in (0.5, 0.75, 1, 1.25, 1.5, 2)) then return 'roteiro_invalido'; end if;
      if coalesce((e->>'ate')::numeric, 30) <= coalesce((e->>'de')::numeric, 0) then return 'roteiro_invalido'; end if;
    end loop;
  end if;
  if n_fotos + n_videos = 0 then return 'fotos_invalidas'; end if;

  foreach k in array array['titulo', 'chamada'] loop
    if not private.studio_txt_ok(p_roteiro->k, 60) then return 'texto_invalido'; end if;
  end loop;
  if p_roteiro ? 'avaliacao' and jsonb_typeof(p_roteiro->'avaliacao') not in ('boolean', 'null') then return 'roteiro_invalido'; end if;
  if p_roteiro ? 'acento' and jsonb_typeof(p_roteiro->'acento') <> 'null'
     and coalesce(p_roteiro->>'acento', '') !~ '^#[0-9a-f]{6}$' then return 'roteiro_invalido'; end if;

  -- linha do tempo: ordem, duração, texto e transição por cena
  if p_roteiro ? 'cenas' and jsonb_typeof(p_roteiro->'cenas') <> 'null' then
    if jsonb_typeof(p_roteiro->'cenas') <> 'array' or jsonb_array_length(p_roteiro->'cenas') > 20 then return 'roteiro_invalido'; end if;
    for e in select value from jsonb_array_elements(p_roteiro->'cenas') loop
      if jsonb_typeof(e) <> 'object' then return 'roteiro_invalido'; end if;
      for k in select jsonb_object_keys(e) loop
        if k not in ('id', 'dur', 'texto', 'trans', 'oculta') then return 'roteiro_invalido'; end if;
      end loop;
      if jsonb_typeof(e->'id') <> 'string' or char_length(e->>'id') > 620
         or (e->>'id') !~ '^(abertura|antesDepois|avaliacao|fechamento|video:[0-2]|foto:https?://[^\s"''<>]+)$' then return 'roteiro_invalido'; end if;
      if not private.studio_num_ok(e->'dur', 0.8, 10) then return 'roteiro_invalido'; end if;
      if not private.studio_txt_ok(e->'texto', 60) then return 'texto_invalido'; end if;
      if e ? 'oculta' and jsonb_typeof(e->'oculta') not in ('boolean', 'null') then return 'roteiro_invalido'; end if;
      if e ? 'trans' and jsonb_typeof(e->'trans') <> 'null' and coalesce(e->>'trans', '') not in
         ('modelo', 'fade', 'deslizar', 'zoom', 'cortina', 'flash', 'corte', 'desfoque') then return 'roteiro_invalido'; end if;
    end loop;
  end if;

  if p_roteiro ? 'filtro' and jsonb_typeof(p_roteiro->'filtro') <> 'null' and coalesce(p_roteiro->>'filtro', '') not in
     ('nenhum', 'vivo', 'quente', 'frio', 'pb', 'cinema', 'suave') then return 'roteiro_invalido'; end if;
  if p_roteiro ? 'transicao' and jsonb_typeof(p_roteiro->'transicao') <> 'null' and coalesce(p_roteiro->>'transicao', '') not in
     ('modelo', 'fade', 'deslizar', 'zoom', 'cortina', 'flash', 'corte', 'desfoque') then return 'roteiro_invalido'; end if;
  if p_roteiro ? 'textoEstilo' and jsonb_typeof(p_roteiro->'textoEstilo') <> 'null' and coalesce(p_roteiro->>'textoEstilo', '') not in
     ('legenda', 'destaque', 'caixa') then return 'roteiro_invalido'; end if;

  if p_roteiro ? 'encerramento' and jsonb_typeof(p_roteiro->'encerramento') <> 'null' then
    e := p_roteiro->'encerramento';
    if jsonb_typeof(e) <> 'object' then return 'roteiro_invalido'; end if;
    for k in select jsonb_object_keys(e) loop
      if k not in ('estilo', 'qr', 'link') then return 'roteiro_invalido'; end if;
    end loop;
    if e ? 'estilo' and coalesce(e->>'estilo', '') not in ('cartao', 'whatsapp', 'contato', 'logo', 'nenhum') then return 'roteiro_invalido'; end if;
    if (e ? 'qr' and jsonb_typeof(e->'qr') not in ('boolean', 'null'))
       or (e ? 'link' and jsonb_typeof(e->'link') not in ('boolean', 'null')) then return 'roteiro_invalido'; end if;
  end if;

  if p_roteiro ? 'musica' and jsonb_typeof(p_roteiro->'musica') <> 'null' then
    e := p_roteiro->'musica';
    if jsonb_typeof(e) <> 'object' then return 'roteiro_invalido'; end if;
    for k in select jsonb_object_keys(e) loop
      if k not in ('volume', 'inicio', 'abaixar', 'nome') then return 'roteiro_invalido'; end if;
    end loop;
    if not private.studio_num_ok(e->'volume', 0, 1) or not private.studio_num_ok(e->'inicio', 0, 3600) then return 'roteiro_invalido'; end if;
    if not private.studio_txt_ok(e->'nome', 80) then return 'texto_invalido'; end if;
    if e ? 'abaixar' and jsonb_typeof(e->'abaixar') not in ('boolean', 'null') then return 'roteiro_invalido'; end if;
  end if;
  return 'ok';
end $$;
revoke all on function private.studio_roteiro_valido(jsonb, jsonb, jsonb) from public, anon, authenticated;

-- a assinatura antiga continua existindo (quem chamar com 2 argumentos)
create or replace function private.studio_roteiro_valido(p_roteiro jsonb, p_fotos jsonb) returns text
language sql immutable set search_path = public, pg_temp as $$
  select private.studio_roteiro_valido(p_roteiro, p_fotos, '[]'::jsonb);
$$;
revoke all on function private.studio_roteiro_valido(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.studio_fontes() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_prof uuid := auth.uid();
  v_p    record;
begin
  if v_prof is null then return jsonb_build_object('ok', false, 'error', 'nao_autenticado'); end if;
  select id, name, profissao, city, uf, slug, logo_url, is_public, portfolio_publico, niche, whatsapp, instagram
    into v_p from public.professionals where id = v_prof;
  if not found then return jsonb_build_object('ok', false, 'error', 'perfil_nao_encontrado'); end if;

  return jsonb_build_object(
    'ok', true,
    'perfil', jsonb_build_object('id', v_p.id, 'nome', v_p.name, 'profissao', v_p.profissao, 'cidade', v_p.city,
                                 'uf', v_p.uf, 'slug', v_p.slug, 'foto', v_p.logo_url, 'publico', v_p.is_public,
                                 'portfolio_publico', coalesce(v_p.portfolio_publico, false), 'nicho', v_p.niche,
                                 'whatsapp', v_p.whatsapp, 'instagram', v_p.instagram),
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
          'videos', case when private.studio_report_elegivel(v_prof, r.id) = 'ok' then coalesce(r.videos, '[]'::jsonb) else '[]'::jsonb end,
          'total_fotos', jsonb_array_length(coalesce(r.photos, '[]'::jsonb)),
          'total_videos', jsonb_array_length(coalesce(r.videos, '[]'::jsonb)),
          'avaliacao', (select jsonb_build_object('nota', a.nota, 'comentario', left(a.comentario, 180),
                                                  'autor', coalesce(nullif(a.nome_avaliador_curto, ''), 'Cliente'))
                          from public.avaliacoes a
                         where a.report_id = r.id and r.is_public and a.nota between 1 and 5
                         order by a.created_at desc limit 1)
        ) as s
        from public.reports r
        where r.professional_id = v_prof and r.tipo = 'servico' and r.arquivado_em is null
          and (jsonb_array_length(coalesce(r.photos, '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(r.videos, '[]'::jsonb)) > 0)
        order by coalesce(r.service_date, r.created_at::date) desc
        limit 60
      ) x), '[]'::jsonb)
  );
end $$;
revoke all on function public.studio_fontes() from public, anon;
grant execute on function public.studio_fontes() to authenticated;

create or replace function public.studio_salvar(p_id uuid, p_report_id uuid, p_modelo text, p_trilha text,
                                                p_roteiro jsonb, p_marca boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prof   uuid := auth.uid();
  v_pro    boolean;
  v_sit    text;
  v_fotos  jsonb;
  v_videos jsonb;
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
  if coalesce(p_trilha, '') !~ '^[a-z0-9_]{2,32}$' then return jsonb_build_object('ok', false, 'error', 'trilha_invalida'); end if;
  if not v_pro and p_modelo <> 'classico' then return jsonb_build_object('ok', false, 'error', 'pro_necessario'); end if;
  if not v_pro and coalesce(p_marca, true) = false then return jsonb_build_object('ok', false, 'error', 'pro_necessario'); end if;
  if not v_pro and p_roteiro ? 'acento' and jsonb_typeof(p_roteiro->'acento') <> 'null' then
    return jsonb_build_object('ok', false, 'error', 'pro_necessario');
  end if;

  select photos, videos into v_fotos, v_videos from public.reports where id = p_report_id;
  v_val := private.studio_roteiro_valido(p_roteiro, v_fotos, v_videos);
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
  if not exists (select 1 from public.professionals where id = v_prof and is_public and coalesce(slug, '') <> '') then
    return jsonb_build_object('ok', false, 'error', 'perfil_privado');
  end if;
  if private.studio_roteiro_valido(v.roteiro, (select photos from public.reports where id = v.report_id),
                                   (select videos from public.reports where id = v.report_id)) <> 'ok' then
    return jsonb_build_object('ok', false, 'error', 'foto_fora_do_servico');
  end if;

  v_pro := private.is_pro(v_prof);
  if not v_pro and (v.modelo <> 'classico' or not v.marca) then
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
