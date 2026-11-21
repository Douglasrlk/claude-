-- Fieldo · baseline extraída do catálogo de produção (projeto jrsctnncoljdcvdofxsg, PG 17)
-- Gerado em 2026-11-21. NÃO editar à mão: regenerar a partir do banco.
-- Parte: RLS e policies

ALTER TABLE public.aceites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asaas_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_usage_locadora ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avaliacoes ENABLE ROW LEVEL SECURITY; ALTER TABLE public.avaliacoes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.budget_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY; ALTER TABLE public.budgets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.change_file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE gestao.companies ENABLE ROW LEVEL SECURITY; ALTER TABLE gestao.companies FORCE ROW LEVEL SECURITY;
ALTER TABLE gestao.company_users ENABLE ROW LEVEL SECURITY; ALTER TABLE gestao.company_users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.condo_condominios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.condo_manutencoes_recorrentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.condo_servicos_contratados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.condo_sindicos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.council_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.council_opinions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.council_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_hashes ENABLE ROW LEVEL SECURITY; ALTER TABLE public.document_hashes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.empreitadas ENABLE ROW LEVEL SECURITY; ALTER TABLE public.empreitadas FORCE ROW LEVEL SECURITY;
ALTER TABLE public.empreiteiros ENABLE ROW LEVEL SECURITY; ALTER TABLE public.empreiteiros FORCE ROW LEVEL SECURITY;
ALTER TABLE public.equipamento_categorias ENABLE ROW LEVEL SECURITY; ALTER TABLE public.equipamento_categorias FORCE ROW LEVEL SECURITY;
ALTER TABLE public.equipamentos ENABLE ROW LEVEL SECURITY; ALTER TABLE public.equipamentos FORCE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impact_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrity_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrity_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_redemptions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.license_redemptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.loc_contrato_assinaturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loc_contrato_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loc_contrato_modelos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loc_contratos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_contratos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_itens ENABLE ROW LEVEL SECURITY; ALTER TABLE public.locacao_itens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_laudos ENABLE ROW LEVEL SECURITY; ALTER TABLE public.locacao_laudos FORCE ROW LEVEL SECURITY;
ALTER TABLE public.locacoes ENABLE ROW LEVEL SECURITY; ALTER TABLE public.locacoes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.locadoras ENABLE ROW LEVEL SECURITY; ALTER TABLE public.locadoras FORCE ROW LEVEL SECURITY;
ALTER TABLE public.materiais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_listas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_precos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_rate_limit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.midia_cotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.midia_uso ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.obra_contrato_assinaturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.obra_contrato_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.obra_contratos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.obras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos_titular ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_slug_antigos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY; ALTER TABLE public.professionals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.project_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros_acesso ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY; ALTER TABLE public.reports FORCE ROW LEVEL SECURITY;
ALTER TABLE public.signup_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshot_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshot_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshot_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_entries ENABLE ROW LEVEL SECURITY; ALTER TABLE public.work_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY comp_select ON gestao.companies AS PERMISSIVE FOR SELECT TO authenticated USING ((id IN ( SELECT private.gestao_company_ids() AS gestao_company_ids)));
CREATE POLICY comp_update ON gestao.companies AS PERMISSIVE FOR UPDATE TO authenticated USING (private.gestao_is_admin(id)) WITH CHECK (private.gestao_is_admin(id));
CREATE POLICY cu_select ON gestao.company_users AS PERMISSIVE FOR SELECT TO authenticated USING ((company_id IN ( SELECT private.gestao_company_ids() AS gestao_company_ids)));
CREATE POLICY aceites_select_own ON public.aceites AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY analytics_insert_publico ON public.analytics_events AS PERMISSIVE FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY assinatura_select_own ON public.assinaturas AS PERMISSIVE FOR SELECT TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY aval_responder ON public.avaliacoes AS PERMISSIVE FOR UPDATE TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY aval_select_own ON public.avaliacoes AS PERMISSIVE FOR SELECT TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY aval_select_publico ON public.avaliacoes AS PERMISSIVE FOR SELECT TO anon USING ((EXISTS ( SELECT 1
   FROM reports r
  WHERE ((r.id = avaliacoes.report_id) AND r.is_public AND (r.tipo = 'servico'::text)))));
CREATE POLICY bud_delete ON public.budgets AS PERMISSIVE FOR DELETE TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY bud_insert ON public.budgets AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY bud_select_own ON public.budgets AS PERMISSIVE FOR SELECT TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY bud_update ON public.budgets AS PERMISSIVE FOR UPDATE TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY condominio_all_own ON public.condo_condominios AS PERMISSIVE FOR ALL TO public USING ((sindico_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((sindico_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY manutencao_all_own ON public.condo_manutencoes_recorrentes AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM condo_condominios c
  WHERE ((c.id = condo_manutencoes_recorrentes.condominio_id) AND (c.sindico_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM condo_condominios c
  WHERE ((c.id = condo_manutencoes_recorrentes.condominio_id) AND (c.sindico_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY servico_all_own ON public.condo_servicos_contratados AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM condo_condominios c
  WHERE ((c.id = condo_servicos_contratados.condominio_id) AND (c.sindico_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM condo_condominios c
  WHERE ((c.id = condo_servicos_contratados.condominio_id) AND (c.sindico_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY sindico_all_own ON public.condo_sindicos AS PERMISSIVE FOR ALL TO public USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY hash_all_own ON public.document_hashes AS PERMISSIVE FOR ALL TO authenticated USING ((COALESCE(professional_id, locadora_id) = ( SELECT auth.uid() AS uid))) WITH CHECK ((COALESCE(professional_id, locadora_id) = ( SELECT auth.uid() AS uid)));
CREATE POLICY hash_select ON public.document_hashes AS PERMISSIVE FOR SELECT TO anon USING (true);
CREATE POLICY obra_delete ON public.empreitadas AS PERMISSIVE FOR DELETE TO authenticated USING (((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro)));
CREATE POLICY obra_insert ON public.empreitadas AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro)));
CREATE POLICY obra_select ON public.empreitadas AS PERMISSIVE FOR SELECT TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY obra_update ON public.empreitadas AS PERMISSIVE FOR UPDATE TO authenticated USING (((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro))) WITH CHECK ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY emp_delete ON public.empreiteiros AS PERMISSIVE FOR DELETE TO authenticated USING (((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro)));
CREATE POLICY emp_insert ON public.empreiteiros AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro)));
CREATE POLICY emp_select ON public.empreiteiros AS PERMISSIVE FOR SELECT TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY emp_update ON public.empreiteiros AS PERMISSIVE FOR UPDATE TO authenticated USING (((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro))) WITH CHECK ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY cat_select_public ON public.equipamento_categorias AS PERMISSIVE FOR SELECT TO anon, authenticated USING (aprovada);
CREATE POLICY equip_delete_own ON public.equipamentos AS PERMISSIVE FOR DELETE TO authenticated USING ((locadora_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY equip_insert_own ON public.equipamentos AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((locadora_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY equip_select_own ON public.equipamentos AS PERMISSIVE FOR SELECT TO authenticated USING ((locadora_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY equip_select_public ON public.equipamentos AS PERMISSIVE FOR SELECT TO anon, authenticated USING ((is_public AND ativo AND (EXISTS ( SELECT 1
   FROM locadoras l
  WHERE ((l.id = equipamentos.locadora_id) AND l.is_public)))));
CREATE POLICY equip_update_own ON public.equipamentos AS PERMISSIVE FOR UPDATE TO authenticated USING ((locadora_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((locadora_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY funnel_insert_publico ON public.funnel_events AS PERMISSIVE FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY impact_events_select_owner ON public.impact_events AS PERMISSIVE FOR SELECT TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY loc_assinaturas_select_own ON public.loc_contrato_assinaturas AS PERMISSIVE FOR SELECT TO authenticated USING ((locadora_id = auth.uid()));
CREATE POLICY loc_eventos_select_own ON public.loc_contrato_eventos AS PERMISSIVE FOR SELECT TO authenticated USING ((locadora_id = auth.uid()));
CREATE POLICY loc_modelos_select_own ON public.loc_contrato_modelos AS PERMISSIVE FOR SELECT TO authenticated USING ((locadora_id = auth.uid()));
CREATE POLICY loc_contratos_select_own ON public.loc_contratos AS PERMISSIVE FOR SELECT TO authenticated USING ((locadora_id = auth.uid()));
CREATE POLICY contrato_select_own ON public.locacao_contratos AS PERMISSIVE FOR SELECT TO authenticated USING ((locadora_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY item_all_own ON public.locacao_itens AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM locacoes l
  WHERE ((l.id = locacao_itens.locacao_id) AND (l.locadora_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM locacoes l
  WHERE ((l.id = locacao_itens.locacao_id) AND (l.locadora_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY laudo_all_own ON public.locacao_laudos AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM (locacao_itens i
     JOIN locacoes l ON ((l.id = i.locacao_id)))
  WHERE ((i.id = locacao_laudos.locacao_item_id) AND (l.locadora_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (locacao_itens i
     JOIN locacoes l ON ((l.id = i.locacao_id)))
  WHERE ((i.id = locacao_laudos.locacao_item_id) AND (l.locadora_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY loc_delete_own ON public.locacoes AS PERMISSIVE FOR DELETE TO authenticated USING ((locadora_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY loc_insert_own ON public.locacoes AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((locadora_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY loc_select_own ON public.locacoes AS PERMISSIVE FOR SELECT TO authenticated USING ((locadora_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY loc_update_own ON public.locacoes AS PERMISSIVE FOR UPDATE TO authenticated USING ((locadora_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((locadora_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY locadora_insert_self ON public.locadoras AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY locadora_select_own ON public.locadoras AS PERMISSIVE FOR SELECT TO authenticated USING ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY locadora_select_public ON public.locadoras AS PERMISSIVE FOR SELECT TO anon USING (is_public);
CREATE POLICY locadora_update_own ON public.locadoras AS PERMISSIVE FOR UPDATE TO authenticated USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY mat_select ON public.materiais AS PERMISSIVE FOR SELECT TO anon, authenticated USING (aprovada);
CREATE POLICY lista_own ON public.material_listas AS PERMISSIVE FOR ALL TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY preco_own ON public.material_precos AS PERMISSIVE FOR ALL TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY mcp_keys_delete_own ON public.mcp_api_keys AS PERMISSIVE FOR DELETE TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY mcp_keys_select_own ON public.mcp_api_keys AS PERMISSIVE FOR SELECT TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY midia_uso_select_own ON public.midia_uso AS PERMISSIVE FOR SELECT TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY notificacoes_marcar_lida ON public.notificacoes AS PERMISSIVE FOR UPDATE TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY notificacoes_select_own ON public.notificacoes AS PERMISSIVE FOR SELECT TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY obra_assinaturas_select_own ON public.obra_contrato_assinaturas AS PERMISSIVE FOR SELECT TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY obra_eventos_select_own ON public.obra_contrato_eventos AS PERMISSIVE FOR SELECT TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY obra_contratos_select_own ON public.obra_contratos AS PERMISSIVE FOR SELECT TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY obras_delete_own ON public.obras AS PERMISSIVE FOR DELETE TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY obras_insert_own ON public.obras AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY obras_select_own ON public.obras AS PERMISSIVE FOR SELECT TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY obras_update_own ON public.obras AS PERMISSIVE FOR UPDATE TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY pedidos_select_own ON public.pedidos_titular AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY prof_insert ON public.professionals AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY prof_select_own ON public.professionals AS PERMISSIVE FOR SELECT TO authenticated USING ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY prof_select_publico ON public.professionals AS PERMISSIVE FOR SELECT TO anon USING ((is_public OR (EXISTS ( SELECT 1
   FROM reports r
  WHERE ((r.professional_id = professionals.id) AND r.is_public)))));
CREATE POLICY prof_update ON public.professionals AS PERMISSIVE FOR UPDATE TO authenticated USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY rep_delete ON public.reports AS PERMISSIVE FOR DELETE TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY rep_insert ON public.reports AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY rep_select_own ON public.reports AS PERMISSIVE FOR SELECT TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY rep_select_publico ON public.reports AS PERMISSIVE FOR SELECT TO anon USING (is_public);
CREATE POLICY rep_update ON public.reports AS PERMISSIVE FOR UPDATE TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY studio_videos_delete_own ON public.studio_videos AS PERMISSIVE FOR DELETE TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY studio_videos_select_own ON public.studio_videos AS PERMISSIVE FOR SELECT TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY we_delete ON public.work_entries AS PERMISSIVE FOR DELETE TO authenticated USING (((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro)));
CREATE POLICY we_insert ON public.work_entries AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro)));
CREATE POLICY we_select ON public.work_entries AS PERMISSIVE FOR SELECT TO authenticated USING ((professional_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY we_update ON public.work_entries AS PERMISSIVE FOR UPDATE TO authenticated USING (((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro))) WITH CHECK ((professional_id = ( SELECT auth.uid() AS uid)));
