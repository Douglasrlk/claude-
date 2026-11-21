-- Fieldo · defaults que chamam funções do próprio schema.
-- Só podem existir depois de 40_funcoes.sql (em produção a ordem foi outra,
-- e a baseline gerada do catálogo não carrega histórico de ordem).
ALTER TABLE public.change_requests ALTER COLUMN change_id SET DEFAULT public.next_change_id();
