-- Fieldo · baseline extraída do catálogo de produção (projeto jrsctnncoljdcvdofxsg, PG 17)
-- Gerado em 2026-11-21. NÃO editar à mão: regenerar a partir do banco.
-- Parte: triggers

CREATE TRIGGER trg_aceites_imutavel BEFORE DELETE OR UPDATE ON public.aceites FOR EACH ROW EXECUTE FUNCTION private.aceites_imutavel();
CREATE TRIGGER admin_auditoria_imutavel BEFORE DELETE OR UPDATE ON public.admin_auditoria FOR EACH ROW EXECUTE FUNCTION _admin_auditoria_so_insercao();
CREATE TRIGGER trg_assinaturas_updated BEFORE UPDATE ON public.assinaturas FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_aval_nome_curto BEFORE INSERT OR UPDATE OF nome_avaliador ON public.avaliacoes FOR EACH ROW EXECUTE FUNCTION trg_avaliacoes_nome_curto();
CREATE TRIGGER trg_protege_avaliacoes AFTER DELETE ON public.avaliacoes REFERENCING OLD TABLE AS afetadas FOR EACH STATEMENT EXECUTE FUNCTION impedir_delete_total();
CREATE TRIGGER trg_resposta_aval BEFORE UPDATE ON public.avaliacoes FOR EACH ROW EXECUTE FUNCTION marcar_resposta_avaliacao();
CREATE TRIGGER trg_bud_updated BEFORE UPDATE ON public.budgets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_protege_budgets AFTER DELETE ON public.budgets REFERENCING OLD TABLE AS afetadas FOR EACH STATEMENT EXECUTE FUNCTION impedir_delete_total();
CREATE TRIGGER trg_gestao_companies_updated BEFORE UPDATE ON gestao.companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_gestao_company_users_updated BEFORE UPDATE ON gestao.company_users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_gestao_ultimo_owner BEFORE DELETE OR UPDATE ON gestao.company_users FOR EACH ROW EXECUTE FUNCTION gestao.tg_protege_ultimo_owner();
CREATE TRIGGER trg_selo_contrato_locacao BEFORE INSERT OR DELETE OR UPDATE ON public.document_hashes FOR EACH ROW EXECUTE FUNCTION trg_selo_contrato_locacao();
CREATE TRIGGER trg_equip BEFORE INSERT OR UPDATE ON public.equipamentos FOR EACH ROW EXECUTE FUNCTION trg_equipamentos();
CREATE TRIGGER trg_equip_pub AFTER INSERT OR DELETE OR UPDATE ON public.equipamentos FOR EACH ROW EXECUTE FUNCTION trg_equip_publica();
CREATE TRIGGER loc_assinaturas_no_update BEFORE UPDATE ON public.loc_contrato_assinaturas FOR EACH ROW EXECUTE FUNCTION _loc_somente_insercao();
CREATE TRIGGER loc_eventos_no_update BEFORE UPDATE ON public.loc_contrato_eventos FOR EACH ROW EXECUTE FUNCTION _loc_somente_insercao();
CREATE TRIGGER loc_contratos_guard BEFORE UPDATE ON public.loc_contratos FOR EACH ROW EXECUTE FUNCTION _loc_contratos_guard();
CREATE TRIGGER trg_locacao_contratos_imutavel BEFORE DELETE OR UPDATE ON public.locacao_contratos FOR EACH ROW EXECUTE FUNCTION trg_locacao_contratos_imutavel();
CREATE TRIGGER trg_loc BEFORE INSERT OR UPDATE ON public.locacoes FOR EACH ROW EXECUTE FUNCTION trg_locacoes();
CREATE TRIGGER trg_locadora BEFORE INSERT OR UPDATE ON public.locadoras FOR EACH ROW EXECUTE FUNCTION trg_locadoras();
CREATE TRIGGER trg_locadora_cidade BEFORE INSERT OR UPDATE OF city ON public.locadoras FOR EACH ROW EXECUTE FUNCTION trg_cidade();
CREATE TRIGGER trg_material_listas_updated BEFORE UPDATE ON public.material_listas FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER obra_assinaturas_no_update BEFORE UPDATE ON public.obra_contrato_assinaturas FOR EACH ROW EXECUTE FUNCTION _loc_somente_insercao();
CREATE TRIGGER obra_eventos_no_update BEFORE UPDATE ON public.obra_contrato_eventos FOR EACH ROW EXECUTE FUNCTION _loc_somente_insercao();
CREATE TRIGGER obra_contratos_guard BEFORE UPDATE ON public.obra_contratos FOR EACH ROW EXECUTE FUNCTION _oc_guard();
CREATE TRIGGER obras_touch BEFORE UPDATE ON public.obras FOR EACH ROW EXECUTE FUNCTION obras_touch();
CREATE TRIGGER trg_aceite_portfolio BEFORE UPDATE ON public.professionals FOR EACH ROW EXECUTE FUNCTION registrar_aceite_portfolio();
CREATE TRIGGER trg_bloquear_plano BEFORE UPDATE ON public.professionals FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao_plano();
CREATE TRIGGER trg_prof_cidade BEFORE INSERT OR UPDATE OF city ON public.professionals FOR EACH ROW EXECUTE FUNCTION trg_cidade();
CREATE TRIGGER trg_prof_cidades BEFORE INSERT OR UPDATE OF city, cidades_atendidas ON public.professionals FOR EACH ROW EXECUTE FUNCTION trg_prof_cidades();
CREATE TRIGGER trg_prof_nichos BEFORE INSERT OR UPDATE OF niche, outras_profissoes ON public.professionals FOR EACH ROW EXECUTE FUNCTION trg_prof_nichos();
CREATE TRIGGER trg_prof_slug BEFORE INSERT OR UPDATE OF name, profissao, city ON public.professionals FOR EACH ROW EXECUTE FUNCTION trg_professionals_slug();
CREATE TRIGGER trg_prof_slug_antigo BEFORE UPDATE OF slug ON public.professionals FOR EACH ROW EXECUTE FUNCTION trg_guardar_slug_antigo();
CREATE TRIGGER trg_prof_updated BEFORE UPDATE ON public.professionals FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sanear_insert_prof BEFORE INSERT ON public.professionals FOR EACH ROW EXECUTE FUNCTION sanear_insert_professional();
CREATE TRIGGER reports_obra_dono BEFORE INSERT OR UPDATE OF obra_id, professional_id ON public.reports FOR EACH ROW EXECUTE FUNCTION reports_obra_dono();
CREATE TRIGGER trg_ativar_perfil AFTER INSERT OR UPDATE OF is_public ON public.reports FOR EACH ROW EXECUTE FUNCTION ativar_perfil_publico();
CREATE TRIGGER trg_limite_reports_gratis BEFORE INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION limitar_reports_plano_gratis();
CREATE TRIGGER trg_protege_reports AFTER DELETE ON public.reports REFERENCING OLD TABLE AS afetadas FOR EACH STATEMENT EXECUTE FUNCTION impedir_delete_total();
CREATE TRIGGER trg_rep_cliente_curto BEFORE INSERT OR UPDATE OF client_name ON public.reports FOR EACH ROW EXECUTE FUNCTION trg_reports_cliente_curto();
CREATE TRIGGER trg_rep_titulo_publico BEFORE INSERT OR UPDATE OF service_description ON public.reports FOR EACH ROW EXECUTE FUNCTION trg_reports_titulo_publico();
CREATE TRIGGER trg_rep_updated BEFORE UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();
