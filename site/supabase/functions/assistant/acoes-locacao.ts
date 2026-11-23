// Fieldo · supabase/functions/assistant/acoes-locacao.ts
//
// v12.24 · o assistente na Locação (decisão do dono, 31/10: só no plano
// Pro, 50 mensagens por mês). Mesmo princípio de acoes.ts: toda ação é
// PostgREST/RPC com o JWT da própria locadora, e quem decide é a RLS e as
// funções loc_contrato_* do banco, exatamente como no painel.
//
// Regras de negócio copiadas de db.locacao.js (painel), de propósito
// iguais: diárias = diferença de dias, mínimo 1; valor pela tabela de
// períodos (diária/semana/quinzena/mês, combinação mais barata — precos.js,
// v12.42); reservada também ocupa
// estoque; atrasada ocupa até hoje; disponibilidade por período.
// O texto do contrato sai do MESMO módulo do painel (contrato-doc.js).
//
// Fora do alcance (sensível): CPF/CNPJ/RG de cliente e da locadora — o
// assistente nunca lê nem grava documento, e nenhum resultado de
// ferramenta devolve documento; chave Pix; plano; e-mail/senha; a
// assinatura da locadora (feita com o dedo, na tela, por ela); laudo com
// foto. Cancelar locação pede confirmação em dois passos.

import { rest, AcaoErro, idDoToken, hojeBrasil } from './acoes.ts';
// @ts-ignore — módulo JS puro, cópia de locacao/contrato-doc.js
import Doc from './contrato-doc.js';
// @ts-ignore — módulo JS puro, cópia de locacao/precos.js (v12.42: preço por período)
import Precos from './precos-locacao.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const BASE_PUBLICA = 'https://fieldo-zelo.com.br';

type Linha = Record<string, unknown>;

const MSG_CONTRATO: Record<string, string> = {
  nao_autenticado: 'sessão expirada — entre de novo no painel.',
  nao_encontrado: 'contrato ou locação não encontrado.',
  nao_editavel: 'esse contrato já foi enviado e não pode mais ser editado; para mudar, gere uma nova versão no painel.',
  ja_existe: 'essa locação já tem contrato.',
  campos_invalidos: 'faltam dados obrigatórios no contrato.',
  locacao_mudou: 'a locação mudou depois do rascunho; abra o contrato no painel para atualizar.',
  revogado: 'o link foi cancelado.',
  expirado: 'o link expirou.',
  cancelado: 'o contrato foi cancelado.',
  substituido: 'o contrato foi substituído por uma nova versão.',
  estado_invalido: 'isso não é possível na situação atual do contrato.',
  validade_invalida: 'a validade do link precisa ser de 1 a 30 dias.',
  locacao_nao_encontrada: 'locação não encontrada.',
  locacao_cancelada: 'essa locação foi cancelada.',
  locacao_sem_itens: 'a locação não tem equipamentos.',
  ja_existe_rascunho: 'já existe um rascunho de nova versão; abra no painel.',
  clausulas_invalidas: 'alguma cláusula do modelo está inválida; confira em Contratos.',
  texto_invalido: 'não foi possível gerar o texto do contrato.',
};

async function rpcLoc(token: string, fn: string, args: Linha): Promise<Linha> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: ctrl.signal,
    });
    const txt = await res.text();
    let j: unknown = null;
    try { j = txt ? JSON.parse(txt) : null; } catch { j = null; }
    if (!res.ok) {
      const m = j && typeof (j as Linha).message === 'string' ? (j as Linha).message as string : 'erro ' + res.status;
      throw new AcaoErro(m);
    }
    const r = (Array.isArray(j) ? j[0] : j) as Linha | null;
    if (r && r.ok === false) {
      const e = String(r.error || 'erro');
      throw new AcaoErro(MSG_CONTRATO[e] || ('não foi possível concluir (' + e + ').'));
    }
    return r || {};
  } finally {
    clearTimeout(t);
  }
}

/* ── utilidades ─────────────────────────────────────────────────── */
const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : undefined);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const enc = encodeURIComponent;
function id(v: unknown, nome: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!UUID.test(s)) throw new AcaoErro(nome + ' inválido ou ausente — liste primeiro para pegar o id certo.');
  return s;
}
function data(v: unknown, nome: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!DATA.test(s)) throw new AcaoErro(nome + ' precisa estar no formato AAAA-MM-DD.');
  return s;
}
function soDefinidos(o: Linha) {
  const out: Linha = {};
  for (const k of Object.keys(o)) if (o[k] !== undefined) out[k] = o[k];
  return out;
}
function um(rows: Linha[], oQue: string) {
  if (!rows.length) throw new AcaoErro(oQue + ' não encontrado (ou não é seu).');
  return rows[0];
}
function norm(s: unknown) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function somarDias(iso: string, dias: number) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/* mesmas regras de db.locacao.js */
export function diarias(saida: string, devolucao: string) {
  const a = Date.parse(saida + 'T00:00:00Z'), b = Date.parse(devolucao + 'T00:00:00Z');
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.max(1, Math.round((b - a) / 86400000));
}
export function statusVisivel(l: Linha, hoje: string) {
  if (l.status === 'devolvida' || l.status === 'cancelada') return String(l.status);
  if (l.data_prevista_devolucao && String(l.data_prevista_devolucao) < hoje) return 'atrasada';
  if (l.data_saida && String(l.data_saida) <= hoje) return 'em_andamento';
  return 'reservada';
}
const ROTULO: Record<string, string> = { reservada: 'reservada', em_andamento: 'em uso', atrasada: 'atrasada', devolvida: 'devolvida', cancelada: 'cancelada' };
function ocupa(l: Linha) { return l.status !== 'devolvida' && l.status !== 'cancelada'; }
export function ocupadoNoPeriodo(locs: Linha[], inicio: string, fim: string, ignorar: string | null, hoje: string) {
  const mapa: Record<string, number> = {};
  if (fim < inicio) fim = inicio;
  for (const l of locs) {
    if (!l || l.id === ignorar || !ocupa(l) || !l.data_saida) continue;
    let f = String(l.data_prevista_devolucao || l.data_saida || hoje);
    if (f < hoje) f = hoje;
    if (!(String(l.data_saida) <= fim && f >= inicio)) continue;
    for (const it of (l.locacao_itens as Linha[]) || []) {
      if (!it || !it.equipamento_id) continue;
      const k = String(it.equipamento_id);
      mapa[k] = (mapa[k] || 0) + (Number(it.quantidade) || 0);
    }
  }
  return mapa;
}

async function equipamentos(token: string, loc: string) {
  return await rest(token, 'GET', 'equipamentos?locadora_id=eq.' + loc +
    '&select=id,nome,marca,modelo,categoria_id,preco_dia,preco_semana,preco_quinzena,preco_mes,caucao,quantidade,ativo,is_public&order=nome.asc');
}
async function locacoesAbertas(token: string, loc: string) {
  return await rest(token, 'GET', 'locacoes?locadora_id=eq.' + loc +
    '&status=not.in.(devolvida,cancelada)&select=id,data_saida,data_prevista_devolucao,status,locacao_itens(equipamento_id,quantidade)');
}
function linkAssinatura(tok: string) {
  return BASE_PUBLICA + '/locacao/contrato-assinar.html#t=' + enc(tok);
}
function linkWhats(tel: unknown, link: string) {
  const msg = 'Olá! Seu contrato de locação está disponível para conferência e assinatura digital. ' +
    'Acesse o link abaixo para visualizar os dados e concluir a assinatura: ' + link +
    ' Em caso de dúvidas, entre em contato conosco.';
  let d = String(tel || '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return (d.length === 12 || d.length === 13) ? 'https://wa.me/' + d + '?text=' + enc(msg) : 'https://wa.me/?text=' + enc(msg);
}

/* ── definições das ferramentas ─────────────────────────────────── */
const PERIODO = {
  inicio: { type: 'string', description: 'AAAA-MM-DD' },
  fim: { type: 'string', description: 'AAAA-MM-DD' },
};
export const TOOLS_LOCACAO = [
  {
    name: 'loc_equipamentos',
    description: 'Lista os equipamentos da locadora com preços (dia, semana, mês), caução, quantidade, se está na vitrine e, se informar um período, quantos estão livres nele. Use para achar o id de um equipamento.',
    input_schema: { type: 'object', properties: PERIODO },
  },
  {
    name: 'loc_criar_equipamento',
    description: 'Cadastra um equipamento novo. A categoria é escrita do jeito que o locador falar (betoneira, andaime, furadeira...) e é ligada à categoria mais próxima do Fieldo; se não achar, a resposta traz as categorias existentes para escolher. Preço: diária, semanal, quinzenal e/ou mensal — pelo menos um; pergunte se o locador não disser. Por padrão o equipamento já entra na vitrine.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Obrigatório. Ex.: "Betoneira 400 litros".' },
        categoria: { type: 'string', description: 'Obrigatório. Ex.: "betoneira".' },
        preco_dia: { type: 'number', description: 'Diária, em reais.' }, preco_semana: { type: 'number', description: 'Semanal (7 dias).' },
        preco_quinzena: { type: 'number', description: 'Quinzenal (15 dias).' }, preco_mes: { type: 'number', description: 'Mensal (30 dias).' },
        caucao: { type: 'number', description: 'Caução por unidade, em reais.' },
        quantidade: { type: 'integer', description: 'Quantas unidades a locadora tem. Padrão 1.' },
        marca: { type: 'string' }, modelo: { type: 'string' }, descricao: { type: 'string' },
        na_vitrine: { type: 'boolean', description: 'Padrão true.' },
      },
      required: ['nome', 'categoria'],
    },
  },
  {
    name: 'loc_editar_equipamento',
    description: 'Muda preço, caução, quantidade, nome ou descrição de um equipamento, tira ou põe na vitrine, ou desativa/reativa.',
    input_schema: {
      type: 'object',
      properties: {
        equipamento_id: { type: 'string' }, nome: { type: 'string' }, descricao: { type: 'string' },
        preco_dia: { type: 'number', description: 'Diária, em reais.' }, preco_semana: { type: 'number', description: 'Semanal (7 dias).' },
        preco_quinzena: { type: 'number', description: 'Quinzenal (15 dias).' }, preco_mes: { type: 'number', description: 'Mensal (30 dias).' },
        caucao: { type: 'number' }, quantidade: { type: 'integer' },
        na_vitrine: { type: 'boolean' }, ativo: { type: 'boolean' },
      },
      required: ['equipamento_id'],
    },
  },
  {
    name: 'loc_disponibilidade',
    description: 'Diz quantas unidades de cada equipamento (ou de um só) estão livres num período, contando reservas e aluguéis atrasados.',
    input_schema: { type: 'object', properties: { ...PERIODO, equipamento_id: { type: 'string' } }, required: ['inicio', 'fim'] },
  },
  {
    name: 'loc_locacoes',
    description: 'Lista aluguéis com cliente, equipamentos, datas, valor, caução, situação (reservada, em uso, atrasada, devolvida) e situação do contrato. Use para achar o id de uma locação.',
    input_schema: {
      type: 'object',
      properties: { filtro: { type: 'string', enum: ['abertas', 'atrasadas', 'vencem_hoje_ou_amanha', 'reservadas', 'recentes'], description: 'Padrão: abertas.' } },
    },
  },
  {
    name: 'loc_nova_locacao',
    description: 'Registra um aluguel: confere se há unidades livres no período, calcula o valor pela tabela de preços de cada equipamento (a combinação mais barata de diária, semana, quinzena e mês que cobre o período) e sugere a caução pela soma das cauções. Não pede nem grava CPF/CNPJ: o documento do cliente é preenchido pelo locador na tela.',
    input_schema: {
      type: 'object',
      properties: {
        cliente_nome: { type: 'string', description: 'Obrigatório.' },
        cliente_telefone: { type: 'string' },
        itens: { type: 'array', items: { type: 'object', properties: { equipamento_id: { type: 'string' }, quantidade: { type: 'integer' } }, required: ['equipamento_id', 'quantidade'] } },
        data_saida: { type: 'string', description: 'AAAA-MM-DD. Obrigatório.' },
        data_devolucao: { type: 'string', description: 'Devolução prevista, AAAA-MM-DD. Obrigatório.' },
        entrega_endereco: { type: 'string' }, observacoes: { type: 'string' },
        valor_total: { type: 'number', description: 'Só se o locador combinou um valor diferente do calculado.' },
        caucao: { type: 'number', description: 'Só se for diferente da soma das cauções.' },
      },
      required: ['cliente_nome', 'itens', 'data_saida', 'data_devolucao'],
    },
  },
  {
    name: 'loc_alterar_locacao',
    description: 'Muda um aluguel: renovar (nova data de devolução), mudar a data de saída, endereço, observações, valor ou caução. Ao mudar datas, confere a disponibilidade e recalcula o valor pela tabela de preços gravada em cada item, a menos que o valor seja informado.',
    input_schema: {
      type: 'object',
      properties: {
        locacao_id: { type: 'string' }, data_saida: { type: 'string' }, data_devolucao: { type: 'string' },
        entrega_endereco: { type: 'string' }, observacoes: { type: 'string' }, cliente_telefone: { type: 'string' },
        valor_total: { type: 'number' }, caucao: { type: 'number' },
      },
      required: ['locacao_id'],
    },
  },
  {
    name: 'loc_devolucao',
    description: 'Dá baixa na devolução: grava a data real (padrão hoje) e o que aconteceu com a caução (devolvida, retida, abatida ou pendente). O equipamento volta ao estoque.',
    input_schema: {
      type: 'object',
      properties: {
        locacao_id: { type: 'string' }, data_devolucao: { type: 'string', description: 'AAAA-MM-DD, padrão hoje.' },
        caucao: { type: 'string', enum: ['devolvida', 'retida', 'abatida', 'pendente'] },
      },
      required: ['locacao_id'],
    },
  },
  {
    name: 'loc_cancelar_locacao',
    description: 'Cancela um aluguel. SEMPRE em dois passos: sem confirmado para ver o que vai ser cancelado; com confirmado=true só depois de um sim do locador nesta conversa.',
    input_schema: { type: 'object', properties: { locacao_id: { type: 'string' }, confirmado: { type: 'boolean' } }, required: ['locacao_id'] },
  },
  {
    name: 'loc_contrato',
    description:
      'Contrato de um aluguel. acao="situacao": diz se existe, em que situação está e quem já assinou. acao="enviar": cria o contrato se não existir, preenche as condições informadas e gera o link de assinatura para o cliente (com mensagem pronta de WhatsApp); se faltar algum dado, devolve o que falta. acao="novo_link": gera outro link quando o anterior expirou. Documentos (CPF/CNPJ) nunca passam pelo assistente: se faltarem, o locador completa na tela. A assinatura da locadora é sempre feita por ela, na tela.',
    input_schema: {
      type: 'object',
      properties: {
        locacao_id: { type: 'string' },
        acao: { type: 'string', enum: ['situacao', 'enviar', 'novo_link'] },
        validade_dias: { type: 'integer', description: 'Validade do link. Padrão 7.' },
        cliente_telefone: { type: 'string', description: 'WhatsApp do cliente, se faltar no contrato.' },
        cliente_endereco: { type: 'string', description: 'Endereço do cliente, se o locador informar.' },
        condicoes: {
          type: 'object',
          description: 'Condições do contrato que o locador informar.',
          properties: {
            forma_pagamento: { type: 'string' }, local_devolucao: { type: 'string' }, multa_atraso: { type: 'string' },
            tolerancia_devolucao: { type: 'string' }, cancelamento: { type: 'string' }, foro: { type: 'string' },
          },
        },
        salvar_condicoes_no_modelo: { type: 'boolean', description: 'true para os próximos contratos já saírem com essas condições.' },
      },
      required: ['locacao_id', 'acao'],
    },
  },
  {
    name: 'loc_resumo',
    description: 'Resumo da locadora: aluguéis do mês e valor, abertos, atrasados, que vencem hoje ou amanhã e caução em aberto.',
    input_schema: { type: 'object', properties: {} },
  },
];
export const NOMES_LOCACAO = new Set(TOOLS_LOCACAO.map((t) => t.name));

/* ── execução ───────────────────────────────────────────────────── */
export async function executarLocacao(nome: string, input: Linha, token: string): Promise<unknown> {
  const loc = idDoToken(token);
  if (!loc) throw new AcaoErro('sessão inválida — entre no painel de novo.');
  const hoje = hojeBrasil().iso;

  switch (nome) {
    case 'loc_equipamentos': {
      const eqs = await equipamentos(token, loc);
      let livres: Record<string, number> | null = null;
      if (typeof input.inicio === 'string' && input.inicio) {
        const ini = data(input.inicio, 'inicio'), fim = typeof input.fim === 'string' && input.fim ? data(input.fim, 'fim') : ini;
        livres = ocupadoNoPeriodo(await locacoesAbertas(token, loc), ini, fim, null, hoje);
      }
      return {
        equipamentos: eqs.map((e) => soDefinidos({
          equipamento_id: e.id, nome: e.nome, marca: e.marca || undefined, preco_dia: e.preco_dia, preco_semana: e.preco_semana,
          preco_quinzena: e.preco_quinzena, preco_mes: e.preco_mes, caucao: e.caucao, quantidade: e.quantidade, na_vitrine: !!e.is_public, ativo: e.ativo !== false,
          livres_no_periodo: livres ? Math.max(0, Number(e.quantidade || 0) - (livres[String(e.id)] || 0)) : undefined,
        })),
      };
    }

    case 'loc_criar_equipamento': {
      const nomeE = txt(input.nome, 120);
      if (!nomeE) throw new AcaoErro('informe o nome do equipamento.');
      const cats = await rest(token, 'GET', 'equipamento_categorias?aprovada=eq.true&select=id,slug,nome,nome_plural,sinonimos&order=ordem.asc');
      const alvo = norm(input.categoria || nomeE);
      const achou = cats.find((c) => [c.slug, c.nome, c.nome_plural, ...((c.sinonimos as string[]) || [])].some((s) => {
        const n = norm(s); return n && (alvo === n || alvo.includes(n) || n.includes(alvo));
      }));
      if (!achou) {
        return { precisa_categoria: true, categorias: cats.map((c) => c.nome), instrucao: 'Pergunte ao locador em qual destas categorias o equipamento entra e chame de novo com ela.' };
      }
      for (const k of ['preco_dia', 'preco_semana', 'preco_quinzena', 'preco_mes', 'caucao']) {
        if (num(input[k]) !== undefined && (input[k] as number) < 0) throw new AcaoErro(k + ' não pode ser negativo.');
      }
      if (!Precos.temPreco(input)) throw new AcaoErro('informe pelo menos um preço: diária, semanal, quinzenal ou mensal.');
      const qtd = Number.isInteger(input.quantidade) && (input.quantidade as number) >= 1 ? input.quantidade : 1;
      const r = um(await rest(token, 'POST', 'equipamentos', soDefinidos({
        locadora_id: loc, nome: nomeE, categoria_id: achou.id, quantidade: qtd,
        preco_dia: num(input.preco_dia) !== undefined ? r2(input.preco_dia) : undefined,
        preco_semana: num(input.preco_semana) !== undefined ? r2(input.preco_semana) : undefined,
        preco_quinzena: num(input.preco_quinzena) !== undefined ? r2(input.preco_quinzena) : undefined,
        preco_mes: num(input.preco_mes) !== undefined ? r2(input.preco_mes) : undefined,
        caucao: num(input.caucao) !== undefined ? r2(input.caucao) : undefined,
        marca: txt(input.marca, 80) || undefined, modelo: txt(input.modelo, 80) || undefined,
        descricao: txt(input.descricao, 1500) || undefined,
        is_public: input.na_vitrine === false ? false : true, ativo: true,
      })), 'Equipamento');
      return { ok: true, equipamento_id: r.id, nome: r.nome, categoria: achou.nome, quantidade: r.quantidade, precos: Precos.resumo(r), na_vitrine: !!r.is_public,
        lembrete: 'Fotos se colocam pela tela de Equipamentos.' };
    }

    case 'loc_editar_equipamento': {
      const eid = id(input.equipamento_id, 'equipamento_id');
      const dados: Linha = soDefinidos({ nome: txt(input.nome, 120), descricao: txt(input.descricao, 1500) });
      for (const k of ['preco_dia', 'preco_semana', 'preco_quinzena', 'preco_mes', 'caucao']) {
        if (num(input[k]) !== undefined) {
          if ((input[k] as number) < 0) throw new AcaoErro(k + ' não pode ser negativo.');
          dados[k] = r2(input[k]);
        }
      }
      if (Number.isInteger(input.quantidade)) {
        if ((input.quantidade as number) < 0) throw new AcaoErro('quantidade não pode ser negativa.');
        dados.quantidade = input.quantidade;
      }
      if (typeof input.na_vitrine === 'boolean') dados.is_public = input.na_vitrine;
      if (typeof input.ativo === 'boolean') { dados.ativo = input.ativo; if (!input.ativo) dados.is_public = false; }
      if (!Object.keys(dados).length) throw new AcaoErro('diga o que mudar no equipamento.');
      const antes = um(await rest(token, 'GET', 'equipamentos?id=eq.' + enc(eid) + '&select=preco_dia,preco_semana,preco_quinzena,preco_mes,caucao,quantidade,is_public,ativo'), 'Equipamento');
      /* zerar todos os preços deixaria o equipamento sem como ser cobrado */
      if (!Precos.temPreco({ ...antes, ...dados })) throw new AcaoErro('o equipamento precisa de pelo menos um preço (diária, semanal, quinzenal ou mensal).');
      const r = um(await rest(token, 'PATCH', 'equipamentos?id=eq.' + enc(eid), dados), 'Equipamento');
      return { ok: true, equipamento_id: r.id, nome: r.nome, precos: Precos.resumo(r), caucao: r.caucao, quantidade: r.quantidade, na_vitrine: !!r.is_public, ativo: r.ativo !== false,
        antes: { precos: Precos.resumo(antes), caucao: antes.caucao, quantidade: antes.quantidade, na_vitrine: !!antes.is_public, ativo: antes.ativo !== false } };
    }

    case 'loc_disponibilidade': {
      const ini = data(input.inicio, 'inicio'), fim = data(input.fim, 'fim');
      if (fim < ini) throw new AcaoErro('o fim do período vem antes do início.');
      const [eqs, abertas] = await Promise.all([equipamentos(token, loc), locacoesAbertas(token, loc)]);
      const ocup = ocupadoNoPeriodo(abertas, ini, fim, null, hoje);
      const filtro = typeof input.equipamento_id === 'string' && input.equipamento_id ? id(input.equipamento_id, 'equipamento_id') : null;
      return {
        periodo: { inicio: ini, fim, diarias: diarias(ini, fim) },
        equipamentos: eqs.filter((e) => e.ativo !== false && (!filtro || e.id === filtro)).map((e) => ({
          equipamento_id: e.id, nome: e.nome, total: e.quantidade, livres: Math.max(0, Number(e.quantidade || 0) - (ocup[String(e.id)] || 0)),
        })),
      };
    }

    case 'loc_locacoes': {
      const f = String(input.filtro || 'abertas');
      let q = 'locacoes?locadora_id=eq.' + loc + '&select=id,client_name,client_phone,data_saida,data_prevista_devolucao,data_devolucao,status,valor_total,caucao_valor,caucao_status,entrega_endereco,locacao_itens(quantidade,equipamentos(nome))';
      if (f === 'recentes') q += '&order=created_at.desc&limit=15';
      else q += '&status=not.in.(devolvida,cancelada)&order=data_prevista_devolucao.asc&limit=50';
      let rows = await rest(token, 'GET', q);
      const amanha = somarDias(hoje, 1);
      rows = rows.filter((l) => {
        const s = statusVisivel(l, hoje);
        if (f === 'atrasadas') return s === 'atrasada';
        if (f === 'reservadas') return s === 'reservada';
        if (f === 'vencem_hoje_ou_amanha') return ['em_andamento', 'reservada'].includes(s) && [hoje, amanha].includes(String(l.data_prevista_devolucao));
        return true;
      });
      const ids = rows.map((l) => l.id as string);
      const cts = ids.length ? await rest(token, 'GET', 'loc_contratos?locacao_id=in.(' + ids.join(',') + ')&select=locacao_id,status,versao&order=versao.desc') : [];
      return {
        hoje,
        locacoes: rows.map((l) => {
          const ct = cts.find((c) => c.locacao_id === l.id);
          return soDefinidos({
            locacao_id: l.id, cliente: l.client_name, telefone: l.client_phone || undefined,
            equipamentos: ((l.locacao_itens as Linha[]) || []).map((i) => (Number(i.quantidade) > 1 ? i.quantidade + '× ' : '') + (((i.equipamentos as Linha) || {}).nome || '?')).join(', '),
            saida: l.data_saida, devolucao_prevista: l.data_prevista_devolucao, devolvida_em: l.data_devolucao || undefined,
            situacao: ROTULO[statusVisivel(l, hoje)], valor_total: l.valor_total,
            caucao: Number(l.caucao_valor) > 0 ? { valor: l.caucao_valor, situacao: l.caucao_status || 'pendente' } : undefined,
            contrato: ct ? ct.status : 'sem contrato',
          });
        }),
      };
    }

    case 'loc_nova_locacao': {
      const cliente = txt(input.cliente_nome, 160);
      if (!cliente) throw new AcaoErro('informe o nome do cliente.');
      const saida = data(input.data_saida, 'data_saida'), dev = data(input.data_devolucao, 'data_devolucao');
      if (dev < saida) throw new AcaoErro('a devolução vem antes da saída.');
      const pedidos = Array.isArray(input.itens) ? (input.itens as Linha[]) : [];
      if (!pedidos.length) throw new AcaoErro('diga quais equipamentos e quantos.');
      const [eqs, abertas] = await Promise.all([equipamentos(token, loc), locacoesAbertas(token, loc)]);
      const ocup = ocupadoNoPeriodo(abertas, saida, dev, null, hoje);
      const n = diarias(saida, dev);
      const itens: Linha[] = [], semPreco: string[] = [], faltam: string[] = [];
      let total = 0, caucao = 0;
      for (const p of pedidos) {
        const eid = id(p.equipamento_id, 'equipamento_id');
        const e = eqs.find((x) => x.id === eid);
        if (!e || e.ativo === false) throw new AcaoErro('equipamento não encontrado ou desativado: ' + eid);
        const qtd = Number.isInteger(p.quantidade) && (p.quantidade as number) > 0 ? (p.quantidade as number) : 1;
        const livres = Math.max(0, Number(e.quantidade || 0) - (ocup[eid] || 0));
        if (qtd > livres) faltam.push(e.nome + ': pediu ' + qtd + ', livre' + (livres === 1 ? '' : 's') + ' ' + livres);
        const cob = Precos.cobranca(e, n);
        const sub = cob ? r2(cob.unitario * qtd) : null;
        if (sub != null) total += sub; else semPreco.push(String(e.nome));
        if (e.caucao) caucao += Number(e.caucao) * qtd;
        itens.push({ equipamento_id: eid, quantidade: qtd, preco_dia_aplicado: e.preco_dia != null ? Number(e.preco_dia) : null,
                     subtotal: sub, cobranca: cob, _nome: e.nome });
      }
      if (faltam.length) {
        return { indisponivel: true, periodo: saida + ' a ' + dev, faltam, instrucao: 'Nada foi gravado. Conte ao locador o que falta e sugira outro período ou quantidade.' };
      }
      const valor = num(input.valor_total) !== undefined ? r2(input.valor_total) : r2(total);
      const cauc = num(input.caucao) !== undefined ? r2(input.caucao) : r2(caucao);
      const nova = um(await rest(token, 'POST', 'locacoes', soDefinidos({
        locadora_id: loc, client_name: cliente, client_phone: txt(input.cliente_telefone, 40) || undefined,
        data_saida: saida, data_prevista_devolucao: dev, valor_total: valor, caucao_valor: cauc || undefined,
        entrega_endereco: txt(input.entrega_endereco, 300) || undefined, observacoes: txt(input.observacoes, 2000) || undefined,
        status: saida > hoje ? 'reservada' : 'em_andamento',
      })), 'Locação');
      try {
        await rest(token, 'POST', 'locacao_itens', itens.map((i) => ({
          locacao_id: nova.id, equipamento_id: i.equipamento_id, quantidade: i.quantidade, preco_dia_aplicado: i.preco_dia_aplicado, subtotal: i.subtotal,
          cobranca: i.cobranca,
        })));
      } catch (e) {
        await rest(token, 'DELETE', 'locacoes?id=eq.' + enc(String(nova.id))).catch(() => []);
        throw e;
      }
      return soDefinidos({
        ok: true, locacao_id: nova.id, cliente, saida, devolucao_prevista: dev, diarias: n,
        itens: itens.map((i) => soDefinidos({ equipamento: i._nome, quantidade: i.quantidade, subtotal: i.subtotal,
          cobranca: i.cobranca ? Precos.descrever(i.cobranca) : undefined })),
        valor_total: valor, valor_pela_tabela: r2(total), caucao: cauc, situacao: ROTULO[statusVisivel(nova, hoje)],
        aviso: semPreco.length ? 'Sem preço cadastrado (não entrou na conta): ' + semPreco.join(', ') + '.' : undefined,
        lembrete: 'O CPF/CNPJ do cliente, se for fazer contrato, o locador preenche na tela da locação.',
      });
    }

    case 'loc_alterar_locacao': {
      const lid = id(input.locacao_id, 'locacao_id');
      const l = um(await rest(token, 'GET', 'locacoes?id=eq.' + enc(lid) + '&select=id,status,data_saida,data_prevista_devolucao,valor_total,caucao_valor,locacao_itens(id,equipamento_id,quantidade,preco_dia_aplicado,cobranca)'), 'Locação');
      if (l.status === 'devolvida' || l.status === 'cancelada') throw new AcaoErro('essa locação já está ' + l.status + '.');
      const saida = typeof input.data_saida === 'string' && input.data_saida ? data(input.data_saida, 'data_saida') : String(l.data_saida);
      const dev = typeof input.data_devolucao === 'string' && input.data_devolucao ? data(input.data_devolucao, 'data_devolucao') : String(l.data_prevista_devolucao);
      if (dev < saida) throw new AcaoErro('a devolução vem antes da saída.');
      const dados: Linha = soDefinidos({
        entrega_endereco: txt(input.entrega_endereco, 300), observacoes: txt(input.observacoes, 2000),
        client_phone: txt(input.cliente_telefone, 40),
      });
      const mudouData = saida !== l.data_saida || dev !== l.data_prevista_devolucao;
      let valorDiarias: number | null = null;
      if (mudouData) {
        const [eqs, abertas] = await Promise.all([equipamentos(token, loc), locacoesAbertas(token, loc)]);
        const ocup = ocupadoNoPeriodo(abertas, saida, dev, lid, hoje);
        const faltam: string[] = [];
        for (const it of (l.locacao_itens as Linha[]) || []) {
          const e = eqs.find((x) => x.id === it.equipamento_id);
          const livres = Math.max(0, Number((e && e.quantidade) || 0) - (ocup[String(it.equipamento_id)] || 0));
          if (Number(it.quantidade) > livres) faltam.push(((e && e.nome) || '?') + ': precisa de ' + it.quantidade + ', livre' + (livres === 1 ? '' : 's') + ' ' + livres);
        }
        if (faltam.length) return { indisponivel: true, faltam, instrucao: 'Nada foi mudado. Conte ao locador o que conflita com outros aluguéis.' };
        const n = diarias(saida, dev);
        valorDiarias = 0;
        for (const it of (l.locacao_itens as Linha[]) || []) {
          /* Refaz a conta com os preços da ÉPOCA do aluguel: a tabela gravada
             na cobrança do item; item antigo (sem ela) usa a diária aplicada,
             como antes. Mudança de preço no cadastro não reprecifica aluguel em curso. */
          const c = it.cobranca as { tabela?: Linha } | null;
          const tabela = c && c.tabela ? c.tabela : { dia: it.preco_dia_aplicado };
          const cob = Precos.cobranca(tabela, n);
          if (!cob) continue;
          const sub = r2(cob.unitario * Number(it.quantidade));
          valorDiarias += sub;
          await rest(token, 'PATCH', 'locacao_itens?id=eq.' + enc(String(it.id)),
            c ? { subtotal: sub, cobranca: cob } : { subtotal: sub });
        }
        dados.data_saida = saida; dados.data_prevista_devolucao = dev;
        dados.status = saida > hoje ? 'reservada' : 'em_andamento';
        dados.valor_total = r2(valorDiarias);
      }
      if (num(input.valor_total) !== undefined) dados.valor_total = r2(input.valor_total);
      if (num(input.caucao) !== undefined) dados.caucao_valor = r2(input.caucao);
      if (!Object.keys(dados).length) throw new AcaoErro('diga o que mudar na locação.');
      const r = um(await rest(token, 'PATCH', 'locacoes?id=eq.' + enc(lid), dados), 'Locação');
      return soDefinidos({
        ok: true, locacao_id: r.id, saida: r.data_saida, devolucao_prevista: r.data_prevista_devolucao,
        diarias: diarias(String(r.data_saida), String(r.data_prevista_devolucao)), valor_total: r.valor_total, caucao: r.caucao_valor,
        situacao: ROTULO[statusVisivel(r, hoje)],
        antes: { saida: l.data_saida, devolucao_prevista: l.data_prevista_devolucao, valor_total: l.valor_total },
        aviso: mudouData ? 'Se já havia contrato enviado, ele mostra as datas antigas: gere uma nova versão no painel.' : undefined,
      });
    }

    case 'loc_devolucao': {
      const lid = id(input.locacao_id, 'locacao_id');
      const l = um(await rest(token, 'GET', 'locacoes?id=eq.' + enc(lid) + '&select=id,status,data_saida,caucao_valor'), 'Locação');
      if (l.status === 'devolvida' || l.status === 'cancelada') throw new AcaoErro('essa locação já está ' + l.status + '.');
      const quando = typeof input.data_devolucao === 'string' && input.data_devolucao ? data(input.data_devolucao, 'data_devolucao') : hoje;
      if (quando < String(l.data_saida)) throw new AcaoErro('a devolução não pode ser antes da saída (' + l.data_saida + ').');
      const patch: Linha = { status: 'devolvida', data_devolucao: quando };
      if (['devolvida', 'retida', 'abatida', 'pendente'].includes(String(input.caucao))) patch.caucao_status = input.caucao;
      const r = um(await rest(token, 'PATCH', 'locacoes?id=eq.' + enc(lid), patch), 'Locação');
      return soDefinidos({ ok: true, locacao_id: r.id, devolvida_em: r.data_devolucao,
        caucao: Number(r.caucao_valor) > 0 ? { valor: r.caucao_valor, situacao: r.caucao_status || 'pendente' } : undefined });
    }

    case 'loc_cancelar_locacao': {
      const lid = id(input.locacao_id, 'locacao_id');
      const l = um(await rest(token, 'GET', 'locacoes?id=eq.' + enc(lid) + '&select=id,client_name,data_saida,data_prevista_devolucao,status,valor_total'), 'Locação');
      if (l.status === 'cancelada') throw new AcaoErro('essa locação já está cancelada.');
      if (input.confirmado !== true) {
        return { precisa_confirmar: true, vai_cancelar: { cliente: l.client_name, saida: l.data_saida, devolucao_prevista: l.data_prevista_devolucao, valor_total: l.valor_total },
          instrucao: 'Conte ao locador o que será cancelado e peça um sim. Só chame de novo com confirmado=true depois do sim.' };
      }
      const r = um(await rest(token, 'PATCH', 'locacoes?id=eq.' + enc(lid), { status: 'cancelada' }), 'Locação');
      return { ok: true, locacao_id: r.id, situacao: 'cancelada', lembrete: 'Se havia contrato enviado, cancele o contrato no painel.' };
    }

    case 'loc_contrato': {
      const lid = id(input.locacao_id, 'locacao_id');
      const acao = String(input.acao || 'situacao');
      const lista = await rest(token, 'GET', 'loc_contratos?locacao_id=eq.' + enc(lid) +
        '&select=id,numero,versao,status,dados,clausulas,enviado_em,token_expira_em,revogado_em,concluido_em,loc_contrato_assinaturas(parte,assinado_em)&order=versao.desc&limit=1');
      let c: Linha | null = lista[0] || null;

      if (acao === 'situacao') {
        if (!c) return { contrato: 'não existe', dica: 'Peça "gera o contrato e manda o link" para criar.' };
        return soDefinidos({
          numero: c.numero, versao: c.versao, situacao: c.status, enviado_em: c.enviado_em || undefined,
          link_vale_ate: c.token_expira_em || undefined, link_cancelado: c.revogado_em ? true : undefined,
          assinaturas: ((c.loc_contrato_assinaturas as Linha[]) || []).map((a) => ({ parte: a.parte, assinado_em: a.assinado_em })),
          lembrete: c.status === 'aguardando_locadora' ? 'Falta a assinatura da locadora: ela assina com o dedo, na tela de Contratos.' : undefined,
        });
      }

      const dias = Number.isInteger(input.validade_dias) && (input.validade_dias as number) > 0 ? Math.min(30, input.validade_dias as number) : 7;

      if (acao === 'novo_link') {
        if (!c) throw new AcaoErro('essa locação ainda não tem contrato. Use acao="enviar".');
        if (c.status === 'aguardando_locadora') return { situacao: c.status, instrucao: 'O cliente já assinou; não precisa de link novo. Falta a locadora assinar com o dedo, na tela de Contratos.' };
        if (c.status !== 'aguardando_cliente') return { situacao: c.status, instrucao: 'Esse contrato não está esperando o cliente, então não há link para gerar.' };
        const r = await rpcLoc(token, 'loc_contrato_novo_link', { p_id: c.id, p_validade_dias: dias });
        const link = linkAssinatura(String(r.token));
        const loca = um(await rest(token, 'GET', 'locacoes?id=eq.' + enc(lid) + '&select=client_phone'), 'Locação');
        return { ok: true, link, whatsapp: linkWhats(loca.client_phone, link), vale_ate: r.token_expira_em };
      }

      if (acao !== 'enviar') throw new AcaoErro('acao inválida.');
      /* contrato cancelado ou recusado não impede um novo (o banco também pensa assim) */
      if (c && (c.status === 'cancelado' || c.status === 'recusado')) c = null;
      if (c && c.status !== 'rascunho') {
        if (c.status === 'aguardando_cliente') return { ja_enviado: true, situacao: c.status, instrucao: 'O contrato já foi enviado. Se o cliente perdeu o link, use acao="novo_link".' };
        return { situacao: c.status, instrucao: 'Esse contrato não está mais em rascunho. Para mudar algo, gere uma nova versão no painel.' };
      }
      if (!c) {
        const l = um(await rest(token, 'GET', 'locacoes?id=eq.' + enc(lid) + '&select=caucao_valor'), 'Locação');
        /* igual ao painel: manda as cláusulas padrão; se a locadora tem
           modelo próprio, o banco usa o modelo (cláusulas e condições) */
        const padrao = Doc.clausulasPadrao({ locacao: { caucao_valor: l.caucao_valor } });
        try {
          await rpcLoc(token, 'loc_contrato_criar', { p_locacao_id: lid, p_clausulas: padrao });
        } catch (e) {
          if (!(e instanceof AcaoErro) || !/já tem contrato/.test(e.message)) throw e;
        }
        c = um(await rest(token, 'GET', 'loc_contratos?locacao_id=eq.' + enc(lid) + '&select=id,numero,versao,status,dados,clausulas&order=versao.desc&limit=1'), 'Contrato');
      }
      const cond = (input.condicoes && typeof input.condicoes === 'object') ? input.condicoes as Linha : {};
      const limpas: Linha = {};
      for (const k of ['forma_pagamento', 'local_devolucao', 'multa_atraso', 'tolerancia_devolucao', 'cancelamento', 'foro']) {
        const v = txt(cond[k], 500); if (v) limpas[k] = v;
      }
      /* do cliente, só contato (telefone, endereço). Documento nunca. */
      const cli: Linha = soDefinidos({ telefone: txt(input.cliente_telefone, 40) || undefined, endereco: txt(input.cliente_endereco, 300) || undefined });
      {
        const edicao: Linha = {};
        if (Object.keys(limpas).length) edicao.condicoes = limpas;
        if (Object.keys(cli).length) edicao.cliente = cli;
        if (Object.keys(edicao).length) {
          await rpcLoc(token, 'loc_contrato_salvar', { p_id: c.id, p_edicao: edicao, p_clausulas: null, p_resync: false });
          if (input.salvar_condicoes_no_modelo === true && Object.keys(limpas).length) {
            const modelo = (await rest(token, 'GET', 'loc_contrato_modelos?locadora_id=eq.' + loc + '&select=clausulas,condicoes&limit=1'))[0] || {};
            await rpcLoc(token, 'loc_contrato_modelo_salvar', {
              p_clausulas: Array.isArray(modelo.clausulas) ? modelo.clausulas : [],
              p_condicoes: { ...((modelo.condicoes as Linha) || {}), ...limpas },
            });
          }
          c = um(await rest(token, 'GET', 'loc_contratos?id=eq.' + enc(String(c.id)) + '&select=id,numero,versao,status,dados,clausulas'), 'Contrato');
        }
      }
      /* o texto final é montado pelo mesmo módulo do painel; documentos
         ficam só dentro desta função, nunca voltam para a conversa */
      const faltam = (Doc.validarParaEnvio(c.dados) as Linha[]).map((f) => String(f.rotulo));
      const r = Doc.render(c.dados, c.clausulas, { numero: c.numero, versao: c.versao, geradoEm: Doc.hojeBR() }) as { texto: string; pendencias: Linha[] };
      const rotulos: Record<string, string> = {};
      for (const cc of (Doc.CAMPOS_CONDICOES as Linha[]) || []) rotulos[String(cc.campo)] = String(cc.rotulo);
      const pend = (r.pendencias || []).map((p) => rotulos[String(p.campo)] || String(p.campo));
      if (faltam.length || pend.length) {
        const doc = faltam.filter((f) => /CPF|CNPJ|documento/i.test(f));
        return {
          precisa_completar: true, contrato: c.numero,
          faltam_dados: faltam, faltam_condicoes: [...new Set(pend)],
          instrucao: (doc.length ? 'Documentos (CPF/CNPJ) o locador completa na tela da locação ou do contrato; o assistente não mexe em documento. ' : '') +
            (pend.length ? 'As condições que faltam o locador pode dizer aqui (forma de pagamento, local de devolução, multa por atraso, tolerância, cancelamento, foro) e você chama de novo com condicoes.' : ''),
        };
      }
      const env = await rpcLoc(token, 'loc_contrato_enviar', { p_id: c.id, p_texto: r.texto, p_validade_dias: dias });
      const link = linkAssinatura(String(env.token));
      const loca = um(await rest(token, 'GET', 'locacoes?id=eq.' + enc(lid) + '&select=client_phone'), 'Locação');
      return { ok: true, contrato: c.numero, link, whatsapp: linkWhats(loca.client_phone, link), vale_ate: env.token_expira_em,
        lembrete: 'Depois que o cliente assinar, a locadora assina com o dedo na tela de Contratos.' };
    }

    case 'loc_resumo': {
      const h = hojeBrasil();
      const ini = h.iso.slice(0, 8) + '01';
      const amanha = somarDias(hoje, 1);
      const [mes, abertas, retidas] = await Promise.all([
        rest(token, 'GET', 'locacoes?locadora_id=eq.' + loc + '&status=neq.cancelada&data_saida=gte.' + ini + '&select=valor_total'),
        rest(token, 'GET', 'locacoes?locadora_id=eq.' + loc + '&status=not.in.(devolvida,cancelada)&select=id,client_name,data_saida,data_prevista_devolucao,status,valor_total,caucao_valor,caucao_status'),
        rest(token, 'GET', 'locacoes?locadora_id=eq.' + loc + '&caucao_status=eq.retida&select=caucao_valor'),
      ]);
      const vis = abertas.map((l) => Object.assign({}, l, { s: statusVisivel(l, hoje) }) as Linha & { s: string });
      const cauAberta = abertas.filter((l) => Number(l.caucao_valor) > 0 && (!l.caucao_status || l.caucao_status === 'pendente'))
        .reduce((a, l) => a + Number(l.caucao_valor), 0) + retidas.reduce((a, l) => a + (Number(l.caucao_valor) || 0), 0);
      return {
        mes: h.iso.slice(0, 7),
        alugueis_do_mes: { quantidade: mes.length, valor: r2(mes.reduce((a, l) => a + (Number(l.valor_total) || 0), 0)) },
        abertos: vis.length,
        atrasados: vis.filter((l) => l.s === 'atrasada').map((l) => ({ cliente: l.client_name, devia_voltar: l.data_prevista_devolucao })),
        vencem_hoje_ou_amanha: vis.filter((l) => l.s !== 'atrasada' && [hoje, amanha].includes(String(l.data_prevista_devolucao))).map((l) => ({ cliente: l.client_name, devolucao: l.data_prevista_devolucao })),
        caucao_em_aberto: r2(cauAberta),
      };
    }
  }
  throw new AcaoErro('ferramenta desconhecida: ' + nome);
}
