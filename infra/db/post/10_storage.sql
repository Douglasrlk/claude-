-- Fieldo · baseline extraída do catálogo de produção (projeto jrsctnncoljdcvdofxsg, PG 17)
-- Gerado em 2026-11-21. NÃO editar à mão: regenerar a partir do banco.
-- Parte: storage: buckets e policies (roda DEPOIS do storage-api criar o schema)

-- Grants de tabela iguais aos de produção (o storage-api local não os cria
-- sozinho; sem eles nenhuma policy chega a ser avaliada).
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.buckets, storage.objects TO anon, authenticated;
GRANT ALL ON storage.buckets, storage.objects TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('avatars', 'avatars', true, 5242880, '{image/jpeg,image/png,image/webp}'::text[]) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('photos', 'photos', true, 5242880, '{image/jpeg,image/png,image/webp}'::text[]) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('version-manager', 'version-manager', false, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('project-snapshots', 'project-snapshots', false, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('loc-contratos', 'loc-contratos', false, 10485760, '{application/pdf}'::text[]) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('obra-contratos', 'obra-contratos', false, 10485760, '{application/pdf}'::text[]) ON CONFLICT (id) DO NOTHING;

CREATE POLICY av_write ON storage.objects AS PERMISSIVE FOR ALL TO authenticated USING (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))) WITH CHECK (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY loc_contratos_pdf_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'loc-contratos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY loc_contratos_pdf_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'loc-contratos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY obra_contratos_pdf_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'obra-contratos'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY obra_contratos_pdf_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'obra-contratos'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY ph_write ON storage.objects AS PERMISSIVE FOR ALL TO authenticated USING (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))) WITH CHECK (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
