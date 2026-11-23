// Fieldo · supabase/functions/assistant/acoes-crescimento.ts
//
// v12.40 · Central de Crescimento como FERRAMENTAS do assistente, não como
// agente novo (auditoria de 18/11, seções 4 e 8). Duas entregas:
//
//   get_meu_desempenho   Inteligência Comercial — quantas pessoas viram o
//                        perfil e chamaram no WhatsApp, e de onde vieram.
//                        Lê public.minhas_metricas(), SECURITY INVOKER: a
//                        RLS de impact_events decide. Total para todos,
//                        detalhe só no Pro (a função SQL é quem corta).
//
//   analisar_perfil_seo  SEO Autopilot, modo SUGESTÃO. Checagem
//                        determinística do perfil contra as MESMAS regras
//                        que as edge functions de SEO usam para indexar
//                        (3 serviços confirmados, ou bio + 6 fotos). Não
//                        grava nada. O texto sugerido é escrito pelo modelo
//                        e só é salvo com update_my_profile DEPOIS de um
//                        "sim" do profissional (regra no prompt).
//
// Nenhuma das duas escreve no banco nem toca em dado sensível.

import { rest, idDoToken, AcaoErro } from './acoes.ts';
import { callRpc } from './rpc.ts';

/* mesmos pisos de netlify/edge-functions/lista-local.ts e perfil-seo.ts */
const MIN_SERVICOS = 3;
const MIN_FOTOS_SEM_SERVICO = 6;
const BIO_MIN = 180;   /* abaixo disto a bio vira snippet fraco no Google */
const BIO_MAX = 1000;  /* limite de mcp_update_my_profile */

export const TOOLS_CRESCIMENTO = [
  {
    name: 'get_meu_desempenho',
    description:
      'Mostra como o perfil público do profissional está indo: quantas pessoas viram o perfil e quantas chamaram no WhatsApp nos últimos dias. No plano Pro também mostra de onde vieram (Google, Instagram/Facebook, busca do Fieldo, link direto), o dia a dia e a comparação com o período anterior. Use quando ele perguntar "quantas pessoas viram meu perfil", "tá dando resultado?", "de onde vêm meus clientes" e parecidos. Com poucas visitas, diga isso com calma — número baixo no começo é normal, não é fracasso.',
    input_schema: {
      type: 'object',
      properties: {
        dias: { type: 'integer', description: 'Janela em dias: 7, 30 ou 90. Padrão 30.' },
      },
    },
  },
  {
    name: 'analisar_perfil_seo',
    description:
      'Analisa o perfil público do profissional para aparecer melhor no Google e na busca do Fieldo: confere bio, profissão, cidade, cidades atendidas, serviços confirmados e fotos de trabalho contra as regras que o Fieldo usa para indexar a página. NÃO salva nada. Use quando ele pedir para melhorar o perfil, aparecer mais no Google ou receber mais clientes. Depois, proponha o texto novo e só salve com update_my_profile se ele disser que sim.',
    input_schema: { type: 'object', properties: {} },
  },
];

export const NOMES_CRESCIMENTO = new Set(TOOLS_CRESCIMENTO.map((t) => t.name));

const ROTULO_ORIGEM: Record<string, string> = {
  google: 'Google',
  organico: 'outros buscadores',
  meta: 'Instagram/Facebook',
  explorar: 'busca do Fieldo',
  home: 'página inicial do Fieldo',
  lista_local: 'lista de profissionais da cidade',
  relatorio: 'relatório de serviço enviado ao cliente',
  direto: 'link direto (WhatsApp, cartão, QR)',
};

function rotulo(origem: string): string {
  if (ROTULO_ORIGEM[origem]) return ROTULO_ORIGEM[origem];
  if (/netlify\.app|fieldo/i.test(origem)) return ROTULO_ORIGEM.direto;
  return origem;
}

export async function executarCrescimento(nome: string, input: Record<string, unknown>, token: string): Promise<unknown> {
  const prof = idDoToken(token);
  if (!prof) throw new AcaoErro('sessão inválida — entre no Fieldo de novo.');

  if (nome === 'get_meu_desempenho') {
    const dias = [7, 30, 90].includes(Number(input.dias)) ? Number(input.dias) : 30;
    const m = await callRpc('minhas_metricas', { p_dias: dias }, token) as Record<string, any>;
    const atual = m.atual || {};
    const v = Number(atual.visualizacoes) || 0;
    const c = Number(atual.cliques_whatsapp) || 0;
    const out: Record<string, unknown> = {
      periodo_dias: m.dias,
      plano_pro: !!m.pro,
      visualizacoes: v,
      cliques_whatsapp: c,
      taxa_contato: v > 0 ? Math.round((c / v) * 1000) / 10 + '%' : null,
      amostra_pequena: !!m.amostra_pequena,
      observacao: m.amostra_pequena
        ? 'Menos de 30 visualizações no período: a taxa ainda oscila muito. Diga o número sem drama e sugira compartilhar o link do perfil.'
        : undefined,
    };
    if (m.pro) {
      const ant = m.anterior || {};
      out.periodo_anterior = { visualizacoes: Number(ant.visualizacoes) || 0, cliques_whatsapp: Number(ant.cliques_whatsapp) || 0 };
      out.de_onde_vieram = (m.por_origem || []).map((o: Record<string, unknown>) => ({
        origem: rotulo(String(o.origem)),
        visualizacoes: o.visualizacoes,
        cliques_whatsapp: o.cliques_whatsapp,
      }));
    } else {
      out.detalhe_bloqueado = 'De onde vieram as visitas, o dia a dia e a comparação com o período anterior são do plano Pro.';
    }
    return out;
  }

  if (nome === 'analisar_perfil_seo') {
    const meus = await rest(token, 'GET',
      'professionals?id=eq.' + encodeURIComponent(prof) +
      '&select=name,profissao,niche,bio,city,slug,is_public,cidades_atendidas,atua_desde,garantia,formas_pagamento');
    const p = meus[0];
    if (!p) throw new AcaoErro('perfil não encontrado.');

    /* contagens públicas: a mesma vista que o SEO lê. Vazia se o perfil não é público. */
    let s: Record<string, unknown> = {};
    try {
      const st = await rest(token, 'GET',
        'professional_stats?id=eq.' + encodeURIComponent(prof) +
        '&select=total_servicos_confirmados,total_fotos_trabalho,indexavel,total_geral,media_geral');
      s = st[0] || {};
    } catch { s = {}; }

    const bio = String(p.bio || '').trim();
    const cidade = String(p.city || '').trim();
    const profissao = String(p.profissao || '').trim();
    const servicos = Number(s.total_servicos_confirmados) || 0;
    const fotos = Number(s.total_fotos_trabalho) || 0;
    const cidades = Array.isArray(p.cidades_atendidas) ? p.cidades_atendidas.length : 0;
    const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

    const pontos: Array<{ item: string; ok: boolean; dica?: string }> = [];
    pontos.push({ item: 'perfil público', ok: !!p.is_public,
      dica: p.is_public ? undefined : 'O perfil está escondido. Isso só muda na tela Editar perfil — o assistente não mexe na visibilidade.' });
    pontos.push({ item: 'profissão preenchida', ok: !!profissao,
      dica: profissao ? undefined : 'Sem profissão o Google não sabe para qual busca mostrar a página.' });
    pontos.push({ item: 'cidade preenchida', ok: !!cidade,
      dica: cidade ? undefined : 'Busca de serviço é local: "eletricista em <cidade>". Sem cidade, a página não entra nessa busca.' });
    pontos.push({ item: 'bio com tamanho bom', ok: bio.length >= BIO_MIN,
      dica: bio.length >= BIO_MIN ? undefined : `A bio tem ${bio.length} caracteres. Entre ${BIO_MIN} e 600 rende um resumo melhor no Google.` });
    if (bio && cidade) {
      pontos.push({ item: 'bio cita a cidade', ok: norm(bio).includes(norm(cidade)),
        dica: norm(bio).includes(norm(cidade)) ? undefined : 'Citar a cidade (e bairros ou cidades vizinhas atendidas) na bio ajuda na busca local.' });
    }
    if (bio && profissao) {
      const chave = norm(profissao).split(/\s+/)[0];
      pontos.push({ item: 'bio cita a profissão', ok: !!chave && norm(bio).includes(chave),
        dica: chave && norm(bio).includes(chave) ? undefined : 'Usar o nome da profissão na bio, do jeito que o cliente procura.' });
    }
    pontos.push({ item: 'cidades atendidas', ok: cidades > 0,
      dica: cidades > 0 ? undefined : 'Cadastrar as cidades vizinhas que atende (tela Editar perfil) abre páginas de busca nessas cidades.' });
    const indexavel = s.indexavel === true || servicos >= MIN_SERVICOS || (bio.length > 0 && fotos >= MIN_FOTOS_SEM_SERVICO);
    pontos.push({ item: 'página liberada para o Google', ok: indexavel,
      dica: indexavel ? undefined
        : `Falta conteúdo real: ${MIN_SERVICOS} serviços confirmados (tem ${servicos}) ou bio + ${MIN_FOTOS_SEM_SERVICO} fotos de trabalho (tem ${fotos}). Registrar serviço com foto é o que mais ajuda.` });

    return {
      salvou_algo: false,
      perfil_atual: { name: p.name, profissao, niche: p.niche, city: cidade, bio, slug: p.slug },
      numeros: { servicos_confirmados: servicos, fotos_de_trabalho: fotos, cidades_atendidas: cidades,
        avaliacoes: Number(s.total_geral) || 0, nota_media: s.media_geral ?? null,
        atua_desde: p.atua_desde ?? null, tem_garantia: !!p.garantia },
      pontos,
      a_melhorar: pontos.filter((x) => !x.ok).map((x) => x.item),
      limites_para_texto: { bio_max_caracteres: BIO_MAX },
      proximo_passo:
        'Mostre em 1-2 frases o que mais pesa. Se a bio pode melhorar, escreva uma sugestão (verdadeira, só com o que está no perfil e nos números — nunca invente anos de experiência, certificado ou serviço) e PERGUNTE se pode salvar. Só chame update_my_profile depois do sim.',
    };
  }

  throw new AcaoErro('ferramenta desconhecida: ' + nome);
}
