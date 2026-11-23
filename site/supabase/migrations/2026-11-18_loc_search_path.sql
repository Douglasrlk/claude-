-- Fieldo · v12.40 · search_path fixo nas 13 funções auxiliares da Locação
--
-- Advisor do Supabase (lint 0011, function_search_path_mutable). Nenhuma é
-- SECURITY DEFINER e todas já qualificam o schema (public./extensions.),
-- então o comportamento não muda — só fecha a porta para um search_path
-- alterado por sessão.

alter function public._loc_somente_insercao()                         set search_path = public, extensions, pg_temp;
alter function public._loc_err(text, jsonb)                           set search_path = public, extensions, pg_temp;
alter function public._loc_cnpj_valido(text)                          set search_path = public, extensions, pg_temp;
alter function public._loc_merge_edicao(jsonb, jsonb)                 set search_path = public, extensions, pg_temp;
alter function public._loc_doc_valido(text)                           set search_path = public, extensions, pg_temp;
alter function public._loc_png_valido(text)                           set search_path = public, extensions, pg_temp;
alter function public._loc_evento(uuid, uuid, text, text, jsonb)      set search_path = public, extensions, pg_temp;
alter function public._loc_sha256(text)                               set search_path = public, extensions, pg_temp;
alter function public._loc_ip()                                       set search_path = public, extensions, pg_temp;
alter function public._loc_digits(text)                               set search_path = public, extensions, pg_temp;
alter function public._loc_valida_clausulas(jsonb)                    set search_path = public, extensions, pg_temp;
alter function public._loc_cpf_valido(text)                           set search_path = public, extensions, pg_temp;
alter function public._loc_contratos_guard()                          set search_path = public, extensions, pg_temp;
