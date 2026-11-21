-- Fieldo · v12.36 · apagar o backup de agosto (11/11/2026)
--
-- NÃO APLICADO. NÃO TEM VOLTA. Rodar só com aprovação explícita do dono.
--
-- O schema backup_v10_5 foi criado em 22/08/2026, antes de uma limpeza,
-- e guarda cópias completas de 7 tabelas: professionals (com e-mail,
-- telefone e chave Pix), reports (com nome do cliente, endereço e
-- valor), budgets, avaliacoes, document_hashes, assinaturas e
-- impact_events. Não tem RLS. O público não lê (o schema não está
-- exposto na API), mas é dado pessoal guardado sem finalidade há quase
-- 3 meses, e a LGPD (art. 15 e 16) pede o fim do tratamento quando a
-- finalidade acaba.
--
-- Antes de rodar: se quiser guardar uma cópia fora do Supabase, exporte
-- agora. Depois disto as cópias deixam de existir.

drop schema if exists backup_v10_5 cascade;
