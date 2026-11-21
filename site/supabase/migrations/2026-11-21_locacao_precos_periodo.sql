-- Fieldo · v12.42 · Locação por período (diária, semanal, quinzenal, mensal)
--
-- Pedido do dono (21/11): locação não é só por diária. A locadora define,
-- por equipamento, o preço da diária, da semana (7 dias), da quinzena
-- (15 dias) e do mês (30 dias) — usa os que quiser. O valor da locação
-- passa a ser a combinação MAIS BARATA desses períodos que cobre as datas
-- (regra única em locacao/precos.js; cópia no assistente).
--
-- O que muda aqui:
--   1. equipamentos.preco_quinzena (semana e mês já existiam).
--      GRANT de SELECT para o anon: ele tem grant em TODAS as colunas de
--      equipamentos e a vitrine pública usa select=*. Uma coluna nova sem
--      grant faria essa consulta falhar com "permission denied".
--   2. locacao_itens.cobranca (jsonb): a composição aplicada e a tabela de
--      preços da época, ex.:
--        {"v":1,"dias":10,"cobre":10,"unitario":640,
--         "periodos":[{"chave":"semana","qtd":1,"preco":400},{"chave":"dia","qtd":3,"preco":80}],
--         "tabela":{"dia":80,"semana":400}}
--      preco_dia_aplicado continua sendo gravado (contratos e telas antigas).
--   3. _loc_snapshot leva a cobrança de cada item para o contrato. Só
--      acrescenta a chave quando ela existe: itens antigos geram o MESMO
--      JSON de antes, e o origem_hash dos rascunhos já abertos não muda.
--
-- Idempotente: pode rodar de novo sem efeito.

alter table public.equipamentos add column if not exists preco_quinzena numeric(10,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'equipamentos_preco_quinzena_check') then
    alter table public.equipamentos
      add constraint equipamentos_preco_quinzena_check check (preco_quinzena >= 0);
  end if;
end $$;

grant select (preco_quinzena) on public.equipamentos to anon;

alter table public.locacao_itens add column if not exists cobranca jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'locacao_itens_cobranca_ck') then
    alter table public.locacao_itens
      add constraint locacao_itens_cobranca_ck check (
        cobranca is null
        or (jsonb_typeof(cobranca) = 'object' and pg_column_size(cobranca) <= 4000)
      );
  end if;
end $$;

create or replace function public._loc_snapshot(p_locacao_id uuid, p_uid uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  l public.locacoes; d public.locadoras; v_itens jsonb; v_dias int;
begin
  select * into l from public.locacoes where id = p_locacao_id and locadora_id = p_uid;
  if not found then return jsonb_build_object('erro', 'locacao_nao_encontrada'); end if;
  select * into d from public.locadoras where id = p_uid;
  if not found then return jsonb_build_object('erro', 'locadora_nao_encontrada'); end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'equipamento_id', i.equipamento_id, 'nome', e.nome, 'marca', e.marca, 'modelo', e.modelo,
             'quantidade', i.quantidade, 'preco_dia', i.preco_dia_aplicado, 'subtotal', i.subtotal
           ) || case when i.cobranca is not null then jsonb_build_object('cobranca', i.cobranca) else '{}'::jsonb end
           order by i.created_at, i.id), '[]'::jsonb)
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
end $function$;
