-- Fieldo · baseline extraída do catálogo de produção (projeto jrsctnncoljdcvdofxsg, PG 17)
-- Gerado em 2026-11-21. NÃO editar à mão: regenerar a partir do banco.
-- Parte: comentários

COMMENT ON TABLE public.license_redemptions IS 'Resgate de licenças. RLS ligada SEM policy de propósito: invisível para anon e authenticated; apenas a Edge Function (service_role) acessa.';
COMMENT ON TABLE gestao.companies IS 'Empresa cliente do portal (condomínio, administradora, imobiliária).';
COMMENT ON TABLE gestao.company_users IS 'Vínculo usuário↔empresa + papel. NÃO contém credenciais (ver ADR-02).';
COMMENT ON TABLE public.signup_leads IS 'Captura de lead durante o cadastro (v7.6) — e-mail de quem começou
   mas pode não ter terminado. Sem policy de SELECT pública: só leitura
   via SQL editor / service role.';
COMMENT ON TABLE public.assinaturas IS 'Vinculo professional <-> assinatura Asaas. Escrita SO pela Edge Function (service_role); o dono apenas le.';
COMMENT ON TABLE public.asaas_eventos IS 'Eventos ja processados do Asaas. Idempotencia — o Asaas entrega at-least-once.';
COMMENT ON TABLE public.materiais IS 'Catalogo curado de materiais. Leitura publica; escrita so por service_role.';
COMMENT ON TABLE public.material_precos IS 'Historico de preco POR PROFISSIONAL. E daqui que sai a estimativa. data vem do cliente: current_date no Postgres e UTC e erraria o dia no Brasil.';
COMMENT ON TABLE public.funnel_events IS 'Funil do cadastro (v10.6). Sem PII. form_visto = abriu o formulario; form_enviado = apertou criar perfil. Comparar com professionals criados no mesmo periodo da a taxa de conclusao.';
COMMENT ON TABLE public.analytics_events IS 'Funil de aquisicao site-wide. Insert-only para anon/authenticated; leitura so via Edge Function admin-analytics (service role).';
COMMENT ON TABLE public.integrity_checks IS 'Fase 1 do Integrity Agent: uma linha por URL por execução. Só a Edge Function integrity-check (via service_role) lê/escreve aqui.';
COMMENT ON TABLE public.integrity_incidents IS 'Fase 1 do Integrity Agent: um incidente por regressão detectada. Revisão humana marca reviewed=true.';
COMMENT ON TABLE public.change_requests IS 'Fase 2 (Version Manager): uma linha por Change ID. approved_by/approved_at só são preenchidos por ação humana explícita — nunca automaticamente.';
COMMENT ON TABLE public.change_file_versions IS 'Fase 2: uma linha por arquivo dentro de um Change ID. hash_before é sempre calculado a partir do arquivo AO VIVO em produção, nunca de cópia local.';
COMMENT ON TABLE public.change_tests IS 'Fase 2: resultado do Verification Agent por Change ID. Determinístico, sem IA na decisão PASS/FAIL.';
COMMENT ON TABLE public.budget_counters IS 'RFC-001 M5: contador atômico do número do orçamento, por profissional e ano. Nunca ler com count(*); usar _budget_next_number().';
COMMENT ON TABLE public.locacao_contratos IS 'Contratos de locação (v2.0). Conteúdo congelado em texto + SHA-256 no momento da emissão; aceite do cliente com segundo SHA-256. Imutável: só as RPCs emitir/aceitar/cancelar escrevem, e o trigger recusa qualquer alteração fora das transições emitido→aceito|cancelado|substituido e aceito→substituido.';
COMMENT ON TABLE public.aceites IS 'v12.36 · LGPD. Registro de aceite de Termos, Política e (se um dia existir) marketing. Só INSERT pela função registrar_aceite. O dono lê os próprios.';
COMMENT ON TABLE public.pedidos_titular IS 'v12.36 · LGPD art. 18 (acesso, correção, exclusão etc., resposta em 15 dias) e CDC art. 49 (tipo arrependimento: reembolso integral pedido em até 7 dias da contratação). Quem responde é o administrador, pelo SQL Editor ou por um painel com service role.';
COMMENT ON TABLE public.registros_acesso IS 'v12.36 · Marco Civil da Internet, art. 15. Conta, data/hora e IP de uso do app. Guardado por 6 meses. Só a função registrar_acesso escreve; ninguém lê pela API.';
