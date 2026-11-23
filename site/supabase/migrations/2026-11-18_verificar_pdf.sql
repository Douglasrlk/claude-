-- Fieldo · v12.40 · verificar um PDF pelo arquivo inteiro (18/11/2026)
--
-- Pedido do dono: a página Verificar passa a aceitar o PDF. O navegador
-- calcula o SHA-256 dos BYTES do arquivo (o arquivo não sai do aparelho)
-- e pergunta aqui se ele é exatamente um PDF arquivado pelo Fieldo.
--
-- Hoje só o contrato de locação assinado tem o PDF final arquivado, com
-- o hash do arquivo em loc_contratos.pdf_hash (gravado por
-- loc_registrar_pdf quando a locadora arquiva). Relatório e orçamento
-- viram PDF pela impressão do navegador — cada impressão gera bytes
-- diferentes — e por isso são conferidos pelo código impresso neles
-- (verificar_hash), não por aqui.
--
-- Devolve o mesmo formato de verificar_hash, mais arquivo_identico=true.
-- SECURITY DEFINER pelo mesmo motivo de verificar_hash: quem tem o hash
-- (no caso, o próprio arquivo) pode conferir; ninguém lista nada.

create or replace function public.verificar_pdf(p_pdf_hash text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_hash text := lower(btrim(coalesce(p_pdf_hash, '')));
  c      public.loc_contratos%rowtype;
  v_doc  jsonb;
begin
  if v_hash !~ '^[0-9a-f]{64}$' then return null; end if;

  select * into c
    from public.loc_contratos
   where pdf_hash = v_hash and status <> 'rascunho'
   order by versao desc
   limit 1;
  if not found then return null; end if;

  v_doc := public.verificar_hash(c.documento_hash);
  if v_doc is null then return null; end if;

  return v_doc || jsonb_build_object('arquivo_identico', true, 'pdf_hash', c.pdf_hash);
end;
$function$;

revoke all on function public.verificar_pdf(text) from public;
grant execute on function public.verificar_pdf(text) to anon, authenticated;
