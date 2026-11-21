-- Fieldo · v12.19e · troca de endereço de 6 perfis (rodar UMA vez)
--
-- ORDEM OBRIGATÓRIA:
--   1. 2026-10-30_cadastro_fluxo.sql aplicado (cria o histórico e o gatilho)
--   2. fieldo-site-v12.19e publicado no Netlify (página que redireciona)
--   3. só então este arquivo
-- Fora dessa ordem, o link antigo que já circula no WhatsApp dá "não encontrado".
--
-- O gatilho trg_prof_slug_antigo guarda o endereço antigo sozinho; o
-- /p/<antigo> passa a responder 301 para o novo.
-- Cada linha confere id E endereço atual: se o dono já trocou, não mexe.

update public.professionals set slug = 'higienizacao-de-estofados-caraguatatuba-fci9'
 where id = '1dea9fec-a45c-4da0-9ed5-0a71e78c6265' and slug = 'outro-caraguatatuba-fci9';
update public.professionals set slug = 'pedreiro-caraguatatuba-y41t'
 where id = '81f141c5-fc8c-4fb1-8467-a9913075da26' and slug = 'alvenaria-caraguatatuba-y41t';
update public.professionals set slug = 'construtor-empreiteiro-caraguatatuba-l1r9'
 where id = 'a4980d16-be5d-4c66-80dc-1128f6aaa947' and slug = 'outro-caraguatatuba-l1r9';
update public.professionals set slug = 'empreiteiro-construtor-caraguatatuba-68ou'
 where id = '6c31564a-2698-44b8-97a0-6f90f98a9776' and slug = 'outro-caraguatatuba-68ou';
update public.professionals set slug = 'locador-aluguel-de-equipamentos-caraguatatuba-b9rm'
 where id = '521840d3-b18c-45d7-8bfd-e824a8379d7d' and slug = 'outro-caraguatatuba-b9rm';
update public.professionals set slug = 'artesao-caicara-caraguatatuba-gin2'
 where id = '460b1154-b97f-4d57-964e-48e2de36c12e' and slug = 'outro-caraguatatuba-gin2';

-- conferência: as 6 linhas devem voltar com o endereço novo
select a.slug as antigo, public.slug_atual(a.slug) as novo
  from public.professional_slug_antigos a order by a.trocado_em;
