-- Fieldo Locação · v12.19 · aprovado pelo dono em 30/10 (auditoria de UX da Locação)
--
-- 1. locadoras.responsavel — "Nome do responsável" no Meu perfil. Entra no
--    contrato como o representante que assina pela locadora, em vez de ser
--    redigitado em todo contrato.
-- 2. Fecha a brecha: a locadora conseguia alterar o próprio plano e o
--    vencimento (grant de UPDATE em plan e plan_expires_at). Nada na Locação
--    usa o plano hoje; a correção vem antes de existir cobrança.
--
-- Nenhum dado existente é alterado. Contratos já criados não mudam: o
-- snapshot só é lido ao criar um contrato novo ou ao "Atualizar com a locação".

alter table public.locadoras add column if not exists responsavel text
  check (responsavel is null or char_length(responsavel) <= 120);

-- authenticated tinha INSERT e UPDATE na TABELA inteira; revogar só as duas
-- colunas não teria efeito. Troca pelo mesmo acesso, coluna a coluna, sem
-- plan e plan_expires_at. SELECT (tabela inteira) continua como estava; a
-- RLS segue limitando cada locadora à própria linha.
-- anon (vitrine pública) NÃO recebe select em responsavel: é dado do contrato.
revoke insert, update on public.locadoras from authenticated;
grant insert (id, nome, razao_social, cnpj, slug, city, city_slug, uf, endereco, whatsapp, phone, email,
              bio, logo_url, instagram, pix_key, pix_tipo, horario, entrega, raio_entrega_km, is_public,
              responsavel, created_at, updated_at)
  on public.locadoras to authenticated;
grant update (nome, razao_social, cnpj, slug, city, city_slug, uf, endereco, whatsapp, phone, email,
              bio, logo_url, instagram, pix_key, pix_tipo, horario, entrega, raio_entrega_km, is_public,
              responsavel, updated_at)
  on public.locadoras to authenticated;

-- Snapshot do contrato: representante = locadoras.responsavel
create or replace function public._loc_snapshot(p_locacao_id uuid, p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  l public.locacoes; d public.locadoras; v_itens jsonb; v_dias int;
begin
  select * into l from public.locacoes where id = p_locacao_id and locadora_id = p_uid;
  if not found then return jsonb_build_object('erro', 'locacao_nao_encontrada'); end if;
  select * into d from public.locadoras where id = p_uid;
  if not found then return jsonb_build_object('erro', 'locadora_nao_encontrada'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'equipamento_id', i.equipamento_id, 'nome', e.nome, 'marca', e.marca, 'modelo', e.modelo,
           'quantidade', i.quantidade, 'preco_dia', i.preco_dia_aplicado, 'subtotal', i.subtotal
         ) order by i.created_at, i.id), '[]'::jsonb)
    into v_itens
    from public.locacao_itens i
    left join public.equipamentos e on e.id = i.equipamento_id
   where i.locacao_id = l.id;
  if jsonb_array_length(v_itens) = 0 then return jsonb_build_object('erro', 'locacao_sem_itens'); end if;

  v_dias := greatest(1, coalesce(l.data_prevista_devolucao - l.data_saida, 1));

  return jsonb_build_object(
    'origem_hash', md5(concat_ws('|', l.client_name, l.client_doc, l.client_phone, l.client_email,
                       l.data_saida::text, l.data_prevista_devolucao::text,
                       l.valor_total::text, l.caucao_valor::text, l.entrega_endereco, v_itens::text)),
    'dados', jsonb_build_object(
      'locadora', jsonb_build_object(
        'nome', d.nome, 'razao_social', coalesce(d.razao_social, d.nome), 'documento', d.cnpj,
        'endereco', d.endereco, 'cidade', d.city, 'uf', d.uf, 'email', d.email,
        'whatsapp', d.whatsapp, 'representante', nullif(btrim(d.responsavel), '')),
      'cliente', jsonb_build_object(
        'nome', l.client_name, 'documento', l.client_doc, 'telefone', l.client_phone,
        'email', l.client_email, 'endereco', null),
      'locacao', jsonb_build_object(
        'data_saida', l.data_saida, 'data_prevista_devolucao', l.data_prevista_devolucao,
        'diarias', v_dias, 'valor_total', l.valor_total, 'caucao_valor', l.caucao_valor,
        'entrega_endereco', l.entrega_endereco, 'observacoes', l.observacoes),
      'itens', v_itens,
      'condicoes', jsonb_build_object(
        'foro', null, 'forma_pagamento', null, 'multa_atraso', null,
        'tolerancia_devolucao', null, 'local_devolucao', null, 'cancelamento', null)
    )
  );
end $$;

-- Resync: mantém o que a pessoa digitou no rascunho; se ela não digitou
-- nada, usa o que veio do perfil (antes, um null antigo apagava o novo).
create or replace function public._loc_resync(p_antigo jsonb, p_locacao_id uuid, p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_snap jsonb; v_new jsonb;
begin
  v_snap := public._loc_snapshot(p_locacao_id, p_uid);
  if v_snap ? 'erro' then return v_snap; end if;
  v_new := v_snap -> 'dados';
  v_new := jsonb_set(v_new, '{condicoes}', coalesce(p_antigo -> 'condicoes', v_new -> 'condicoes'));
  v_new := jsonb_set(v_new, '{cliente,endereco}', coalesce(p_antigo #> '{cliente,endereco}', 'null'::jsonb));
  if jsonb_typeof(p_antigo #> '{locadora,representante}') = 'string' then
    v_new := jsonb_set(v_new, '{locadora,representante}', p_antigo #> '{locadora,representante}');
  end if;
  return jsonb_build_object('dados', v_new, 'origem_hash', v_snap ->> 'origem_hash');
end $$;
