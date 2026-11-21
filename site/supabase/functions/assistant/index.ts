// Fieldo · supabase/functions/assistant/index.ts
//
// v12.40 · CENTRAL DE CRESCIMENTO (auditoria de 18/11). Duas ferramentas
// novas em acoes-crescimento.ts: get_meu_desempenho (Inteligência
// Comercial, lê public.minhas_metricas com a RLS do profissional) e
// analisar_perfil_seo (SEO Autopilot em modo sugestão — não grava; o texto
// sugerido só é salvo com update_my_profile depois do "sim").
//
// Assistente de IA nativo — Fase A (ver Assistente-fieldo-auditoria.md).
// Diferente do `mcp/index.ts` (que serve um Claude de FORA, do próprio
// profissional, falando o protocolo MCP): esta function serve um chat
// que mora DENTRO do Fieldo, chamado pelo próprio app, pago pelo
// Fieldo — não pelo profissional.
//
// Autenticação: sempre a sessão normal do profissional no Fieldo
// (`FIELDO.Session.getAccessToken()`, em db.js) — nunca a chave
// `fmcp_`. Todo pedido chega com `Authorization: Bearer <JWT do
// Supabase Auth>`, e esse token é repassado pro PostgREST como
// `authOverride` — é o que faz `auth.uid()` funcionar do lado das
// funções `mcp_*` e da função de controle de uso.
//
// Custo: cada mensagem do profissional gasta uma "vaga" do plano dele
// (20/mês grátis, 300/mês Pro — ver migration
// 2026-09-10_assistant_fase_a_usage.sql) — checado e debitado ANTES de
// chamar a API da Anthropic, pra nunca gastar um token sequer de uma
// mensagem que já estourou a cota.
//
// v12.18 · auditoria do Fieldo Engenharia (29/10). A chave da Anthropic
// ficou inválida em 16/10 e cada tentativa do profissional gastava uma
// mensagem do plano sem resposta nenhuma. Agora, quando a conversa
// termina em erro (a IA não respondeu), a mensagem é DEVOLVIDA à cota
// pelo servidor (_assistant_refund_usage, executável só com a service
// role — o próprio usuário não consegue se devolver mensagens). E o erro
// de autenticação com a Anthropic vira uma frase que o profissional
// entende, em vez de "invalid x-api-key".
//
// v12.22 · AUTONOMIA (pedido do dono, 31/10). O assistente passa a agir
// em todo o app: contratos com empreiteiro (empreitadas e lançamentos de
// diária/semana/quinzena/mês), obras, editar serviço e marcar como pago,
// editar orçamento e mudar a situação, responder avaliação, lista de
// material e resumo financeiro. As ações novas ficam em acoes.ts e usam
// o JWT do profissional no PostgREST: a RLS decide, como nas telas.
// Dados sensíveis (acesso, contato do perfil, plano/pagamentos, banco/Pix,
// documentos, foto, visibilidade, conta) não têm ferramenta. Apagar exige
// confirmação em dois passos (delete_item).
//
// v12.24 · LOCAÇÃO (decisão do dono, 31/10: "para locadora só destrava com
// o Pro, 50 mensais"). O painel da Locação chama esta mesma function com
// { contexto: 'locacao' }. Muda tudo o que importa: outro prompt, outras
// ferramentas (acoes-locacao.ts), outra cota (_assistant_loc_*, só Pro,
// 50/mês) e outra devolução. As ferramentas do profissional não existem
// nesse modo, e vice-versa.

import { callRpc, RpcError } from './rpc.ts';
import { TOOLS_ACOES, NOMES_ACOES, executarAcao, AcaoErro, rest, hojeBrasil, idDoToken } from './acoes.ts';
import { TOOLS_LOCACAO, NOMES_LOCACAO, executarLocacao } from './acoes-locacao.ts';
import { TOOLS_CRESCIMENTO, NOMES_CRESCIMENTO, executarCrescimento } from './acoes-crescimento.ts';

type Modo = 'profissional' | 'locacao';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const ANTHROPIC_MODEL = 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/* Link público de um orçamento em get_budget/list_budgets.
   v12.18: domínio canônico (antes .netlify.app, que só redirecionava). */
const PUBLIC_BASE_URL = 'https://fieldo-zelo.com.br';

// Limite de idas e vindas entre o Claude e as ferramentas numa ÚNICA
// mensagem do profissional — trava contra loop consumindo tokens.
const MAX_TOOL_ROUNDS = 8;   /* v12.22: era 5 — "cria o contrato e lança a quinzena" são 3 ações + resposta */

const SYSTEM_PROMPT =
  'Você é o assistente do Fieldo, um app usado por profissionais de campo ' +
  '(eletricista, encanador, pintor, pedreiro etc.) pra registrar serviços, montar ' +
  'orçamentos, tocar obras de vários dias, controlar contratos com empreiteiros ' +
  '(diária, semana, quinzena, empreitada), responder avaliações, montar lista de ' +
  'material e cuidar do próprio perfil público. Fale em português do Brasil, direto ' +
  'e simples — o profissional está no meio do trabalho, não tem tempo pra enrolação.\n\n' +
  'AUTONOMIA — você FAZ, não só sugere. Quando o pedido é claro, execute na hora com ' +
  'as ferramentas e depois diga em 1-2 frases o que foi feito. Não peça licença para ' +
  'criar, editar, lançar, marcar como pago, mudar situação, responder avaliação ou ' +
  'mexer no texto do perfil: ele pediu, você faz. Quando precisar de um id (serviço, ' +
  'orçamento, obra, empreiteiro, empreitada, lançamento, avaliação), descubra sozinho ' +
  'com a ferramenta de listar — nunca invente id e nunca peça id ao profissional. Se a ' +
  'busca achar mais de uma opção possível (dois clientes com o mesmo nome, duas ' +
  'empreitadas ativas com o mesmo empreiteiro), pergunte qual em uma frase. Só pergunte ' +
  'quando faltar algo obrigatório que não dá pra descobrir (ex.: o valor). Ao mudar ' +
  'algo, as ferramentas devolvem como estava antes: se ele pedir pra desfazer, use isso. ' +
  'Pedidos com várias etapas (ex.: "cadastra o Juscelino, cria a empreitada da diária de ' +
  '200 e lança a quinzena") você encadeia sozinho, uma ferramenta depois da outra.\n\n' +
  'APAGAR — é a única ação com freio. delete_item sempre em dois passos: primeiro sem ' +
  'confirmado, para ver o que vai sumir; conte em uma frase e pergunte se pode apagar; ' +
  'só chame com confirmado=true depois de um sim dele nesta conversa. Serviço registrado ' +
  'não se apaga, se arquiva.\n\n' +
  'DADOS SENSÍVEIS — você não tem acesso e não altera, mesmo que ele peça: e-mail, senha ' +
  'e código de acesso da conta, WhatsApp e contatos do perfil, plano, assinatura e ' +
  'pagamentos do Fieldo, dados bancários e chave Pix, CPF e CNPJ, foto, se o perfil ' +
  'aparece ou não, excluir a conta, chaves de integração, e a nota ou o comentário que o ' +
  'cliente deu (só a resposta do profissional é dele). Se pedirem, diga em uma frase que ' +
  'por segurança isso só muda na tela do app (Editar perfil ou Configurações) e siga em ' +
  'frente com o resto do pedido.\n\n' +
  'CRESCIMENTO (v12.40) — para "quantas pessoas viram meu perfil", "tá dando resultado", ' +
  '"de onde vêm meus clientes", use get_meu_desempenho e conte o número com calma: no começo ' +
  'é pouco mesmo, e a melhor forma de subir é compartilhar o link do perfil e registrar serviço ' +
  'com foto. Para "melhorar meu perfil", "aparecer no Google", "receber mais clientes", use ' +
  'analisar_perfil_seo e diga em 1-2 frases o que mais pesa. Se propuser um texto novo de bio ' +
  'ou profissão, isso é SUGESTÃO: mostre o texto e pergunte se pode salvar; só chame ' +
  'update_my_profile depois de um sim dele nesta conversa. Nunca invente fato no texto (anos ' +
  'de experiência, certificado, serviço que ele não citou). Exceção: se ele mesmo pediu "escreve ' +
  'minha bio" ou "muda minha profissão para X", aí é pedido direto e você faz na hora.\n\n' +
  'PLANO — Contratos (empreiteiros, empreitadas e lançamentos) são do plano Pro. Se a ' +
  'ferramenta disser que precisa do Pro, explique isso com calma e diga que dá pra ativar ' +
  'em Planos; não tente de novo.\n\n' +
  'FORMATO DA RESPOSTA — a tela mostra sua resposta como texto simples ' +
  '(sem negrito, sem títulos, sem nada clicável) e ela também pode ser ' +
  'lida em voz alta pro profissional. Por isso: nunca use formatação de ' +
  'markdown — sem **negrito**, sem #título, sem `código`, sem listas com ' +
  '- ou • ou emoji como marcador. Escreva como se estivesse falando com a ' +
  'pessoa: frases naturais, e se precisar listar mais de uma coisa, junte ' +
  'numa frase só com vírgula e "e". Sempre comece a resposta com uma ou ' +
  'duas frases curtas dizendo o essencial, no tom de quem está falando — ' +
  'é esse trecho inicial que vira a leitura em voz alta, então ele sozinho ' +
  'já precisa fazer sentido pra quem só ouvir, sem ler o resto. Se o ' +
  'profissional pediu uma análise mais longa ou uma lista de itens, coloque ' +
  'esse detalhe DEPOIS de uma linha em branco, separado do resumo inicial. ' +
  'Nunca escreva um link (URL) dentro do resumo inicial — se for citar um ' +
  'link, diga em palavras que ele está ali ("o link do orçamento tá logo ' +
  'abaixo") e escreva a URL só na parte de detalhe, depois da linha em ' +
  'branco. Valores em reais no jeito brasileiro: R$ 1.250,00.\n\n' +
  'MODO ENTREVISTA — quando o profissional pedir pra você ir perguntando ' +
  'aos poucos (ex.: "me pergunte", "passo a passo", "vai perguntando"), ' +
  'faça UMA pergunta curta de cada vez — nunca uma lista de várias ' +
  'perguntas na mesma mensagem. Comece pelo nome do cliente, depois vá pro ' +
  'que é essencial pro tipo de registro (itens e valor de cada um, se for ' +
  'orçamento; o que foi feito, se for serviço; empreiteiro, período e valor, se ' +
  'for lançamento de contrato). Espere a resposta antes de ' +
  'perguntar a próxima coisa e nunca repita uma pergunta que o ' +
  'profissional já respondeu. Depois do essencial, pode oferecer 1-2 ' +
  'campos extras relevantes (prazo, forma de pagamento, garantia) — mas ' +
  'deixe claro que são opcionais e aceite "pode ser só isso"/"fecha assim" ' +
  'a qualquer momento. No fim da entrevista, crie direto e diga o que criou. ' +
  'Fora do modo entrevista, quando ele já manda tudo de uma vez, crie direto.';

/* v12.24 · prompt da Locação. Mesmo formato de resposta (texto simples,
   lido em voz alta), regras de negócio da locadora. */
const SYSTEM_PROMPT_LOCACAO =
  'Você é o assistente da Locação do Fieldo, usado por locadoras de equipamentos para obra ' +
  '(betoneira, andaime, martelete, compactador, gerador etc.). Fale em português do Brasil, ' +
  'direto e simples — quem usa está no balcão ou no caminhão, sem tempo pra enrolação.\n\n' +
  'AUTONOMIA — você FAZ, não só sugere. Quando o pedido é claro, execute na hora com as ' +
  'ferramentas e depois diga em 1-2 frases o que foi feito: cadastrar ou editar equipamento, ' +
  'mudar preço e caução, registrar aluguel, renovar, mudar datas, dar baixa na devolução e ' +
  'gerar e enviar o contrato. Para achar um equipamento ou um aluguel use loc_equipamentos e ' +
  'loc_locacoes — nunca invente id e nunca peça id ao locador. Se duas opções servirem (dois ' +
  'aluguéis do mesmo cliente, duas betoneiras), pergunte qual em uma frase. Só pergunte quando ' +
  'faltar algo obrigatório que não dá pra descobrir: nome do cliente, qual equipamento, quantos, ' +
  'e as datas. Datas faladas ("amanhã", "segunda", "por 3 dias", "até sexta") você converte com ' +
  'a data de hoje: um aluguel de N diárias devolve N dias depois da saída. O valor sai da diária ' +
  'de cada equipamento; se o locador combinou outro valor, use valor_total. Pedidos com várias ' +
  'etapas ("aluga 2 betoneiras pro Carlos até sexta e manda o contrato") você encadeia sozinho. ' +
  'As ferramentas devolvem como estava antes: se pedirem pra desfazer, use isso.\n\n' +
  'ESTOQUE — nunca prometa equipamento sem conferir. loc_nova_locacao e loc_alterar_locacao já ' +
  'conferem as unidades livres no período, contando reservas e aluguéis atrasados; se voltar ' +
  'indisponivel, nada foi gravado: diga o que falta e sugira outra data ou quantidade. Para ' +
  '"tem betoneira livre semana que vem?" use loc_disponibilidade.\n\n' +
  'CONTRATO — "manda o contrato", "gera o contrato" = loc_contrato com acao enviar. Se voltar ' +
  'precisa_completar: as condições que faltam (forma de pagamento, local de devolução, cobrança ' +
  'por atraso, tolerância, cancelamento, foro) pergunte ao locador, de uma vez numa frase, e ' +
  'chame de novo com condicoes; quando ele responder, pergunte uma vez se quer que os próximos ' +
  'contratos já saiam com essas condições (salvar_condicoes_no_modelo). CPF ou CNPJ que faltar ' +
  'ou estiver errado: diga que o locador completa na tela da locação, por segurança. Quando sair ' +
  'o link, diga no resumo que o link e o botão de WhatsApp estão logo abaixo — a tela mostra os dois ' +
  'sozinha, então NÃO escreva nenhuma URL nessa resposta. Depois ' +
  'que o cliente assinar, a locadora assina com o dedo na tela de Contratos — você nunca assina ' +
  'por ela.\n\n' +
  'CANCELAR — loc_cancelar_locacao sempre em dois passos: primeiro sem confirmado, conte o que ' +
  'vai ser cancelado e peça um sim; só chame com confirmado=true depois do sim nesta conversa.\n\n' +
  'DADOS SENSÍVEIS — você não tem acesso e não altera, mesmo que peçam: CPF, CNPJ ou RG de ' +
  'cliente e da locadora, chave Pix e dados bancários, e-mail e senha, plano e pagamento do ' +
  'Fieldo, fotos e laudos de vistoria, a avaliação que o cliente deu, os dados da locadora no ' +
  'perfil (nome, endereço, WhatsApp) e excluir a conta. Se pedirem, diga em uma frase que por ' +
  'segurança isso é na tela do painel e siga com o resto do pedido.\n\n' +
  'FORMATO DA RESPOSTA — a tela mostra sua resposta como texto simples e ela pode ser lida em ' +
  'voz alta. Nunca use markdown: sem **negrito**, sem #título, sem `código`, sem listas com - ou ' +
  '• ou emoji como marcador. Escreva como quem fala: se precisar listar, junte numa frase com ' +
  'vírgula e "e". Comece com uma ou duas frases curtas com o essencial, que façam sentido ' +
  'sozinhas para quem só ouvir. Detalhes, listas longas e links vão DEPOIS de uma linha em ' +
  'branco; nunca escreva URL no resumo inicial. Valores no jeito brasileiro: R$ 1.250,00. ' +
  'Datas como 05/11.\n\n' +
  'MODO ENTREVISTA — se o locador pedir pra você ir perguntando ("me pergunte", "passo a ' +
  'passo"), faça UMA pergunta curta por vez: cliente, depois equipamento e quantidade, depois ' +
  'datas. No fim, registre direto e diga o que registrou.';

/* Tools — mesmas descrições do mcp/index.ts, no formato da Anthropic. */
const TOOLS = [
  {
    name: 'create_budget',
    description:
      'Cria um orçamento pro profissional autenticado — o mesmo que a tela "Novo orçamento" do app Fieldo. O orçamento criado já nasce pronto pra enviar: a resposta traz um link público que o cliente pode abrir pra ver os itens e aprovar ou recusar. Use quando o profissional pedir pra montar um orçamento pra um cliente.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'Nome do cliente. Obrigatório.' },
        items: {
          type: 'array',
          description:
            'Lista de itens do orçamento — pelo menos um item é obrigatório. Cada item precisa ter "descricao" (texto) e "valor" (número, em reais).',
          items: {
            type: 'object',
            properties: {
              descricao: { type: 'string' },
              valor: { type: 'number' },
            },
            required: ['descricao', 'valor'],
          },
        },
        titulo: { type: 'string', description: 'Título/assunto do orçamento. Opcional.' },
        client_phone: { type: 'string', description: 'WhatsApp/telefone do cliente. Opcional.' },
        local: { type: 'string', description: 'Local do serviço. Opcional.' },
        descricao: { type: 'string', description: 'Descrição geral do orçamento. Opcional.' },
        desconto: { type: 'number', description: 'Desconto, em reais, sobre a soma dos itens. Opcional.' },
        prazo: { type: 'string', description: 'Prazo de execução. Opcional.' },
        validade: { type: 'string', description: 'Validade da proposta. Opcional.' },
        pagamento: { type: 'string', description: 'Condições de pagamento. Opcional.' },
        garantia: { type: 'string', description: 'Garantia oferecida. Opcional.' },
        observacoes: { type: 'string', description: 'Observações gerais. Opcional.' },
      },
      required: ['client_name', 'items'],
    },
  },
  {
    name: 'create_service_report',
    description:
      'Registra um serviço que o profissional acabou de prestar a um cliente — o mesmo que a tela "Novo serviço" do app Fieldo. Use quando o profissional contar que terminou um trabalho. A resposta já traz o suficiente pra pedir uma avaliação do cliente, se o profissional quiser.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'Nome do cliente. Obrigatório.' },
        service_description: { type: 'string', description: 'O que foi feito no serviço.' },
        category_key: { type: 'string', description: 'Categoria do serviço, ex.: "eletrica", "hidraulica", "pintura".' },
        service_location: { type: 'string', description: 'Cidade ou local onde o serviço foi feito.' },
        valor: { type: 'number', description: 'Valor cobrado, em reais. Opcional.' },
        service_date: { type: 'string', description: 'Data do serviço, formato AAAA-MM-DD. Se não informado, usa hoje.' },
        obra_id: { type: 'string', description: 'id da obra (de list_obras) quando o serviço faz parte de uma obra — o valor desconta do total dela. Opcional.' },
      },
      required: ['client_name'],
    },
  },
  {
    name: 'list_service_reports',
    description: 'Lista os relatórios de serviço mais recentes do profissional autenticado, do mais novo para o mais antigo.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Quantos relatórios trazer. Padrão 5, máximo 50.' },
      },
    },
  },
  {
    name: 'get_service_report',
    description: 'Busca um relatório de serviço específico do profissional autenticado pelo id dele. Só encontra relatórios do próprio profissional. A resposta traz se o cliente já avaliou ou não, e o suficiente pra pedir a avaliação se ainda não avaliou.',
    input_schema: {
      type: 'object',
      properties: {
        report_id: { type: 'string', description: 'id (uuid) do relatório — vem do retorno de create_service_report ou list_service_reports.' },
      },
      required: ['report_id'],
    },
  },
  {
    name: 'get_account_usage',
    description: 'Mostra o plano do profissional, quantos relatórios de serviço já criou este mês, e quantos ainda pode criar.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_my_profile',
    description: 'Mostra o perfil do próprio profissional autenticado: nome, profissão, cidade, contato, se o perfil é público, plano etc.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'update_my_profile',
    description:
      'Edita o texto do perfil PÚBLICO do próprio profissional autenticado — útil para melhorar a descrição para SEO/Google. Só mexe em nome, profissão, nicho, bio e cidade; não mexe em contato (WhatsApp/Instagram), pagamento, foto, nem se o perfil está visível ou não. Mande só os campos que quer mudar — os outros continuam como estão. A resposta traz o texto de antes, para desfazer se ele pedir. Quando ele pedir para você escrever a bio, escreva e já salve, e depois leia em voz alta o que ficou.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome do profissional. Opcional — só muda se for enviado.' },
        profissao: { type: 'string', description: 'Profissão/especialidade principal, ex.: "Eletricista Residencial". Opcional.' },
        niche: { type: 'string', description: 'Nicho/categoria de serviço. Opcional.' },
        bio: { type: 'string', description: 'Descrição curta do profissional (até 1000 caracteres) — o texto que mais ajuda no SEO. Opcional.' },
        city: { type: 'string', description: 'Cidade onde atua. Opcional.' },
      },
    },
  },
  {
    name: 'get_public_profile',
    description:
      'Busca o perfil PÚBLICO de um profissional pelo slug (o mesmo endereço de fieldo.../p/<slug>) — o mesmo dado que qualquer pessoa vê sem login. Use para consultar outro profissional, não o próprio (pra ver o próprio, use get_my_profile).',
    input_schema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'O slug do perfil público, ex.: "eletrica-caraguatatuba-pqwj".' },
      },
      required: ['slug'],
    },
  },
  {
    name: 'list_budgets',
    description: 'Lista os orçamentos mais recentes do profissional autenticado, do mais novo para o mais antigo.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Quantos orçamentos trazer. Padrão 5, máximo 50.' },
      },
    },
  },
  {
    name: 'get_budget',
    description: 'Busca um orçamento específico do profissional autenticado pelo id dele, incluindo o link público pra mandar pro cliente. Só encontra orçamentos do próprio profissional.',
    input_schema: {
      type: 'object',
      properties: {
        budget_id: { type: 'string', description: 'id (uuid) do orçamento.' },
      },
      required: ['budget_id'],
    },
  },
  ...TOOLS_CRESCIMENTO,   /* v12.40 · Central de Crescimento (acoes-crescimento.ts) */
  ...TOOLS_ACOES,
];
/* prompt caching: as definições das ferramentas são grandes e iguais em
   toda chamada — marcadas para cache, custam ~10% nas chamadas seguintes. */
(TOOLS[TOOLS.length - 1] as Record<string, unknown>).cache_control = { type: 'ephemeral' };

/* Locação: cópia rasa da lista para marcar o cache sem mexer no módulo */
const TOOLS_LOC = TOOLS_LOCACAO.map((t) => ({ ...t })) as Array<Record<string, unknown>>;
TOOLS_LOC[TOOLS_LOC.length - 1].cache_control = { type: 'ephemeral' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1].trim() : null;
}

function publicBudgetUrl(id: unknown, approvalToken: unknown): string | null {
  if (typeof id !== 'string' || !id) return null;
  let url = PUBLIC_BASE_URL + '/relatorio.html?orc=' + encodeURIComponent(id);
  if (typeof approvalToken === 'string' && approvalToken) {
    url += '&t=' + encodeURIComponent(approvalToken);
  }
  return url;
}

/* includeLink só true em get_budget (um orçamento só) — em list_budgets
   fica de fora pra não devolver vários tokens de aprovação de uma vez. */
function budgetSummary(row: Record<string, unknown>, includeLink: boolean) {
  return {
    budget_id: row.id,
    number: row.number,
    titulo: row.titulo,
    client_name: row.client_name,
    client_phone: row.client_phone,
    local: row.local,
    descricao: row.descricao,
    items: row.items,
    subtotal: row.subtotal,
    desconto: row.desconto,
    total: row.total,
    prazo: row.prazo,
    validade: row.validade,
    pagamento: row.pagamento,
    garantia: row.garantia,
    observacoes: row.observacoes,
    status: row.status,
    emissao: row.emissao,
    created_at: row.created_at,
    ...(includeLink ? { link_publico: publicBudgetUrl(row.id, row.approval_token) } : {}),
  };
}

async function executeTool(name: string, input: Record<string, unknown>, token: string, modo: Modo = 'profissional'): Promise<string> {
  try {
    /* cada modo só executa as próprias ferramentas */
    if (modo === 'locacao') {
      if (!NOMES_LOCACAO.has(name)) return JSON.stringify({ erro: 'ferramenta indisponível na Locação: ' + name });
      return JSON.stringify(await executarLocacao(name, input, token));
    }
    if (NOMES_LOCACAO.has(name)) return JSON.stringify({ erro: 'ferramenta indisponível aqui: ' + name });
    if (NOMES_ACOES.has(name)) {
      return JSON.stringify(await executarAcao(name, input, token));
    }
    if (NOMES_CRESCIMENTO.has(name)) {
      return JSON.stringify(await executarCrescimento(name, input, token));
    }
    if (name === 'create_budget') {
      const items = Array.isArray(input.items) ? input.items : null;
      if (!items || items.length === 0) {
        return JSON.stringify({ erro: 'items é obrigatório: pelo menos um item, com descricao e valor.' });
      }
      const row = await callRpc('mcp_create_budget', {
        p_raw_key: null,
        p_client_name: typeof input.client_name === 'string' ? input.client_name : '',
        p_items: items,
        p_titulo: typeof input.titulo === 'string' ? input.titulo : null,
        p_client_phone: typeof input.client_phone === 'string' ? input.client_phone : null,
        p_local: typeof input.local === 'string' ? input.local : null,
        p_descricao: typeof input.descricao === 'string' ? input.descricao : null,
        p_desconto: typeof input.desconto === 'number' ? input.desconto : null,
        p_prazo: typeof input.prazo === 'string' ? input.prazo : null,
        p_validade: typeof input.validade === 'string' ? input.validade : null,
        p_pagamento: typeof input.pagamento === 'string' ? input.pagamento : null,
        p_garantia: typeof input.garantia === 'string' ? input.garantia : null,
        p_observacoes: typeof input.observacoes === 'string' ? input.observacoes : null,
        p_emissao: null,
        p_number: null,
        p_idempotency_key: null,
      }, token) as Record<string, unknown>;
      return JSON.stringify({
        budget_id: row.id,
        number: row.number,
        client_name: row.client_name,
        client_phone: row.client_phone,
        total: row.total,
        link_publico: publicBudgetUrl(row.id, row.approval_token),
      });
    }

    if (name === 'create_service_report') {
      const row = await callRpc('mcp_create_service_report', {
        p_raw_key: null,
        p_client_name: typeof input.client_name === 'string' ? input.client_name : '',
        p_service_description: typeof input.service_description === 'string' ? input.service_description : null,
        p_category_key: typeof input.category_key === 'string' ? input.category_key : null,
        p_niche: null,
        p_service_location: typeof input.service_location === 'string' ? input.service_location : null,
        p_valor: typeof input.valor === 'number' ? input.valor : null,
        p_service_date: typeof input.service_date === 'string' ? input.service_date : null,
      }, token) as Record<string, unknown>;
      let obraLigada: unknown = null;
      if (typeof input.obra_id === 'string' && input.obra_id.trim() && row.id) {
        try {
          const lig = await rest(token, 'PATCH', 'reports?id=eq.' + encodeURIComponent(String(row.id)), { obra_id: input.obra_id.trim() });
          obraLigada = lig[0] ? lig[0].obra_id : null;
        } catch (e) {
          obraLigada = 'não consegui ligar à obra: ' + (e instanceof Error ? e.message : String(e));
        }
      }
      return JSON.stringify({
        report_id: row.id,
        client_name: row.client_name,
        created_at: row.created_at,
        rating_token: row.rating_token,
        ...(obraLigada !== null ? { obra_id: obraLigada } : {}),
      });
    }

    if (name === 'list_service_reports') {
      const limit = typeof input.limit === 'number' ? input.limit : undefined;
      const rows = await callRpc('mcp_list_service_reports', { p_raw_key: null, p_limit: limit ?? 5 }, token) as Record<string, unknown>[];
      return JSON.stringify({
        reports: rows.map((r) => ({
          report_id: r.id,
          client_name: r.client_name,
          service_description: r.service_description,
          category_key: r.category_key,
          service_location: r.service_location,
          service_date: r.service_date,
          valor: r.valor,
          created_at: r.created_at,
        })),
      });
    }

    if (name === 'get_service_report') {
      const reportId = typeof input.report_id === 'string' ? input.report_id.trim() : '';
      if (!reportId) {
        return JSON.stringify({ erro: 'report_id é obrigatório.' });
      }
      const row = await callRpc('mcp_get_service_report', { p_raw_key: null, p_report_id: reportId }, token) as Record<string, unknown>;
      return JSON.stringify({
        report_id: row.id,
        client_name: row.client_name,
        service_description: row.service_description,
        category_key: row.category_key,
        service_location: row.service_location,
        service_date: row.service_date,
        valor: row.valor,
        payment_status: row.payment_status,
        rating: row.rating,
        rating_comment: row.rating_comment,
        created_at: row.created_at,
        rating_used: row.rating_used,
        rating_token: row.rating_used ? null : row.rating_token,
      });
    }

    if (name === 'get_account_usage') {
      const rows = await callRpc('mcp_get_account_usage', { p_raw_key: null }, token) as
        Record<string, unknown>[] | Record<string, unknown>;
      const row = Array.isArray(rows) ? rows[0] : rows;
      return JSON.stringify(row);
    }

    if (name === 'get_my_profile') {
      const row = await callRpc('mcp_get_my_profile', { p_raw_key: null }, token) as Record<string, unknown>;
      return JSON.stringify({
        name: row.name,
        profissao: row.profissao,
        specialty: row.specialty,
        niche: row.niche,
        city: row.city,
        slug: row.slug,
        whatsapp: row.whatsapp,
        bio: row.bio,
        plan: row.plan,
        is_public: row.is_public,
        portfolio_publico: row.portfolio_publico,
      });
    }

    if (name === 'update_my_profile') {
      const camposEnviados = ['name', 'profissao', 'niche', 'bio', 'city'].filter(
        (k) => typeof input[k] === 'string',
      );
      if (camposEnviados.length === 0) {
        return JSON.stringify({ erro: 'informe pelo menos um campo pra mudar: name, profissao, niche, bio ou city.' });
      }
      let antes: Record<string, unknown> | null = null;
      try { antes = await callRpc('mcp_get_my_profile', { p_raw_key: null }, token) as Record<string, unknown>; } catch { antes = null; }
      const row = await callRpc('mcp_update_my_profile', {
        p_raw_key: null,
        p_name: typeof input.name === 'string' ? input.name : null,
        p_profissao: typeof input.profissao === 'string' ? input.profissao : null,
        p_niche: typeof input.niche === 'string' ? input.niche : null,
        p_bio: typeof input.bio === 'string' ? input.bio : null,
        p_city: typeof input.city === 'string' ? input.city : null,
      }, token) as Record<string, unknown>;
      return JSON.stringify({
        name: row.name,
        profissao: row.profissao,
        niche: row.niche,
        city: row.city,
        bio: row.bio,
        slug: row.slug,
        antes: antes ? Object.fromEntries(camposEnviados.map((k) => [k, antes![k]])) : null,
      });
    }

    if (name === 'get_public_profile') {
      const slug = typeof input.slug === 'string' ? input.slug.trim() : '';
      if (!slug) {
        return JSON.stringify({ erro: 'slug é obrigatório.' });
      }
      const rows = await callRpc('mcp_get_public_profile', { p_slug: slug }, token) as
        Record<string, unknown>[] | Record<string, unknown>;
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) {
        return JSON.stringify({ erro: 'nenhum profissional público encontrado com esse slug.' });
      }
      return JSON.stringify(row);
    }

    if (name === 'list_budgets') {
      const limit = typeof input.limit === 'number' ? input.limit : undefined;
      const rows = await callRpc('mcp_list_budgets', { p_raw_key: null, p_limit: limit ?? 5 }, token) as Record<string, unknown>[];
      return JSON.stringify({ budgets: rows.map((r) => budgetSummary(r, false)) });
    }

    if (name === 'get_budget') {
      const budgetId = typeof input.budget_id === 'string' ? input.budget_id.trim() : '';
      if (!budgetId) {
        return JSON.stringify({ erro: 'budget_id é obrigatório.' });
      }
      const row = await callRpc('mcp_get_budget', { p_raw_key: null, p_budget_id: budgetId }, token) as Record<string, unknown>;
      return JSON.stringify(budgetSummary(row, true));
    }

    return JSON.stringify({ erro: 'ferramenta desconhecida: ' + name });
  } catch (e) {
    if (e instanceof RpcError || e instanceof AcaoErro) {
      return JSON.stringify({ erro: e.message });
    }
    console.error('[assistant] erro inesperado executando tool', name, e);
    return JSON.stringify({ erro: 'erro interno ao executar a ação. Tente de novo em instantes.' });
  }
}

/* Erro da Anthropic com o status HTTP junto, para saber se foi a chave
   (401/403), excesso de uso (429/529) ou outra coisa. */
class AnthropicError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AnthropicError';
    this.status = status;
  }
}

/* Data de hoje no fuso de Brasília: sem isso "lança a quinzena" ou "o
   serviço de ontem" viram chute. Fica fora do bloco em cache. */
function contextoDeHoje(): string {
  const h = hojeBrasil();
  const semana = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' }).format(new Date());
  const quinzena = (h.mes - 1) * 2 + (h.dia <= 15 ? 1 : 2);
  return 'Hoje é ' + semana + ', ' + String(h.dia).padStart(2, '0') + '/' + String(h.mes).padStart(2, '0') + '/' + h.ano +
    ' (fuso de Brasília). Para contratos: estamos na quinzena ' + quinzena + ' de ' + h.ano +
    ' (' + (h.dia <= 15 ? '1ª' : '2ª') + ' quinzena do mês).';
}

/* Locação: hoje e os próximos 7 dias com o dia da semana, para "até
   sexta" virar data certa sem conta de cabeça. */
function contextoDeHojeLocacao(agora = new Date()): string {
  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const dias: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(agora.getTime() + i * 86400000);
    dias.push(fmt.format(d) + ' = ' + hojeBrasil(d).iso);
  }
  return 'Hoje é ' + fmt.format(agora) + ' (fuso de Brasília), data ' + hojeBrasil(agora).iso + '. Próximos dias: ' + dias.join('; ') + '.';
}

async function callAnthropic(messages: unknown[], modo: Modo = 'profissional'): Promise<Record<string, unknown>> {
  if (!ANTHROPIC_API_KEY) {
    throw new AnthropicError('ANTHROPIC_API_KEY não configurada neste projeto.', 401);
  }
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system: [
        { type: 'text', text: modo === 'locacao' ? SYSTEM_PROMPT_LOCACAO : SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: modo === 'locacao' ? contextoDeHojeLocacao() : contextoDeHoje() },
      ],
      tools: modo === 'locacao' ? TOOLS_LOC : TOOLS,
      messages,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error('[assistant] erro da API da Anthropic', res.status, body);
    throw new AnthropicError((body && body.error && body.error.message) || ('Erro da API da Anthropic (HTTP ' + res.status + ')'), res.status);
  }
  return body;
}

/* Devolve a mensagem à cota do profissional. Só o servidor consegue:
   _assistant_refund_usage é executável apenas pela service role. O id
   vem do próprio token (nunca do corpo do pedido). Falha aqui não pode
   esconder o erro original — só fica registrada no log. */
/* v12.22 · o id sai do próprio JWT (o gateway já validou a assinatura:
   verify_jwt=true). Antes passava por /auth/v1/user, e quando essa
   chamada falhava a devolução era abandonada sem log — o Jhuan ficou
   com 4 mensagens descontadas em 30/10 por respostas que nunca vieram. */
async function devolverMensagem(token: string, modo: Modo = 'profissional'): Promise<boolean> {
  try {
    const prof = idDoToken(token);
    if (!prof) { console.error('[assistant] devolução da cota: token sem sub'); return false; }
    const fn = modo === 'locacao' ? '_assistant_loc_refund_usage' : '_assistant_refund_usage';
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(modo === 'locacao' ? { p_loc: prof } : { p_prof: prof }),
    });
    if (!r.ok) console.error('[assistant] devolução da cota falhou', r.status, (await r.text()).slice(0, 200));
    return r.ok;
  } catch (e) {
    console.error('[assistant] devolução da cota falhou', e);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return jsonResponse({ erro: 'use POST' }, 405);
  }

  const token = getBearerToken(req);
  if (!token) {
    return jsonResponse({ erro: 'não autenticado — faça login no Fieldo antes de usar o assistente.' }, 401);
  }

  let body: { message?: string; history?: Array<{ role: string; content: unknown }>; contexto?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ erro: 'JSON inválido no corpo da requisição.' }, 400);
  }

  const userMessage = typeof body.message === 'string' ? body.message.trim() : '';
  if (!userMessage) {
    return jsonResponse({ erro: 'message é obrigatório.' }, 400);
  }
  const history = Array.isArray(body.history) ? body.history : [];
  const modo: Modo = body.contexto === 'locacao' ? 'locacao' : 'profissional';

  /* Locação: só com o plano Pro. Confere antes da cota para a tela poder
     mostrar o cartão do Pro em vez de um erro (a função da cota confere
     de novo no banco — esta checagem é só para a resposta sair clara). */
  if (modo === 'locacao') {
    try {
      const loc = await rest(token, 'GET', 'locadoras?id=eq.' + encodeURIComponent(idDoToken(token)) + '&select=plan,plan_expires_at');
      if (!loc.length) return jsonResponse({ erro: 'Esta conta não tem uma locadora cadastrada.' }, 403);
      const exp = loc[0].plan_expires_at ? Date.parse(String(loc[0].plan_expires_at)) : NaN;
      if (loc[0].plan !== 'pro' || (!isNaN(exp) && exp < Date.now())) {
        return jsonResponse({ erro: 'O assistente da Locação faz parte do plano Pro.', precisa_pro: true }, 403);
      }
    } catch (e) {
      console.error('[assistant] erro conferindo o plano da locadora', e);
      return jsonResponse({ erro: 'Não deu para conferir o seu plano agora. Tente de novo em instantes.' }, 500);
    }
  }

  // Débito da cota ANTES de gastar qualquer token.
  let usage: { mensagens_restantes: number; limite: number } | null = null;
  try {
    const rows = await callRpc(modo === 'locacao' ? '_assistant_loc_check_and_bump_usage' : '_assistant_check_and_bump_usage', {}, token) as
      Record<string, unknown>[] | Record<string, unknown>;
    const row = Array.isArray(rows) ? rows[0] : rows;
    usage = {
      mensagens_restantes: Number(row.mensagens_restantes),
      limite: Number(row.limite),
    };
  } catch (e) {
    if (e instanceof RpcError) {
      if (modo === 'locacao' && (e.status === 404 || /could not find|does not exist/i.test(e.message))) {
        console.error('[assistant] cota da Locação sem migration', e.message);
        return jsonResponse({ erro: 'O assistente da Locação ainda está sendo ligado. Tente de novo mais tarde.' }, 503);
      }
      if (modo === 'locacao' && /plano Pro/.test(e.message)) {
        return jsonResponse({ erro: e.message, precisa_pro: true }, 403);
      }
      return jsonResponse({ erro: e.message }, 429);
    }
    console.error('[assistant] erro inesperado checando cota', e);
    return jsonResponse({ erro: 'erro interno ao checar seu uso do assistente.' }, 500);
  }

  const messages: Array<{ role: string; content: unknown }> = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  try {
    let rounds = 0;
    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      const response = await callAnthropic(messages, modo);
      const content = (response.content as Array<Record<string, unknown>>) || [];

      messages.push({ role: 'assistant', content });

      if (response.stop_reason !== 'tool_use') {
        const textBlock = content.find((b) => b.type === 'text');
        const text = textBlock && typeof textBlock.text === 'string' ? textBlock.text : '';
        return jsonResponse({ reply: text, history: messages, usage });
      }

      const toolResults: Array<Record<string, unknown>> = [];
      for (const block of content) {
        if (block.type !== 'tool_use') continue;
        const resultText = await executeTool(
          String(block.name),
          (block.input as Record<string, unknown>) || {},
          token,
          modo,
        );
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultText });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    const devolvida = await devolverMensagem(token, modo);
    return jsonResponse({
      erro: 'a conversa ficou grande demais numa mensagem só — tente pedir de um jeito mais direto.' +
        (devolvida ? ' Esta mensagem não foi descontada do seu limite.' : ''),
    }, 400);
  } catch (e) {
    console.error('[assistant] erro inesperado no loop de conversa', e);
    const devolvida = await devolverMensagem(token, modo);
    const nota = devolvida ? ' Esta mensagem não foi descontada do seu limite.' : '';
    if (e instanceof AnthropicError && (e.status === 401 || e.status === 403)) {
      return jsonResponse({ erro: 'O assistente está fora do ar no momento. Já estamos resolvendo.' + nota }, 503);
    }
    if (e instanceof AnthropicError && (e.status === 429 || e.status === 529 || e.status >= 500)) {
      return jsonResponse({ erro: 'O assistente está sobrecarregado agora. Tente de novo em alguns minutos.' + nota }, 503);
    }
    return jsonResponse({ erro: 'Não foi possível responder agora. Tente de novo em instantes.' + nota }, 500);
  }
});
