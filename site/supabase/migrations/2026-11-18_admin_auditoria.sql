-- Fieldo · v12.40 · auditoria das ações do administrador (18/11/2026)
--
-- O painel unificado dá ao dono autonomia total sobre os cadastros: editar
-- qualquer campo, mudar o login, bloquear acesso e excluir. Com esse poder,
-- cada ação fica registrada aqui com o ANTES e o DEPOIS — para desfazer um
-- engano e para responder a um titular de dados (LGPD, art. 37) quem mudou
-- o quê e quando.
--
-- Só a Edge Function admin-cadastros escreve (conexão direta, sessão de
-- administrador). Ninguém pela API lê nem escreve: RLS ligada e sem
-- policy, e sem grant para anon/authenticated. Só inserção.

create table if not exists public.admin_auditoria (
  id      bigint generated always as identity primary key,
  quando  timestamptz not null default now(),
  acao    text not null check (acao in ('editar', 'login', 'excluir')),
  alvo    uuid not null,                 -- id da conta (sem FK: o registro sobrevive à exclusão)
  tabela  text,
  antes   jsonb,
  depois  jsonb
);
create index if not exists admin_auditoria_alvo_idx on public.admin_auditoria (alvo, quando desc);

alter table public.admin_auditoria enable row level security;
revoke all on public.admin_auditoria from anon, authenticated;

create or replace function public._admin_auditoria_so_insercao() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'auditoria_imutavel' using errcode = 'P0001';
end $$;
revoke all on function public._admin_auditoria_so_insercao() from public, anon, authenticated;

drop trigger if exists admin_auditoria_imutavel on public.admin_auditoria;
create trigger admin_auditoria_imutavel before update or delete on public.admin_auditoria
  for each row execute function public._admin_auditoria_so_insercao();
