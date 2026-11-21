-- ============================================================
-- Fieldo · v12.16 · Obras em andamento
-- ------------------------------------------------------------
-- Uma obra é só isto: cliente, o que é a obra e o valor total.
-- Não é contrato (sem cláusula, sem assinatura). Cada relatório
-- de serviço lançado na obra tem um valor, e esse valor desconta
-- do total. O cliente vê, em cada relatório, o total, as etapas
-- lançadas e quanto resta.
--
-- O saldo NÃO é guardado em coluna: é sempre a soma dos relatórios
-- da obra. Saldo guardado diverge na primeira edição ou exclusão
-- de relatório; soma não diverge nunca.
-- ============================================================

create table if not exists public.obras (
  id               uuid primary key default gen_random_uuid(),
  professional_id  uuid not null default auth.uid() references public.professionals(id) on delete cascade,
  cliente          text not null check (char_length(btrim(cliente)) between 1 and 120),
  titulo           text check (titulo is null or char_length(titulo) <= 120),
  cidade           text check (cidade is null or char_length(cidade) <= 80),
  valor_total      numeric(12,2) not null check (valor_total > 0 and valor_total < 100000000),
  status           text not null default 'andamento' check (status in ('andamento','concluida')),
  concluida_em     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists obras_prof_idx on public.obras (professional_id, status, created_at desc);

alter table public.obras enable row level security;
drop policy if exists obras_select_own on public.obras;
drop policy if exists obras_insert_own on public.obras;
drop policy if exists obras_update_own on public.obras;
drop policy if exists obras_delete_own on public.obras;
create policy obras_select_own on public.obras for select to authenticated using (professional_id = (select auth.uid()));
create policy obras_insert_own on public.obras for insert to authenticated with check (professional_id = (select auth.uid()));
create policy obras_update_own on public.obras for update to authenticated using (professional_id = (select auth.uid())) with check (professional_id = (select auth.uid()));
create policy obras_delete_own on public.obras for delete to authenticated using (professional_id = (select auth.uid()));
revoke all on public.obras from anon;
grant select, insert, update, delete on public.obras to authenticated;

create or replace function public.obras_touch() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists obras_touch on public.obras;
create trigger obras_touch before update on public.obras for each row execute function public.obras_touch();

-- O relatório pertence (opcionalmente) a uma obra. Apagar a obra solta
-- os relatórios, não os apaga: o histórico do serviço continua existindo.
alter table public.reports add column if not exists obra_id uuid references public.obras(id) on delete set null;
create index if not exists reports_obra_idx on public.reports (obra_id) where obra_id is not null;

-- O relatório só pode apontar para obra do MESMO profissional. Sem isto,
-- quem soubesse o id de uma obra alheia lançaria valores nela.
create or replace function public.reports_obra_dono() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.obra_id is not null and not exists (
    select 1 from public.obras o where o.id = new.obra_id and o.professional_id = new.professional_id
  ) then
    raise exception 'obra_invalida' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists reports_obra_dono on public.reports;
create trigger reports_obra_dono before insert or update of obra_id, professional_id on public.reports
  for each row execute function public.reports_obra_dono();

-- Permissões: `authenticated` tem privilégio de TABELA em reports, então
-- já lê e grava obra_id nos próprios relatórios (a RLS limita ao dono).
-- `anon` tem SELECT só em colunas listadas, e obra_id NÃO entra nelas:
-- o visitante do perfil público não descobre que o serviço é de uma obra
-- nem quanto ela vale. O cliente vê o resumo pela função abaixo.

-- ── Resumo da obra para o relatório ─────────────────────────────
-- Quem chama: o cliente (com o token do relatório que recebeu) ou o
-- próprio profissional (pelo id do relatório, logado). Devolve só o
-- necessário para a prestação de contas: título, valor total, e por
-- etapa a data, o título, o valor e se foi paga. Nada de foto, nada de
-- descrição completa, nada de outra obra.
create or replace function public.obra_resumo(p_token text default null, p_report_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r public.reports%rowtype;
  o public.obras%rowtype;
  itens jsonb;
  lancado numeric; pago numeric;
begin
  if p_token is not null and length(p_token) >= 16 then
    select * into r from public.reports where rating_token = p_token;
  elsif p_report_id is not null then
    select * into r from public.reports where id = p_report_id and professional_id = auth.uid();
  end if;
  if r.id is null or r.obra_id is null then return null; end if;
  select * into o from public.obras where id = r.obra_id;
  if o.id is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'data',   coalesce(x.service_date, x.created_at::date),
           'titulo', left(coalesce(nullif(btrim(split_part(coalesce(x.service_description,''), E'\n', 1)), ''), x.category_label, 'Etapa'), 90),
           'valor',  coalesce(x.valor, 0),
           'pago',   x.payment_status = 'pago',
           'este',   x.id = r.id
         ) order by coalesce(x.service_date, x.created_at::date), x.created_at), '[]'::jsonb),
         coalesce(sum(x.valor), 0),
         coalesce(sum(x.valor) filter (where x.payment_status = 'pago'), 0)
    into itens, lancado, pago
    from public.reports x
   where x.obra_id = o.id;  -- arquivar só esconde da lista; o valor continua contando

  return jsonb_build_object(
    'titulo', o.titulo, 'cliente', o.cliente, 'status', o.status,
    'valor_total', o.valor_total,
    'lancado', lancado, 'pago', pago,
    'restante', o.valor_total - lancado,
    'itens', itens
  );
end $$;
revoke all on function public.obra_resumo(text, uuid) from public;
grant execute on function public.obra_resumo(text, uuid) to anon, authenticated;
