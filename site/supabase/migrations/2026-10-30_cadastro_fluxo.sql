-- Fieldo · v12.19e · auditoria do fluxo de cadastro (30/10, pedida pelo dono)
--
-- 1. funnel_events aceitava só form_visto e form_enviado. O cadastro grava
--    também 'cadastro_concluido' desde a fase 3 de instrumentação, e o banco
--    recusava em silêncio: o funil nunca mostrou quem terminou.
-- 2. Endereços antigos de perfil: quando o slug muda, o antigo fica guardado
--    e a página /p/<antigo> redireciona (301) para o novo. Primeiro uso: os
--    5 perfis "outro-caraguatatuba-…".

alter table public.funnel_events drop constraint if exists funnel_events_step_check;
alter table public.funnel_events add constraint funnel_events_step_check
  check (step = any (array['form_visto','form_enviado','cadastro_concluido']));

create table if not exists public.professional_slug_antigos (
  slug            text primary key,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  trocado_em      timestamptz not null default now()
);
alter table public.professional_slug_antigos enable row level security;
-- sem policies: ninguém lê a tabela direto; a consulta é pela função abaixo
revoke all on public.professional_slug_antigos from anon, authenticated;

create or replace function public.trg_guardar_slug_antigo() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.slug is not null and new.slug is distinct from old.slug then
    insert into public.professional_slug_antigos (slug, professional_id)
    values (old.slug, old.id)
    on conflict (slug) do update set professional_id = excluded.professional_id, trocado_em = now();
  end if;
  if new.slug is not null then
    delete from public.professional_slug_antigos where slug = new.slug;
  end if;
  return new;
end $$;

drop trigger if exists trg_prof_slug_antigo on public.professionals;
create trigger trg_prof_slug_antigo before update of slug on public.professionals
  for each row execute function public.trg_guardar_slug_antigo();

-- Para onde foi um endereço antigo. Só devolve o slug atual (nada além do
-- que a própria página pública já mostra).
create or replace function public.slug_atual(p_slug text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select p.slug
    from public.professional_slug_antigos a
    join public.professionals p on p.id = a.professional_id
   where a.slug = p_slug and p.slug is not null
   limit 1;
$$;
revoke all on function public.slug_atual(text) from public;
grant execute on function public.slug_atual(text) to anon, authenticated;
