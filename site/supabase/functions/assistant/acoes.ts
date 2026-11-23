// Fieldo · supabase/functions/assistant/acoes.ts
//
// v12.22 · o assistente passa a AGIR em todo o app, não só em orçamento
// e serviço. Pedido do dono (31/10): "criar contratos etc, ele só não vai
// mexer em dados sensíveis, o resto ele deve agir".
//
// Como é seguro sem migration nova:
//   Toda ação aqui é uma chamada ao PostgREST com o JWT do próprio
//   profissional — exatamente o que as telas do app fazem. Quem decide se
//   pode é a RLS do banco (dono da linha, plano Pro em Contratos, limite
//   do plano grátis, checks de status). O assistente não ganha nenhum
//   poder que o profissional não tem na tela.
//
// O que fica de fora de propósito (DADOS SENSÍVEIS) — não existe
// ferramenta para isso, e o prompt manda recusar:
//   e-mail/senha/código de acesso, WhatsApp e contatos do perfil, plano,
//   assinatura e pagamentos do Fieldo, dados bancários e chave Pix,
//   CPF/CNPJ, foto, visibilidade do perfil, exclusão da conta, chaves de
//   integração (mcp_api_keys), nota e comentário que o CLIENTE deu.
//
// Apagar é a única ação com freio: delete_item primeiro mostra o que vai
// sumir; só apaga com confirmado=true, depois de um "sim" na conversa.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const REST = SUPABASE_URL + '/rest/v1/';

/* ── tabelas de Contratos: a RLS exige plano Pro ───────────────── */
const TABELAS_PRO = new Set(['empreiteiros', 'empreitadas', 'work_entries']);

export class AcaoErro extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcaoErro';
  }
}

/* id do profissional = "sub" do JWT. Não precisa validar a assinatura
   aqui: o PostgREST valida, e a RLS compara professional_id com o
   auth.uid() verdadeiro — um sub forjado só faria a gravação falhar. */
export function idDoToken(token: string): string {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(p + '==='.slice((p.length + 3) % 4)));
    return typeof json.sub === 'string' ? json.sub : '';
  } catch {
    return '';
  }
}

function traduzirErro(status: number, corpo: Record<string, unknown> | null, tabela: string): string {
  const code = corpo && typeof corpo.code === 'string' ? corpo.code : '';
  const msg = corpo && typeof corpo.message === 'string' ? corpo.message : '';
  if (code === '42501' || status === 401 || status === 403) {
    return TABELAS_PRO.has(tabela)
      ? 'Contratos (empreiteiros, empreitadas e lançamentos) fazem parte do plano Pro. Sem o Pro não dá pra criar ou mudar isso.'
      : 'sem permissão para isso.';
  }
  if (code === '22P02') return 'id inválido — busque o item com a ferramenta de listar antes.';
  if (code === '23514') return 'valor não aceito pelo app: ' + msg;
  if (code === '23503') return 'esse item está ligado a outro registro e não pode ser removido ou apontado assim.';
  if (code === '23505') return 'já existe um registro igual.';
  if (code === 'P0001' && msg) return msg;
  return msg || ('erro ' + status);
}

/* Chamada ao PostgREST como o profissional. */
export async function rest(
  token: string,
  metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  caminho: string,
  corpo?: unknown,
): Promise<Record<string, unknown>[]> {
  const tabela = caminho.split('?')[0];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(REST + caminho, {
      method: metodo,
      headers: {
        apikey: ANON_KEY,
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: ctrl.signal,
    });
    const texto = await res.text();
    let json: unknown = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { json = null; }
    if (!res.ok) {
      throw new AcaoErro(traduzirErro(res.status, (json as Record<string, unknown>) || null, tabela));
    }
    if (Array.isArray(json)) return json as Record<string, unknown>[];
    return json ? [json as Record<string, unknown>] : [];
  } finally {
    clearTimeout(t);
  }
}

/* ── utilidades ─────────────────────────────────────────────────── */
const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : undefined);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(v: unknown, nome: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!UUID.test(s)) throw new AcaoErro(nome + ' inválido ou ausente — liste primeiro para pegar o id certo.');
  return s;
}
const enc = encodeURIComponent;
function soDefinidos(o: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) if (o[k] !== undefined) out[k] = o[k];
  return out;
}
function umOuErro(rows: Record<string, unknown>[], oQue: string) {
  if (!rows.length) throw new AcaoErro(oQue + ' não encontrado (ou não é seu).');
  return rows[0];
}

/* Período "de hoje" no fuso de Brasília, no formato que a tela de
   Contratos usa (periodo_tipo + periodo_numero + periodo_ano). */
export function hojeBrasil(agora = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(agora).reduce((a: Record<string, string>, x) => { a[x.type] = x.value; return a; }, {});
  return { ano: Number(p.year), mes: Number(p.month), dia: Number(p.day), iso: p.year + '-' + p.month + '-' + p.day };
}
export function periodoAtual(tipo: string, agora = new Date()) {
  const h = hojeBrasil(agora);
  if (tipo === 'dia') return { numero: h.dia, ano: h.ano };
  if (tipo === 'mes') return { numero: h.mes, ano: h.ano };
  if (tipo === 'quinzena') return { numero: (h.mes - 1) * 2 + (h.dia <= 15 ? 1 : 2), ano: h.ano };
  // semana ISO
  const d = new Date(Date.UTC(h.ano, h.mes - 1, h.dia));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const ini = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { numero: Math.ceil(((d.getTime() - ini.getTime()) / 86400000 + 1) / 7), ano: d.getUTCFullYear() };
}

/* ── definições das ferramentas novas (formato da Anthropic) ──────── */
export const TOOLS_ACOES = [
  {
    name: 'update_service_report',
    description:
      'Edita um serviço já registrado: cliente, descrição, local, data, valor, situação do pagamento (marcar como pago ou pendente), ligar a uma obra, ou arquivar/desarquivar. Use para "marca o serviço do João como pago", "o valor era 300", "põe esse serviço na obra da Maria". Não mexe na nota nem no comentário do cliente.',
    input_schema: {
      type: 'object',
      properties: {
        report_id: { type: 'string', description: 'id do serviço (de list_service_reports).' },
        client_name: { type: 'string' },
        service_description: { type: 'string' },
        service_location: { type: 'string' },
        service_date: { type: 'string', description: 'AAAA-MM-DD' },
        valor: { type: 'number', description: 'Valor cobrado em reais.' },
        payment_status: { type: 'string', enum: ['pendente', 'pago'], description: '"pago" quando o cliente já pagou; "pendente" para voltar a cobrar.' },
        obra_id: { type: 'string', description: 'id da obra (de list_obras) para ligar o serviço; string vazia desliga.' },
        arquivar: { type: 'boolean', description: 'true arquiva (some das listas, não apaga); false desarquiva.' },
      },
      required: ['report_id'],
    },
  },
  {
    name: 'update_budget',
    description:
      'Edita um orçamento: dados do cliente, itens (a soma e o total são recalculados), desconto, prazo, validade, pagamento, garantia, observações, situação (pendente, aprovado, recusado, concluido) ou arquivar. Use quando o cliente aprovou por telefone, quando mudou um item, quando terminou o serviço do orçamento.',
    input_schema: {
      type: 'object',
      properties: {
        budget_id: { type: 'string', description: 'id do orçamento (de list_budgets).' },
        titulo: { type: 'string' }, client_name: { type: 'string' }, client_phone: { type: 'string' },
        local: { type: 'string' }, descricao: { type: 'string' },
        items: {
          type: 'array',
          description: 'Lista COMPLETA de itens que substitui a atual. Cada item: descricao e valor.',
          items: { type: 'object', properties: { descricao: { type: 'string' }, valor: { type: 'number' } }, required: ['descricao', 'valor'] },
        },
        desconto: { type: 'number' }, prazo: { type: 'string' }, validade: { type: 'string' },
        pagamento: { type: 'string' }, garantia: { type: 'string' }, observacoes: { type: 'string' },
        status: { type: 'string', enum: ['pendente', 'aprovado', 'recusado', 'concluido'] },
        arquivar: { type: 'boolean' },
      },
      required: ['budget_id'],
    },
  },
  {
    name: 'list_obras',
    description: 'Lista as obras (serviços de vários dias com valor combinado) com quanto já foi lançado em serviços e quanto falta.',
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['andamento', 'concluida', 'todas'], description: 'Padrão: andamento.' } },
    },
  },
  {
    name: 'create_obra',
    description: 'Cria uma obra: um trabalho de vários dias com valor total combinado com o cliente. Cada serviço registrado nela desconta do total. Pode nascer de um orçamento aprovado (use o total dele).',
    input_schema: {
      type: 'object',
      properties: {
        cliente: { type: 'string', description: 'Nome do cliente. Obrigatório.' },
        valor_total: { type: 'number', description: 'Valor total combinado, em reais. Obrigatório, maior que zero.' },
        titulo: { type: 'string', description: 'Ex.: "Reforma do banheiro".' },
        cidade: { type: 'string' },
      },
      required: ['cliente', 'valor_total'],
    },
  },
  {
    name: 'update_obra',
    description: 'Edita uma obra (cliente, título, cidade, valor total) ou muda a situação: "concluida" para encerrar, "andamento" para reabrir.',
    input_schema: {
      type: 'object',
      properties: {
        obra_id: { type: 'string' }, cliente: { type: 'string' }, titulo: { type: 'string' }, cidade: { type: 'string' },
        valor_total: { type: 'number' }, status: { type: 'string', enum: ['andamento', 'concluida'] },
      },
      required: ['obra_id'],
    },
  },
  {
    name: 'list_contratos',
    description:
      'Mostra os contratos do profissional com empreiteiros (quem contrata ele por diária ou empreitada): cada empreiteiro, as empreitadas dele e os últimos lançamentos (diária, semana, quinzena, mês), com quanto está pendente, confirmado e pago. Use antes de lançar ou mudar algo de contrato, para pegar os ids.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_empreiteiro',
    description: 'Cadastra um empreiteiro/contratante (a pessoa ou empresa que contrata o profissional). Recurso do plano Pro.',
    input_schema: {
      type: 'object',
      properties: { nome: { type: 'string', description: 'Obrigatório.' }, telefone: { type: 'string' } },
      required: ['nome'],
    },
  },
  {
    name: 'create_empreitada',
    description:
      'Cria um contrato (empreitada) com um empreiteiro já cadastrado: o que vai ser feito e o valor combinado (total da empreitada, ou o valor da diária quando é por dia). Recurso do plano Pro.',
    input_schema: {
      type: 'object',
      properties: {
        empreiteiro_id: { type: 'string', description: 'id do empreiteiro (de list_contratos ou create_empreiteiro).' },
        descricao: { type: 'string', description: 'Ex.: "Elétrica do prédio da Rua X — diária R$ 200". Obrigatório.' },
        valor_total: { type: 'number', description: 'Valor combinado em reais.' },
      },
      required: ['empreiteiro_id', 'descricao'],
    },
  },
  {
    name: 'update_empreitada',
    description: 'Edita um contrato (empreitada): descrição, valor, ou situação ativa, concluida ou cancelada.',
    input_schema: {
      type: 'object',
      properties: {
        empreitada_id: { type: 'string' }, descricao: { type: 'string' }, valor_total: { type: 'number' },
        status: { type: 'string', enum: ['ativa', 'concluida', 'cancelada'] },
      },
      required: ['empreitada_id'],
    },
  },
  {
    name: 'create_lancamento',
    description:
      'Lança trabalho feito num contrato: uma diária, uma semana, uma quinzena ou um mês, com o valor e o que foi feito (pode incluir horas extras no valor e na descrição). Gera o relatório que o empreiteiro confirma. Se não disser o período, usa o atual (hoje, esta semana, esta quinzena, este mês).',
    input_schema: {
      type: 'object',
      properties: {
        empreitada_id: { type: 'string', description: 'id da empreitada (de list_contratos).' },
        valor: { type: 'number', description: 'Valor do período em reais. Obrigatório.' },
        descricao: { type: 'string', description: 'O que foi feito. Obrigatório.' },
        periodo_tipo: { type: 'string', enum: ['dia', 'semana', 'quinzena', 'mes'], description: 'Padrão: quinzena.' },
        periodo_numero: { type: 'integer', description: 'Dia do mês, número da semana, da quinzena (1 a 24) ou do mês. Se faltar, usa o atual.' },
        periodo_ano: { type: 'integer' },
      },
      required: ['empreitada_id', 'valor', 'descricao'],
    },
  },
  {
    name: 'update_lancamento',
    description: 'Muda um lançamento de contrato: situação (pendente, confirmado pelo empreiteiro, pago), valor ou descrição.',
    input_schema: {
      type: 'object',
      properties: {
        lancamento_id: { type: 'string' }, status: { type: 'string', enum: ['pendente', 'confirmado', 'pago'] },
        valor: { type: 'number' }, descricao: { type: 'string' },
      },
      required: ['lancamento_id'],
    },
  },
  {
    name: 'list_avaliacoes',
    description: 'Lista as avaliações que os clientes deixaram (nota, comentário, quem avaliou) e se o profissional já respondeu.',
    input_schema: { type: 'object', properties: { limit: { type: 'integer', description: 'Padrão 10.' } } },
  },
  {
    name: 'reply_avaliacao',
    description: 'Publica (ou troca) a resposta do profissional a uma avaliação. A resposta aparece no perfil público, abaixo do comentário do cliente. Até 600 caracteres. Texto vazio apaga a resposta.',
    input_schema: {
      type: 'object',
      properties: { avaliacao_id: { type: 'string' }, resposta: { type: 'string' } },
      required: ['avaliacao_id', 'resposta'],
    },
  },
  {
    name: 'list_listas_material',
    description: 'Lista as listas de material do profissional (para comprar ou cotar).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_lista_material',
    description: 'Cria uma lista de material para comprar ou pedir cotação, opcionalmente ligada a um orçamento.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Obrigatório. Ex.: "Material do banheiro da Ana".' },
        local: { type: 'string' },
        budget_id: { type: 'string' },
        observacoes: { type: 'string' },
        itens: {
          type: 'array',
          items: {
            type: 'object',
            properties: { nome: { type: 'string' }, quantidade: { type: 'number' }, unidade: { type: 'string', description: 'un, m, m², kg, saco, rolo...' } },
            required: ['nome', 'quantidade'],
          },
        },
      },
      required: ['titulo', 'itens'],
    },
  },
  {
    name: 'get_resumo_financeiro',
    description: 'Resumo do dinheiro: serviços do mês (cobrado, recebido, a receber), orçamentos aprovados e pendentes, obras em andamento (quanto falta lançar) e contratos (pendente, confirmado e pago).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'delete_item',
    description:
      'Apaga de vez um orçamento, obra, empreiteiro, empreitada, lançamento de contrato ou lista de material. SEMPRE em dois passos: primeiro chame com confirmado=false (ou sem ele) para ver o que vai ser apagado e conte ao profissional; só chame de novo com confirmado=true depois que ele disser que sim NESTA conversa. Serviços registrados não se apagam: arquive com update_service_report.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['orcamento', 'obra', 'empreiteiro', 'empreitada', 'lancamento', 'lista_material'] },
        id: { type: 'string' },
        confirmado: { type: 'boolean' },
      },
      required: ['tipo', 'id'],
    },
  },
];

export const NOMES_ACOES = new Set(TOOLS_ACOES.map((t) => t.name));

/* ── execução ────────────────────────────────────────────────────── */
export async function executarAcao(nome: string, input: Record<string, unknown>, token: string): Promise<unknown> {
  const prof = idDoToken(token);
  if (!prof) throw new AcaoErro('sessão inválida — entre no Fieldo de novo.');

  switch (nome) {
    case 'update_service_report': {
      const rid = id(input.report_id, 'report_id');
      const atual = umOuErro(await rest(token, 'GET', 'reports?id=eq.' + enc(rid) + '&select=id,client_name,valor,payment_status,obra_id,arquivado_em'), 'Serviço');
      const dados: Record<string, unknown> = soDefinidos({
        client_name: txt(input.client_name, 200),
        service_description: txt(input.service_description, 4000),
        service_location: txt(input.service_location, 200),
        service_date: typeof input.service_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.service_date) ? input.service_date : undefined,
      });
      if (num(input.valor) !== undefined) {
        if ((input.valor as number) < 0) throw new AcaoErro('valor não pode ser negativo.');
        dados.valor = r2(input.valor);
        if (atual.payment_status === 'nao_cobrado') dados.payment_status = 'pendente';
      }
      if (input.payment_status === 'pago') {
        if (atual.valor == null && dados.valor === undefined) throw new AcaoErro('esse serviço não tem valor. Informe o valor para marcar como pago.');
        dados.payment_status = 'pago';
        dados.paid_at = new Date().toISOString();
      } else if (input.payment_status === 'pendente') {
        dados.payment_status = 'pendente';
        dados.paid_at = null;
      }
      if (typeof input.obra_id === 'string') dados.obra_id = input.obra_id.trim() ? id(input.obra_id, 'obra_id') : null;
      if (typeof input.arquivar === 'boolean') dados.arquivado_em = input.arquivar ? new Date().toISOString() : null;
      if (!Object.keys(dados).length) throw new AcaoErro('diga o que mudar no serviço.');
      const r = umOuErro(await rest(token, 'PATCH', 'reports?id=eq.' + enc(rid), dados), 'Serviço');
      return {
        ok: true, report_id: r.id, client_name: r.client_name, valor: r.valor, payment_status: r.payment_status,
        obra_id: r.obra_id, arquivado: !!r.arquivado_em,
        antes: { valor: atual.valor, payment_status: atual.payment_status, obra_id: atual.obra_id, arquivado: !!atual.arquivado_em },
      };
    }

    case 'update_budget': {
      const bid = id(input.budget_id, 'budget_id');
      const atual = umOuErro(await rest(token, 'GET', 'budgets?id=eq.' + enc(bid) + '&select=id,status,subtotal,desconto,total,items'), 'Orçamento');
      const dados: Record<string, unknown> = soDefinidos({
        titulo: txt(input.titulo, 200), client_name: txt(input.client_name, 200), client_phone: txt(input.client_phone, 40),
        local: txt(input.local, 200), descricao: txt(input.descricao, 4000), prazo: txt(input.prazo, 200),
        validade: txt(input.validade, 200), pagamento: txt(input.pagamento, 500), garantia: txt(input.garantia, 500),
        observacoes: txt(input.observacoes, 4000),
      });
      let itens = atual.items as unknown;
      if (Array.isArray(input.items)) {
        const lista = (input.items as Record<string, unknown>[]).map((i) => ({ descricao: txt(i.descricao, 300) || '', valor: r2(i.valor) }));
        if (!lista.length || lista.some((i) => !i.descricao || i.valor < 0)) throw new AcaoErro('cada item precisa de descricao e valor (zero ou mais).');
        dados.items = lista;
        itens = lista;
      }
      if (Array.isArray(input.items) || num(input.desconto) !== undefined) {
        const sub = r2((itens as Record<string, unknown>[] || []).reduce((s, i) => s + (Number(i.valor) || 0), 0));
        const desc = num(input.desconto) !== undefined ? r2(input.desconto) : r2(atual.desconto);
        if (desc < 0) throw new AcaoErro('desconto não pode ser negativo.');
        dados.subtotal = sub; dados.desconto = desc; dados.total = r2(Math.max(0, sub - desc));
      }
      if (typeof input.status === 'string') {
        dados.status = input.status;
        if (input.status === 'aprovado' || input.status === 'recusado') dados.approved_at = new Date().toISOString();
      }
      if (typeof input.arquivar === 'boolean') dados.arquivado_em = input.arquivar ? new Date().toISOString() : null;
      if (!Object.keys(dados).length) throw new AcaoErro('diga o que mudar no orçamento.');
      const r = umOuErro(await rest(token, 'PATCH', 'budgets?id=eq.' + enc(bid), dados), 'Orçamento');
      return { ok: true, budget_id: r.id, number: r.number, client_name: r.client_name, total: r.total, status: r.status, arquivado: !!r.arquivado_em,
        antes: { status: atual.status, total: atual.total } };
    }

    case 'list_obras': {
      const st = input.status === 'concluida' ? '&status=eq.concluida' : input.status === 'todas' ? '' : '&status=eq.andamento';
      const obras = await rest(token, 'GET', 'obras?professional_id=eq.' + prof + st + '&order=created_at.desc&limit=30');
      const ids = obras.map((o) => o.id as string);
      const reps = ids.length
        ? await rest(token, 'GET', 'reports?obra_id=in.(' + ids.join(',') + ')&arquivado_em=is.null&select=obra_id,valor')
        : [];
      return {
        obras: obras.map((o) => {
          const lancado = r2(reps.filter((r) => r.obra_id === o.id).reduce((s, r) => s + (Number(r.valor) || 0), 0));
          return { obra_id: o.id, cliente: o.cliente, titulo: o.titulo, cidade: o.cidade, valor_total: o.valor_total,
            lancado, falta: r2(Number(o.valor_total) - lancado), servicos: reps.filter((r) => r.obra_id === o.id).length, status: o.status };
        }),
      };
    }

    case 'create_obra': {
      const cliente = txt(input.cliente, 120);
      const valor = r2(input.valor_total);
      if (!cliente) throw new AcaoErro('informe o nome do cliente.');
      if (!(valor > 0)) throw new AcaoErro('informe o valor total combinado (maior que zero).');
      const r = umOuErro(await rest(token, 'POST', 'obras', soDefinidos({
        professional_id: prof, cliente, valor_total: valor, titulo: txt(input.titulo, 120) || undefined, cidade: txt(input.cidade, 80) || undefined,
      })), 'Obra');
      return { ok: true, obra_id: r.id, cliente: r.cliente, titulo: r.titulo, valor_total: r.valor_total, status: r.status };
    }

    case 'update_obra': {
      const oid = id(input.obra_id, 'obra_id');
      const dados: Record<string, unknown> = soDefinidos({
        cliente: txt(input.cliente, 120), titulo: txt(input.titulo, 120), cidade: txt(input.cidade, 80),
      });
      if (num(input.valor_total) !== undefined) {
        if (!(r2(input.valor_total) > 0)) throw new AcaoErro('o valor total precisa ser maior que zero.');
        dados.valor_total = r2(input.valor_total);
      }
      if (input.status === 'concluida' || input.status === 'andamento') {
        dados.status = input.status;
        dados.concluida_em = input.status === 'concluida' ? new Date().toISOString() : null;
      }
      if (!Object.keys(dados).length) throw new AcaoErro('diga o que mudar na obra.');
      const r = umOuErro(await rest(token, 'PATCH', 'obras?id=eq.' + enc(oid), dados), 'Obra');
      return { ok: true, obra_id: r.id, cliente: r.cliente, titulo: r.titulo, valor_total: r.valor_total, status: r.status };
    }

    case 'list_contratos': {
      const [emps, empr, lanc] = await Promise.all([
        rest(token, 'GET', 'empreiteiros?professional_id=eq.' + prof + '&order=nome.asc'),
        rest(token, 'GET', 'empreitadas?professional_id=eq.' + prof + '&order=created_at.desc'),
        rest(token, 'GET', 'work_entries?professional_id=eq.' + prof + '&order=created_at.desc&limit=60'),
      ]);
      const valorDe = (e: Record<string, unknown>) => Number(e.valor_executado) || Number(e.valor_total_diaria) || 0;
      const soma = (st: string, lista: Record<string, unknown>[]) => r2(lista.filter((e) => e.status === st).reduce((s, e) => s + valorDe(e), 0));
      return {
        empreiteiros: emps.map((em) => {
          const lancDele = lanc.filter((l) => l.empreiteiro_id === em.id);
          return {
            empreiteiro_id: em.id, nome: em.nome, telefone: em.telefone,
            empreitadas: empr.filter((o) => o.empreiteiro_id === em.id).map((o) => ({
              empreitada_id: o.id, descricao: o.descricao, valor_total: o.valor_total, status: o.status,
            })),
            pendente: soma('pendente', lancDele), confirmado: soma('confirmado', lancDele), pago: soma('pago', lancDele),
            ultimos_lancamentos: lancDele.slice(0, 6).map((l) => ({
              lancamento_id: l.id, empreitada_id: l.empreitada_id, periodo: [l.periodo_tipo, l.periodo_numero, l.periodo_ano].filter(Boolean).join(' '),
              valor: valorDe(l), descricao: l.descricao, status: l.status,
            })),
          };
        }),
      };
    }

    case 'create_empreiteiro': {
      const nomeE = txt(input.nome, 120);
      if (!nomeE) throw new AcaoErro('informe o nome do empreiteiro.');
      const r = umOuErro(await rest(token, 'POST', 'empreiteiros', soDefinidos({ professional_id: prof, nome: nomeE, telefone: txt(input.telefone, 40) || undefined })), 'Empreiteiro');
      return { ok: true, empreiteiro_id: r.id, nome: r.nome };
    }

    case 'create_empreitada': {
      const eid = id(input.empreiteiro_id, 'empreiteiro_id');
      const desc = txt(input.descricao, 500);
      if (!desc) throw new AcaoErro('descreva o contrato (o que vai ser feito).');
      const valor = num(input.valor_total) !== undefined ? r2(input.valor_total) : undefined;
      if (valor !== undefined && valor < 0) throw new AcaoErro('valor não pode ser negativo.');
      const r = umOuErro(await rest(token, 'POST', 'empreitadas', soDefinidos({
        professional_id: prof, empreiteiro_id: eid, descricao: desc, valor_total: valor, status: 'ativa',
      })), 'Empreitada');
      return { ok: true, empreitada_id: r.id, descricao: r.descricao, valor_total: r.valor_total, status: r.status };
    }

    case 'update_empreitada': {
      const oid = id(input.empreitada_id, 'empreitada_id');
      const dados: Record<string, unknown> = soDefinidos({ descricao: txt(input.descricao, 500) });
      if (num(input.valor_total) !== undefined) {
        if ((input.valor_total as number) < 0) throw new AcaoErro('valor não pode ser negativo.');
        dados.valor_total = r2(input.valor_total);
      }
      if (['ativa', 'concluida', 'cancelada'].includes(String(input.status))) dados.status = input.status;
      if (!Object.keys(dados).length) throw new AcaoErro('diga o que mudar no contrato.');
      const r = umOuErro(await rest(token, 'PATCH', 'empreitadas?id=eq.' + enc(oid), dados), 'Empreitada');
      return { ok: true, empreitada_id: r.id, descricao: r.descricao, valor_total: r.valor_total, status: r.status };
    }

    case 'create_lancamento': {
      const oid = id(input.empreitada_id, 'empreitada_id');
      const emp = umOuErro(await rest(token, 'GET', 'empreitadas?id=eq.' + enc(oid) + '&select=id,empreiteiro_id,status,descricao'), 'Empreitada');
      const valor = r2(input.valor);
      if (!(valor > 0)) throw new AcaoErro('informe o valor do período (maior que zero).');
      const desc = txt(input.descricao, 2000);
      if (!desc) throw new AcaoErro('descreva o que foi feito no período.');
      const tipo = ['dia', 'semana', 'quinzena', 'mes'].includes(String(input.periodo_tipo)) ? String(input.periodo_tipo) : 'quinzena';
      const atual = periodoAtual(tipo);
      const numero = Number.isInteger(input.periodo_numero) ? Number(input.periodo_numero) : atual.numero;
      const ano = Number.isInteger(input.periodo_ano) ? Number(input.periodo_ano) : atual.ano;
      const r = umOuErro(await rest(token, 'POST', 'work_entries', {
        professional_id: prof, empreitada_id: oid, empreiteiro_id: emp.empreiteiro_id,
        periodo_tipo: tipo, periodo_numero: numero, periodo_ano: ano,
        valor_executado: valor, descricao: desc, status: 'pendente',
      }), 'Lançamento');
      return { ok: true, lancamento_id: r.id, periodo: tipo + ' ' + numero + ' de ' + ano, valor: r.valor_executado, status: r.status,
        aviso: emp.status !== 'ativa' ? 'atenção: essa empreitada não está ativa (' + emp.status + ').' : undefined };
    }

    case 'update_lancamento': {
      const lid = id(input.lancamento_id, 'lancamento_id');
      const dados: Record<string, unknown> = soDefinidos({ descricao: txt(input.descricao, 2000) });
      if (num(input.valor) !== undefined) {
        if (!(r2(input.valor) > 0)) throw new AcaoErro('o valor precisa ser maior que zero.');
        dados.valor_executado = r2(input.valor);
      }
      if (['pendente', 'confirmado', 'pago'].includes(String(input.status))) dados.status = input.status;
      if (!Object.keys(dados).length) throw new AcaoErro('diga o que mudar no lançamento.');
      const r = umOuErro(await rest(token, 'PATCH', 'work_entries?id=eq.' + enc(lid), dados), 'Lançamento');
      return { ok: true, lancamento_id: r.id, valor: r.valor_executado, status: r.status };
    }

    case 'list_avaliacoes': {
      const lim = Math.min(30, Math.max(1, Number(input.limit) || 10));
      const rows = await rest(token, 'GET', 'avaliacoes?professional_id=eq.' + prof + '&order=created_at.desc&limit=' + lim +
        '&select=id,nota,comentario,nome_avaliador_curto,resposta,created_at');
      return { avaliacoes: rows.map((a) => ({ avaliacao_id: a.id, nota: a.nota, comentario: a.comentario, quem: a.nome_avaliador_curto, resposta: a.resposta, data: a.created_at })) };
    }

    case 'reply_avaliacao': {
      const aid = id(input.avaliacao_id, 'avaliacao_id');
      const resp = typeof input.resposta === 'string' ? input.resposta.trim() : '';
      if (resp.length > 600) throw new AcaoErro('a resposta passa de 600 caracteres — encurte.');
      const r = umOuErro(await rest(token, 'PATCH', 'avaliacoes?id=eq.' + enc(aid), { resposta: resp || null }), 'Avaliação');
      return { ok: true, avaliacao_id: r.id, resposta: r.resposta };
    }

    case 'list_listas_material': {
      const rows = await rest(token, 'GET', 'material_listas?professional_id=eq.' + prof + '&order=created_at.desc&limit=20&select=id,titulo,local,status,budget_id,itens,created_at');
      return { listas: rows.map((l) => ({ lista_id: l.id, titulo: l.titulo, local: l.local, status: l.status, budget_id: l.budget_id, itens: Array.isArray(l.itens) ? l.itens.length : 0 })) };
    }

    case 'create_lista_material': {
      const titulo = txt(input.titulo, 160);
      if (!titulo) throw new AcaoErro('dê um título à lista.');
      const itens = Array.isArray(input.itens) ? (input.itens as Record<string, unknown>[]) : [];
      if (!itens.length) throw new AcaoErro('a lista precisa de pelo menos um item.');
      /* mesmo formato que materiais.html grava para item fora do catálogo */
      const out = itens.map((i) => ({
        v: 1, material_id: null, nome_livre: txt(i.nome, 160) || '', ambiente: null,
        quantidade: Number(i.quantidade) > 0 ? Number(i.quantidade) : 1,
        unidade: txt(i.unidade, 20) || 'un', preco_unit: null, preco_fonte: null,
      }));
      if (out.some((i) => !i.nome_livre)) throw new AcaoErro('todo item precisa de nome.');
      const r = umOuErro(await rest(token, 'POST', 'material_listas', soDefinidos({
        professional_id: prof, titulo, local: txt(input.local, 200) || undefined,
        budget_id: typeof input.budget_id === 'string' && input.budget_id.trim() ? id(input.budget_id, 'budget_id') : undefined,
        observacoes: txt(input.observacoes, 2000) || undefined, status: 'rascunho', itens: out,
      })), 'Lista');
      return { ok: true, lista_id: r.id, titulo: r.titulo, itens: out.length };
    }

    case 'get_resumo_financeiro': {
      const h = hojeBrasil();
      const ini = h.iso.slice(0, 8) + '01';
      const [reps, buds, obras, lanc] = await Promise.all([
        rest(token, 'GET', 'reports?professional_id=eq.' + prof + '&arquivado_em=is.null&service_date=gte.' + ini + '&select=valor,payment_status'),
        rest(token, 'GET', 'budgets?professional_id=eq.' + prof + '&arquivado_em=is.null&status=in.(pendente,aprovado)&select=status,total'),
        rest(token, 'GET', 'obras?professional_id=eq.' + prof + '&status=eq.andamento&select=id,valor_total'),
        rest(token, 'GET', 'work_entries?professional_id=eq.' + prof + '&select=status,valor_executado,valor_total_diaria').catch(() => []),
      ]);
      const s = (l: Record<string, unknown>[], f: (x: Record<string, unknown>) => boolean, campo: string) =>
        r2(l.filter(f).reduce((a, x) => a + (Number(x[campo]) || 0), 0));
      const vl = (e: Record<string, unknown>) => Number(e.valor_executado) || Number(e.valor_total_diaria) || 0;
      const ids = obras.map((o) => o.id as string);
      const lancObras = ids.length ? await rest(token, 'GET', 'reports?obra_id=in.(' + ids.join(',') + ')&arquivado_em=is.null&select=valor') : [];
      return {
        mes: h.iso.slice(0, 7),
        servicos_do_mes: {
          quantidade: reps.length,
          cobrado: s(reps, (r) => r.payment_status !== 'nao_cobrado', 'valor'),
          recebido: s(reps, (r) => r.payment_status === 'pago', 'valor'),
          a_receber: s(reps, (r) => r.payment_status === 'pendente', 'valor'),
        },
        orcamentos: { aprovados: s(buds, (b) => b.status === 'aprovado', 'total'), aguardando_resposta: s(buds, (b) => b.status === 'pendente', 'total') },
        obras_em_andamento: { quantidade: obras.length, total_combinado: s(obras, () => true, 'valor_total'), ja_lancado: s(lancObras, () => true, 'valor') },
        contratos: {
          pendente: r2(lanc.filter((e) => e.status === 'pendente').reduce((a, e) => a + vl(e), 0)),
          confirmado_a_receber: r2(lanc.filter((e) => e.status === 'confirmado').reduce((a, e) => a + vl(e), 0)),
          pago: r2(lanc.filter((e) => e.status === 'pago').reduce((a, e) => a + vl(e), 0)),
        },
      };
    }

    case 'delete_item': {
      const mapa: Record<string, { tabela: string; select: string; rotulo: string }> = {
        orcamento: { tabela: 'budgets', select: 'id,number,client_name,total,status', rotulo: 'orçamento' },
        obra: { tabela: 'obras', select: 'id,cliente,titulo,valor_total,status', rotulo: 'obra' },
        empreiteiro: { tabela: 'empreiteiros', select: 'id,nome,telefone', rotulo: 'empreiteiro' },
        empreitada: { tabela: 'empreitadas', select: 'id,descricao,valor_total,status', rotulo: 'empreitada' },
        lancamento: { tabela: 'work_entries', select: 'id,periodo_tipo,periodo_numero,periodo_ano,valor_executado,status,descricao', rotulo: 'lançamento' },
        lista_material: { tabela: 'material_listas', select: 'id,titulo,status', rotulo: 'lista de material' },
      };
      const alvo = mapa[String(input.tipo)];
      if (!alvo) throw new AcaoErro('tipo inválido. Serviços registrados não se apagam: use update_service_report com arquivar=true.');
      const iid = id(input.id, 'id');
      const item = umOuErro(await rest(token, 'GET', alvo.tabela + '?id=eq.' + enc(iid) + '&select=' + alvo.select), alvo.rotulo);
      if (input.confirmado !== true) {
        return { precisa_confirmar: true, vai_apagar: { tipo: alvo.rotulo, ...item },
          instrucao: 'Descreva ao profissional o que será apagado e peça um sim. Só chame de novo com confirmado=true depois do sim.' };
      }
      if (alvo.tabela === 'obras') {
        const ligados = await rest(token, 'GET', 'reports?obra_id=eq.' + enc(iid) + '&select=id&limit=1');
        if (ligados.length) throw new AcaoErro('essa obra tem serviços registrados. Conclua a obra (update_obra status=concluida) em vez de apagar.');
      }
      const r = await rest(token, 'DELETE', alvo.tabela + '?id=eq.' + enc(iid));
      if (!r.length) throw new AcaoErro(alvo.rotulo + ' não encontrado (ou não é seu).');
      return { ok: true, apagado: alvo.rotulo, id: iid };
    }
  }
  throw new AcaoErro('ferramenta desconhecida: ' + nome);
}
