-- ============================================================
-- Fieldo · v12.11 · Verificar também confere contratos de locação
-- ------------------------------------------------------------
-- O sistema novo de contratos (loc_contratos, ativado em 28/10)
-- guarda o SHA-256 do documento em loc_contratos.documento_hash e
-- em cada assinatura — e nunca em document_hashes. A verificar_hash
-- só olhava document_hashes: todo contrato novo, mesmo assinado
-- pelas duas partes, aparecia em /verificar como "não encontrado".
--
-- Agora: primeiro document_hashes (como sempre); se não achar,
-- loc_contratos. Devolve só o que serve para conferir — número,
-- versão, situação, nome da locadora, nome curto do cliente e as
-- datas das assinaturas. Nada de CPF, endereço ou valores.
-- ============================================================

create or replace function public.verificar_hash(p_hash text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  d public.document_hashes%rowtype;
  c public.loc_contratos%rowtype;
  v_resumo jsonb;
  v_hash text := lower(btrim(coalesce(p_hash, '')));
begin
  if v_hash = '' then
    return null;
  end if;

  select * into d from public.document_hashes where hash = v_hash;
  if found then
    v_resumo := d.conteudo_resumo;
    if v_resumo is not null and jsonb_typeof(v_resumo) = 'object' and v_resumo ? 'client' then
      v_resumo := jsonb_set(v_resumo, '{client}', to_jsonb(private.nome_curto(v_resumo->>'client')));
    end if;
    return jsonb_build_object(
      'hash',            d.hash,
      'tipo',            d.tipo,
      'ref_id',          d.ref_id,
      'created_at',      d.created_at,
      'conteudo_resumo', v_resumo
    );
  end if;

  -- v12.11 · contrato de locação do sistema novo
  select * into c from public.loc_contratos
   where documento_hash = v_hash and status <> 'rascunho'
   order by versao desc limit 1;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'hash',       c.documento_hash,
    'tipo',       'contrato_locacao_v2',
    'ref_id',     null,
    'created_at', coalesce(c.enviado_em, c.created_at),
    'conteudo_resumo', jsonb_build_object(
      'numero',       c.numero,
      'versao',       c.versao,
      'situacao',     c.status,
      'concluido_em', c.concluido_em,
      'locadora',     c.dados->'locadora'->>'nome',
      'client',       private.nome_curto(c.dados->'cliente'->>'nome'),
      'assinaturas',  coalesce((
        select jsonb_agg(jsonb_build_object('parte', a.parte, 'assinado_em', a.assinado_em) order by a.assinado_em)
          from public.loc_contrato_assinaturas a
         where a.contrato_id = c.id and a.documento_hash = c.documento_hash
      ), '[]'::jsonb),
      'versao_mais_nova', exists (
        select 1 from public.loc_contratos n
         where n.grupo_id = c.grupo_id and n.versao > c.versao and n.status <> 'rascunho'
      )
    )
  );
end $function$;

grant execute on function public.verificar_hash(text) to anon, authenticated;
