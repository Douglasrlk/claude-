// Fieldo v7.7 · Edge Function "perfil-seo"
//
// Reconstrução da function de SEO server-side do perfil.html. A anterior
// (perfil-sso.js, nome inferido) já preenchia title/description/OG/robots
// corretamente — confirmei isso buscando a página ao vivo antes de mexer
// aqui. O que faltava, e é o motivo desta reconstrução: o CORPO da página
// (nome, cidade, nota, contagens, bio) continuava chegando vazio no HTML
// que um crawler sem JS recebe — só "Carregando…" e "—". Só metadado sem
// conteúdo ranqueia mal: o Google sabe que a página existe, mas não tem
// texto pra associar às buscas.
//
// Estratégia: NÃO reconstruir o perfil.html inteiro no servidor (isso
// duplicaria toda a lógica de renderização que já existe em JS, e viraria
// dois lugares pra manter sincronizados). Em vez disso, busca os dados
// públicos (via a view professional_stats — mesma agregação que
// explorar.html já usa, uma query só) e faz substituições cirúrgicas no
// HTML estático que o Netlify serve, ancoradas nos IDs que o JS cliente
// já usa. Quando o JS carrega depois, ele sobrescreve os mesmos elementos
// com dados frescos — não há conflito, é hidratação normal.
//
// Falha de rede, profissional não encontrado, ou perfil privado (a view
// só devolve linhas is_public=true) → devolve a página padrão sem
// modificar nada. Nunca quebra a página por causa de SEO.

import type { Context, Config } from "@netlify/edge-functions";
import { NICHO_POR_TERMO, nomeCidade, juntarPt } from "./lista-local.ts";

const SUPABASE_URL = "https://jrsctnncoljdcvdofxsg.supabase.co";
// Anon key — não é segredo (já está hardcoded em db.js, servido a
// qualquer visitante; a proteção real é a RLS do Postgres, não esconder
// esta string). Por isso não precisa de variável de ambiente aqui.
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impyc2N0bm5jb2xqZGN2ZG9meHNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTEzMzgsImV4cCI6MjA5MDc4NzMzOH0.XJj5d37fOgK4nN9B3xI_x7P1HE_4lvnYC_qx_5eF0FI";

/* ── v12.1 · CACHE NA CDN (auditoria 28/10/2026) ─────────────────────
 *
 * Medido em 24 h: 700 de 812 respostas do site saíram como cache miss,
 * perfil com p99 de 2,9 s, e 32 medições do Integrity Agent em que o
 * canonical SUMIU de perfis entre 19 e 23/10. A causa é uma só: cada
 * visita faz três consultas ao Supabase em Ohio, e quando a primeira
 * passa de 2,5 s a página sai sem nada do que esta function injeta —
 * canonical, JSON-LD, conteúdo, e com o `noindex` do HTML estático.
 *
 * Duas correções:
 *   1. página montada com sucesso fica na CDN da Netlify por 5 min e
 *      continua servível por 7 dias enquanto revalida em segundo plano
 *      (stale-while-revalidate). Quase nenhuma visita espera o banco.
 *      O JS do cliente continua buscando dado fresco e hidratando —
 *      quem acabou de editar o perfil vê a mudança na tela na hora.
 *   2. página degradada (banco lento ou fora) NUNCA vai para a CDN, e
 *      sai com 503 + Retry-After em vez de 200. O corpo é o mesmo — o
 *      visitante vê o perfil carregar pelo JS como sempre —, mas o
 *      Google entende "volte depois" em vez de "esta página é noindex".
 *      O 200 com noindex do estático era um pedido de desindexação.
 *
 * `cache: "manual"` no config, lá embaixo, é o que liga isso. */
const CDN_OK       = "public, s-maxage=300, stale-while-revalidate=604800";
const CDN_AUSENTE  = "public, s-maxage=60";
const CDN_NUNCA    = "no-store";

function cabecalhos(base: Headers, cdn: string): Headers {
  const h = new Headers(base);
  h.delete("content-length"); /* o corpo mudou de tamanho */
  h.delete("etag");           /* idem — o etag é do arquivo estático */
  h.set("Netlify-CDN-Cache-Control", cdn);
  return h;
}

interface ProfStats {
  id: string;
  slug: string | null;   // v10.3 · a v10.2 já usava prof.slug no canonical, mas nunca pedia a coluna no select: o valor era sempre undefined e o fallback silencioso mascarava isso
  niche: string | null;  // v10.3 · chave do nicho, usada no serviceType do JSON-LD
  name: string | null;
  profissao: string | null;
  city: string | null;
  city_slug?: string | null; // v12.26b · para os perfis relacionados e a trilha
  uf: string | null; // v10.1 · coluna própria da view; hoje NULL para toda a base, por isso o address nunca inventa região
  logo_url: string | null;
  foto_capa: string | null; // v12.14 · foto do último serviço público (só com portfólio público) — reserva de imagem quando não há foto de perfil
  bio: string | null;
  media_geral: string | null; // vem como texto do Postgres (numeric), ex. "4.9"
  total_geral: number;
  total_servicos_confirmados: number;
  area_atendimento: string | null; // v10.30 · bairros/cidades vizinhas, texto livre opcional
  tipo_atendimento: string | null; // v10.30 · residencial | comercial | ambos
  // v12.13 · credibilidade
  cnpj?: string | null; empresa_nome?: string | null; cnpj_situacao?: string | null; cnpj_abertura?: string | null;
  atua_desde?: number | null; garantia?: string | null; formas_pagamento?: string[] | null;
  atende_urgencia?: boolean | null; registros?: string | null;
  outras_profissoes?: { rotulo: string; nicho: string }[] | null; // v12.25
  cidades_atendidas?: string[] | null; // v12.28 · cidades marcadas em "Também atende"
  cidades?: string[] | null;           // v12.28 · principal + atendidas (mantida pelo banco)
  // v12.26 · calculados pela vista (só existem depois do SQL da v12.26)
  indexavel?: boolean | null;           // 3 serviços reais, ou biografia + 6 fotos de trabalho
  total_fotos_trabalho?: number | null; // fotos visíveis (com consentimento de portfólio)
  created_at?: string | null;           // v12.29 · "No Fieldo desde", no resumo
}

/* v10.8 · aceita qualquer coisa e converte antes de escapar.
 *
 * A assinatura era `escHtml(s: string)`. Todas as chamadas de hoje
 * passam string (nota.toFixed(1), String(total)), então nunca quebrou —
 * mas foi exatamente essa assinatura, no esc() do lista-local.ts, que
 * derrubou as duas páginas de categoria com HTTP 500: `media_geral` é
 * numeric no Postgres, o PostgREST serializa como número JSON, e
 * `s.replace` não existe em número.
 *
 * Aqui o custo do mesmo erro seria maior — derruba a página de perfil,
 * que é o produto. Endurecer agora é uma linha. */
function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* v10.3 · "não existe" e "não consegui perguntar" pararam de ser a
 * mesma coisa.
 *
 * Até a v10.2 esta função devolvia null nos dois casos, e quem chamava
 * não tinha como distinguir. A consequência é o soft-404: um slug
 * inventado devolvia HTTP 200 com o esqueleto da página de perfil, o
 * que o Google trata como página real e vazia — pior que um 404
 * honesto. Mas responder 404 sem essa distinção seria pior ainda:
 * durante uma queda do Supabase o site inteiro passaria a devolver 404
 * para perfis que existem, e o Google os removeria do índice.
 *
 * Agora: "ausente" → 404; "indisponível" → 200 com a página padrão,
 * exatamente como antes. */
type Busca =
  | { estado: "ok"; prof: ProfStats }
  | { estado: "ausente" }        // o banco respondeu, e não há esse profissional
  | { estado: "indisponivel" };  // rede, timeout, erro do PostgREST — não sabemos

async function buscarProfissional(
  slug: string | null,
  id: string | null,
  extra?: string,
): Promise<Busca> {
  if (!slug && !id) return { estado: "ausente" };

  const filtro = slug
    ? `slug=eq.${encodeURIComponent(slug)}`
    : `id=eq.${encodeURIComponent(id!)}`;
  const url =
    `${SUPABASE_URL}/rest/v1/professional_stats?${filtro}` +
    `&select=id,slug,niche,name,profissao,city,city_slug,uf,logo_url,foto_capa,bio,media_geral,total_geral,total_servicos_confirmados,area_atendimento,tipo_atendimento,created_at,` +
    `cnpj,empresa_nome,cnpj_situacao,cnpj_abertura,atua_desde,garantia,formas_pagamento,atende_urgencia,registros&limit=1` +
    (extra || "");
  /* v12.25 · outras profissões. Se o banco ainda não tem a coluna (site
     publicado antes do SQL), a consulta antiga continua valendo. */
  const urlNova = url.replace("registros&limit=1", "registros,outras_profissoes&limit=1");
  /* v12.26 · indexavel (3 serviços reais, ou biografia + 6 fotos de
     trabalho) e total_fotos_trabalho, calculados pela vista. Antes do
     SQL da v12.26 → 400 → a de cima; antes da v12.25 → a primeira. */
  const urlV1226 = urlNova.replace("outras_profissoes&limit=1", "outras_profissoes,indexavel,total_fotos_trabalho&limit=1");
  /* v12.28 · cidades atendidas. Antes do SQL da v12.28 → 400 → a de cima. */
  const urlV1228 = urlV1226.replace("total_fotos_trabalho&limit=1", "total_fotos_trabalho,cidades_atendidas,cidades&limit=1");

  // Timeout curto e deliberado: isto roda no caminho crítico de CADA
  // carregamento de perfil. Se o Supabase estiver lento, prefiro servir
  // a página sem o SEO enriquecido a fazer todo visitante esperar.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);

  try {
    const h = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
    let r = await fetch(urlV1228, { headers: h, signal: ctrl.signal });
    if (r.status === 400) r = await fetch(urlV1226, { headers: h, signal: ctrl.signal });
    if (r.status === 400) r = await fetch(urlNova, { headers: h, signal: ctrl.signal });
    if (r.status === 400) r = await fetch(url, { headers: h, signal: ctrl.signal });
    if (!r.ok) return { estado: "indisponivel" };
    const rows: ProfStats[] = await r.json();
    return rows[0] ? { estado: "ok", prof: rows[0] } : { estado: "ausente" };
  } catch {
    return { estado: "indisponivel" }; // rede, timeout, JSON malformado
  } finally {
    clearTimeout(t);
  }
}

/* v12.25 · nomes das outras profissões, na ordem em que a pessoa pôs.
   Mesma regra de outrasRotulos() em perfil.html. */
function outrasRotulos(prof: ProfStats): string[] {
  const lista = Array.isArray(prof.outras_profissoes) ? prof.outras_profissoes : [];
  const out: string[] = [];
  for (const o of lista) {
    const r = o && typeof o.rotulo === "string" ? o.rotulo.trim() : "";
    if (r && !out.includes(r) && out.length < 3) out.push(r);
  }
  return out;
}

/** Substitui o conteúdo de texto de UM elemento, ancorado no id exato
 *  que já existe no HTML estático — nunca cria elemento novo, então não
 *  há risco de duplicar algo que o JS também vai preencher depois. */
function substituirTexto(
  html: string,
  aberturaExata: string,
  fechamento: string,
  novoConteudo: string,
): string {
  const idx = html.indexOf(aberturaExata);
  if (idx === -1) return html; // marcador não achado — não mexe em nada, falha segura
  const fim = html.indexOf(fechamento, idx + aberturaExata.length);
  if (fim === -1) return html;
  return (
    html.slice(0, idx + aberturaExata.length) +
    novoConteudo +
    html.slice(fim)
  );
}

function substituirAtributo(
  html: string,
  aberturaExata: string,
  novoValor: string,
): string {
  const idx = html.indexOf(aberturaExata);
  if (idx === -1) return html;
  return html.slice(0, idx) + novoValor + html.slice(idx + aberturaExata.length);
}

/* v10.1 · a URL limpa /p/:slug.
 *
 * Até a v10.0 o único endereço de um perfil era
 * /perfil.html?slug=xxx. Funciona — o Google indexa query string —
 * mas com prioridade de rastreio menor, tratada como candidata a
 * duplicata de /perfil.html, e sem palavra nenhuma no caminho.
 *
 * A forma nova é /p/xxx. O netlify.toml faz o rewrite (status 200,
 * proxy: a URL na barra continua sendo /p/xxx) e esta function passou
 * a ser declarada nos DOIS caminhos, porque no Netlify a edge function
 * roda ANTES do motor de redirects — em /p/xxx ela recebe o path
 * original, sem query string nenhuma, e precisa saber ler o slug dali.
 *
 * v10.2: a URL antiga com ?slug= recebe 301 para /p/:slug. URLs com
 * ?id= continuam compatíveis enquanto o ID não for convertido para slug. */
/* v10.3 · CONTEÚDO PÚBLICO NO HTML SERVIDO
 *
 * Requisito da auditoria: a identidade da página não pode depender
 * exclusivamente de JavaScript. Nome, profissão, cidade e nota já eram
 * injetados desde a v7.7; faltavam as duas listas que são o conteúdo
 * único desta página — os serviços registrados e as avaliações.
 *
 * São exatamente as mesmas duas consultas que perfil.html já dispara no
 * cliente (linhas 608-609), com os mesmos filtros e a mesma ordem. Não
 * é consulta nova no sistema; é a mesma antecipada para o servidor. O
 * cliente refaz e sobrescreve — hidratação, como no resto da página.
 *
 * Limites menores que os do cliente (12 e 8, contra 20 e 20) porque
 * aqui o objetivo é dar conteúdo ao crawler, não paginar: as duas
 * listas completas chegam um instante depois pelo JS. */
interface ReportPub {
  id: string;
  client_name: string | null;
  category_label: string | null;
  category_key: string | null;
  niche: string | null;
  service_date: string | null;
  created_at: string | null;
  rating: number | null;
  photos: unknown;
  service_description?: string | null; // v10.30 · só antes do SQL da v12.26 (ver titulo_publico)
  titulo_publico?: string | null;      // v12.26 · título limpo calculado pelo banco; a descrição inteira não chega mais ao anon
  tipo?: string | null;                // v12.26 · 'servico' | 'portfolio' (foto de trabalho, não conta como serviço)
  portfolio_ok?: boolean | null;       // v12.26 · false = fotos deste registro fora da galeria
}

interface AvalPub {
  nota: number | null;
  comentario: string | null;
  resposta?: string | null; // v12.7 · resposta do profissional, já pública (COLUNAS_PUBLICAS)
  nome_avaliador: string | null;
  created_at: string | null;
}

/* ── v12.26b · P12 · outros profissionais da mesma profissão e cidade ──
 * O perfil não tinha link nenhum para a página "eletricista-em-
 * caraguatatuba" nem para colegas: a autoridade não circulava. Busca até
 * 4 perfis indexáveis com a mesma profissão (principal ou outra) na mesma
 * cidade. Com o perfil atual somando 3 ou mais, a página da cidade é
 * indexável e ganha link. Sem a coluna `indexavel` (antes do SQL da
 * v12.26) ou se demorar, não mostra nada: é enriquecimento. */
interface Relacionado {
  id: string; slug: string | null; name: string | null; profissao: string | null;
  foto_capa: string | null; logo_url: string | null;
  total_servicos_confirmados: number; total_fotos_trabalho?: number | null;
}
interface Relacionados { termo: string; rotulo: string; listaRotulo: string; itens: Relacionado[]; paginaIndexavel: boolean }

async function buscarRelacionados(prof: ProfStats): Promise<Relacionados | null> {
  const niche = (prof.niche || "").trim();
  const citySlug = (prof.city_slug || "").trim();
  if (!niche || niche === "outro" || !citySlug || typeof prof.indexavel !== "boolean") return null;
  const achado = Object.entries(NICHO_POR_TERMO).find(([, d]) => d.niche === niche);
  if (!achado) return null;
  const [termo, d] = achado;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/professional_stats?` +
        /* v12.28 · quem mora OU atende a cidade (como a página da cidade) */
        (Array.isArray(prof.cidades) ? `cidades=cs.${encodeURIComponent("{" + citySlug + "}")}` : `city_slug=eq.${encodeURIComponent(citySlug)}`) +
        `&nichos=cs.${encodeURIComponent("{" + niche + "}")}&indexavel=is.true&id=neq.${encodeURIComponent(prof.id)}` +
        `&select=id,slug,name,profissao,foto_capa,logo_url,total_servicos_confirmados,total_fotos_trabalho` +
        `&order=total_servicos_confirmados.desc&limit=4`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }, signal: ctrl.signal },
    );
    if (!r.ok) return null;
    const itens: Relacionado[] = await r.json();
    if (!Array.isArray(itens) || !itens.length) return null;
    const total = itens.length + (prof.indexavel ? 1 : 0);
    const rotulo = `${d.plural} em ${prof.city || citySlug}`;
    const listaRotulo = d.servico
      ? `Outros profissionais de ${d.singular.toLowerCase()} em ${prof.city || citySlug}`
      : `Outros ${d.plural.toLowerCase()} em ${prof.city || citySlug}`;
    return { termo, rotulo, listaRotulo, itens: itens.slice(0, 3), paginaIndexavel: total >= 3 };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function buscarConteudo(
  profId: string,
): Promise<{ reports: ReportPub[]; avals: AvalPub[]; completo: boolean }> {
  const base = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);

  /* v12.1 · `completo` diz se as duas listas vieram de verdade. Lista
     que falhou continua virando [] (nunca quebra a página), mas a página
     incompleta não vai para a CDN — senão ficaria 5 min sem serviços. */
  let completo = true;
  const pegar = async <T>(caminho: string, antes1226?: string): Promise<T[]> => {
    try {
      let r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
        headers: base,
        signal: ctrl.signal,
      });
      /* v12.26 · 400 = reports.titulo_publico ainda não existe (site
         publicado antes do SQL). Uma tentativa com as colunas de antes. */
      if (r.status === 400 && antes1226) {
        r = await fetch(`${SUPABASE_URL}/rest/v1/${antes1226}`, { headers: base, signal: ctrl.signal });
      }
      if (r.ok) return await r.json();
      completo = false;
      return [];
    } catch {
      completo = false;
      return []; // conteúdo é enriquecimento: falhar aqui nunca pode quebrar a página
    }
  };

  try {
    // v11.0 · segurança (auditoria 11/10/2026, achado C2): o anon deixou
    // de ler o nome completo do cliente e de quem avaliou. O banco manda
    // a forma curta pronta (cliente_curto / nome_avaliador_curto), e ela
    // é copiada para os campos de sempre — nomeCurto() sobre "Maria A."
    // devolve "Maria A.", então o HTML servido não muda.
    //
    // v12.26 · auditoria SEO/GEO (03/11), achado P1: a descrição inteira
    // (valor, saldo, endereço) e o nome curto do cliente deixaram de ser
    // lidos pelo anon. O título vem pronto do banco (titulo_publico), com
    // a mesma regra de tituloServico() abaixo. Nenhum dos dois aparecia
    // no HTML servido; a diferença é que agora nem chegam à função.
    const filtroReports = `reports?professional_id=eq.${encodeURIComponent(profId)}&is_public=eq.true`;
    const ordemReports = `&order=created_at.desc&limit=12`;
    const [brutosReports, brutasAvals] = await Promise.all([
      pegar<ReportPub & { cliente_curto?: string | null }>(
        filtroReports +
        `&select=id,category_label,category_key,niche,service_date,created_at,rating,photos,titulo_publico,tipo,portfolio_ok` + ordemReports,
        filtroReports +
        `&select=id,cliente_curto,category_label,category_key,niche,service_date,created_at,rating,photos,service_description` + ordemReports,
      ),
      pegar<AvalPub & { nome_avaliador_curto?: string | null }>(
        `avaliacoes?professional_id=eq.${encodeURIComponent(profId)}` +
        `&select=nota,comentario,resposta,nome_avaliador_curto,created_at&order=created_at.desc&limit=8`,
      ),
    ]);
    const reports: ReportPub[] = brutosReports.map((r) => ({
      ...r,
      client_name: r.client_name ?? r.cliente_curto ?? null,
    }));
    const avals: AvalPub[] = brutasAvals.map((a) => ({
      ...a,
      nome_avaliador: a.nome_avaliador ?? a.nome_avaliador_curto ?? null,
    }));
    return { reports, avals, completo };
  } finally {
    clearTimeout(t);
  }
}

/* Espelham nomeCurto() e fmtDate() de perfil.html — mesma saída, para
 * que o HTML servido e o hidratado sejam o mesmo texto.
 *
 * nomeCurto existe por privacidade e a regra vale igual aqui: a página
 * é pública, e "Maria Aparecida Silva" expõe um terceiro que nunca
 * consentiu. Primeiro nome + inicial. */
function nomeCurto(nome: string | null): string {
  const p = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "Cliente";
  if (p.length === 1) return p[0];
  return p[0] + " " + p[1].charAt(0).toUpperCase() + ".";
}

const MESES = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.",
               "jul.", "ago.", "set.", "out.", "nov.", "dez."];

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00Z" : iso);
  if (isNaN(d.getTime())) return iso;
  const dia = String(d.getUTCDate()).padStart(2, "0");
  return `${dia} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

function estrelasDe(n: number): string {
  const c = Math.max(0, Math.min(5, Math.round(n || 0)));
  return "★".repeat(c) + "☆".repeat(5 - c);
}

/* v10.30 · espelha truncar() de perfil.html — corta no limite de
 * palavra em vez de no meio dela. Mesmo texto no HTML servido e no
 * hidratado. */
function truncar(s: string, max: number): string {
  const texto = String(s || "");
  if (texto.length <= max) return texto;
  let corte = texto.slice(0, max);
  const ultimoEspaco = corte.lastIndexOf(" ");
  if (ultimoEspaco > max * 0.6) corte = corte.slice(0, ultimoEspaco);
  return corte.trim() + "…";
}

/* v10.30 · espelha resumoPorCategorias() de perfil.html. Só conta o que
 * já foi registrado de verdade — nunca escreve uma categoria com zero
 * ocorrência, nunca qualifica ("especialista", "expert"). */
function resumoPorCategorias(reports: ReportPub[]): string {
  if (!reports.length) return "";
  const contagem = new Map<string, number>();
  for (const r of reports) {
    const cat = (r.category_label || r.niche || r.category_key || "").trim();
    if (!cat) continue;
    contagem.set(cat, (contagem.get(cat) || 0) + 1);
  }
  const cats = [...contagem.keys()].sort((a, b) => (contagem.get(b)! - contagem.get(a)!));
  if (!cats.length) return "";
  const principais = cats.slice(0, 2).join(" e ");
  const n = reports.length;
  return `Atua principalmente com serviços de ${principais}, com ${n} ${n === 1 ? "serviço registrado" : "serviços registrados"} no Fieldo.`;
}

/* v12.7 · espelha tituloServico() de perfil.html. O texto do relatório
 * é escrito para o CLIENTE e costuma trazer valores, saldo de
 * empreitada e endereço; na página pública sai só uma linha dizendo o
 * que foi feito, sem nada de dinheiro. Ver o comentário grande lá. */
const RE_DINHEIRO = /(r\$|\$\s*\d|\breais\b|\bvalor|\bempreitada|\bsaldo|\bcobran[cç]a|\bpagamento|\bpagar\b|\bpendente|\btotal\b|\bor[cç]amento|\bdesconto|\bpix\b|\bacerto\b)/i;
const RE_GENERICO = /^(servi[cç]os?( realizados?| executados?)?|finaliza[cç][aã]o( dos servi[cç]os)?|descri[cç][aã]o( t[eé]cnica)?( dos servi[cç]os)?( el[eé]tricos)?|resumo|relat[oó]rio|ol[aá]|bom dia|boa tarde|boa noite|condi[cç][oõ]es comerciais|observa[cç][oõ]es)[\s:.!,-]*$/i;
function tituloServico(desc: string | null, categoria: string): string {
  const linhas: string[] = [];
  for (const ln of String(desc || "").split(/\r?\n/).slice(0, 8)) linhas.push(...ln.split(/(?<=[.!?])\s+/));
  for (let i = 0; i < linhas.length && i < 12; i++) {
    let l = linhas[i]
      .replace(/^[\s#>*\-–—•·]+/, "")
      .replace(/^\d+\s*\\?[.)]\s*/, "")
      .replace(/[*_`]+/g, "")
      .replace(/\(\s*\$?\s*[\d.,]+\s*\)/g, "")
      .replace(/\s+/g, " ").trim();
    if (l.length < 4) continue;
    if (RE_DINHEIRO.test(l)) continue;
    if (RE_GENERICO.test(l)) continue;
    if (/^(ol[aá]|oi|bom dia|boa tarde|boa noite|prezad[oa]s?|obrigad[oa]|obg)(?=[\s,.!;:]|$)/i.test(l)) continue;
    l = l.replace(/[\s:;,.]+$/, "");
    return l.charAt(0).toUpperCase() + l.slice(1);
  }
  return categoria ? `Serviço de ${categoria.toLowerCase()}` : "Serviço realizado";
}
const SERV_INICIAIS = 6;

/* ── v12.26b · auditoria SEO/GEO (03/11), Fase 2 ─────────────────────
 * Cópias IDÊNTICAS das funções de mesmo nome em perfil.html. Exportadas
 * só para o teste conferir as duas lado a lado: o HTML servido e o que o
 * JS escreve depois precisam dizer a mesma coisa.
 *
 * P8 · título: profissão e cidade primeiro, depois o nome. O Google
 * corta perto de 60 caracteres; quando não cabe, encurta o nome, depois
 * tira "Fieldo", e só por último o nome. A profissão nunca é cortada. */
/* v12.28 · "Também atende Ubatuba e São Sebastião, Massaguaçu" */
export function textoAtende(prof: { cidades_atendidas?: string[] | null; area_atendimento?: string | null }): string {
  const nomes = (Array.isArray(prof.cidades_atendidas) ? prof.cidades_atendidas : []).map((s) => nomeCidade(s));
  const partes = [juntarPt(nomes), String(prof.area_atendimento || "").trim()].filter(Boolean);
  return partes.length ? "Também atende " + partes.join(", ") : "";
}

/* v12.29 · auditoria SEO/GEO, Fase 4 · "Em resumo", no topo do perfil.
 *
 * Um parágrafo só com fatos que o banco tem, para quem lê com pressa e
 * para as IAs, que citam a primeira frase completa que encontram:
 * o que faz, onde, desde quando está no Fieldo, o que está registrado e
 * o que ainda não está. O que o profissional declara (atua desde) vem
 * dito como declarado; o que o Fieldo confere (CNPJ), como conferido.
 * Só o servidor escreve; o JS não mexe (mesmo esquema de #relacionados).
 *
 *   "Juscelino — empreiteiro construtor em Caraguatatuba, SP; também
 *    atende Ubatuba. No Fieldo desde mar. 2025. Tem 21 serviços
 *    registrados (o mais recente em out. 2026), 18 fotos de trabalhos e
 *    nota 4,9 em 12 avaliações de quem contratou." */
export function resumoDoPerfil(o: {
  nome: string | null; servico: string; outras: string[]; cidade: string; uf: string | null;
  atendidas: string[]; servicos: number; ultimoServico: string | null; fotos: number;
  nota: number; avaliacoes: number; criadoEm: string | null; atuaDesde: number | null; cnpjAtivo: boolean;
}): string {
  const minus = (t: string) => /^[A-ZÀ-Ý][a-zà-ÿ]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
  const mesAno = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso.length <= 10 ? iso + "T00:00:00Z" : iso);
    return isNaN(d.getTime()) ? "" : `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

  const partes = String(o.cidade || "").split(/\s*[,–—-]\s*/).filter(Boolean);
  const base = (partes[0] || "").trim();
  const uf = String(o.uf || partes[1] || "").trim();
  const local = base ? base + (/^[A-Za-z]{2}$/.test(uf) ? ", " + uf.toUpperCase() : "") : "";

  /* a profissão vai como a pessoa escreveu ("Eletricista Residencial e
     Comercial 24h"); só as outras, que vêm da lista fixa, ficam em minúscula */
  const servico = String(o.servico || "").trim();
  let oQue = servico || "profissional";
  const outras = o.outras.map((x) => minus(String(x || "").trim())).filter(Boolean);
  if (outras.length) oQue += ` (também ${juntarPt(outras)})`;
  const nome = String(o.nome || "").trim();
  let s1 = nome ? `${nome} — ${oQue}` : oQue.charAt(0).toUpperCase() + oQue.slice(1);
  if (local) s1 += ` em ${local}`;
  const atendidas = o.atendidas.filter((c) => c && c !== base);
  if (atendidas.length) s1 += `; também atende ${juntarPt(atendidas)}`;
  s1 += ".";

  const desde = mesAno(o.criadoEm);
  const s2 = desde ? `No Fieldo desde ${desde}.` : "";

  const tem: string[] = [], falta: string[] = [];
  if (o.servicos > 0) {
    const ult = mesAno(o.ultimoServico);
    tem.push(plural(o.servicos, "serviço registrado", "serviços registrados") + (ult ? ` (o mais recente em ${ult})` : ""));
  } else falta.push("serviços registrados");
  if (o.fotos > 0) tem.push(plural(o.fotos, "foto de trabalho", "fotos de trabalhos"));
  if (o.avaliacoes > 0 && o.nota > 0) {
    tem.push(`nota ${o.nota.toFixed(1).replace(".", ",")} em ${plural(o.avaliacoes, "avaliação", "avaliações")} de quem contratou`);
  } else falta.push("avaliações");
  let s3 = tem.length ? "Tem " + juntarPt(tem) : "";
  if (falta.length) s3 += (s3 ? "; ainda não tem " : "Ainda não tem ") + falta.join(" nem ");
  s3 += ".";

  const agora = new Date().getUTCFullYear();
  const s4 = [
    o.cnpjAtivo ? "CNPJ ativo na Receita Federal, conferido pelo Fieldo." : "",
    o.atuaDesde && o.atuaDesde <= agora ? `Atua desde ${o.atuaDesde}, segundo o profissional.` : "",
  ].filter(Boolean).join(" ");
  return [s1, s2, s3, s4].filter(Boolean).join(" ");
}

export function tituloDaPagina(oQueFaz: string, nome: string): string {
  nome = String(nome || "").trim();
  const primeiro = nome.split(/\s+/)[0] || "";
  const c: string[] = [];
  if (oQueFaz) {
    if (nome) c.push(oQueFaz + " · " + nome + " · Fieldo");
    if (primeiro && primeiro !== nome) c.push(oQueFaz + " · " + primeiro + " · Fieldo");
    if (primeiro) c.push(oQueFaz + " · " + primeiro);
    c.push(oQueFaz + " · Fieldo");
    c.push(oQueFaz);
  } else {
    c.push((nome || "Profissional") + " · Fieldo");
  }
  for (const x of c) if (x.length <= 60) return x;
  return c[c.length - 1];
}

/* P9 · descrição: o que faz e onde, a prova, a nota, e a primeira frase
 * de verdade da biografia. Até 160 caracteres. */
export function descricaoDaPagina(o: { oQueFaz: string; servicos: number; fotos: number; nota: number; avaliacoes: number; bio: string | null }): string {
  const fatos: string[] = [];
  if (o.servicos > 0) fatos.push(o.servicos + (o.servicos === 1 ? " serviço registrado" : " serviços registrados") + " com foto e data");
  else if (o.fotos > 0) fatos.push(o.fotos + (o.fotos === 1 ? " foto de trabalho" : " fotos de trabalhos"));
  if (o.avaliacoes > 0 && o.nota > 0) fatos.push("nota " + o.nota.toFixed(1).replace(".", ",") + " em " + o.avaliacoes + (o.avaliacoes === 1 ? " avaliação" : " avaliações"));
  let t = (o.oQueFaz || "Profissional") + ".";
  if (fatos.length) { const f = fatos.join(", "); t += " " + f.charAt(0).toUpperCase() + f.slice(1) + "."; }
  let frase = "";
  const pedacos = String(o.bio || "").split(/\r?\n/);
  for (let i = 0; i < pedacos.length && !frase; i++) {
    const sent = pedacos[i].split(/(?<=[.!?])\s+/);
    for (const s0 of sent) {
      const x = s0.replace(/^[\s\-–—•·*#>|]+/, "").replace(/\s+/g, " ").trim();
      if (x.indexOf("|") !== -1) continue; // "Nome | Título": cabeçalho, não frase
      if (x.length >= 40) { frase = x; break; }
    }
  }
  if (frase) {
    if (!/[.!?…]$/.test(frase)) frase += ".";
    const resta = 160 - t.length - 1;
    if (frase.length <= resta) t += " " + frase;
    else if (resta >= 40) {
      let corte = frase.slice(0, resta - 1);
      const esp = corte.lastIndexOf(" ");
      if (esp > 20) corte = corte.slice(0, esp);
      t += " " + corte.replace(/[\s,;:.\-–—]+$/, "") + "…";
    }
  }
  return t;
}

/* P11 · texto alternativo das fotos (fotoAlt de perfil.html, que recebe o
 * perfil e calcula oQueFaz com FIELDO.UI.subtitulo; aqui ele chega pronto). */
export function fotoAlt(r: { tipo?: string | null; category_label?: string | null; niche?: string | null; category_key?: string | null; titulo_publico?: string | null; service_description?: string | null }, oQueFaz: string, cidade: string): string {
  const oq = oQueFaz || "profissional";
  if (r && r.tipo === "portfolio") return "Trabalho de " + oq.charAt(0).toLowerCase() + oq.slice(1);
  const cat = (r && (r.category_label || r.niche || r.category_key)) || "";
  const t = tituloServico(r ? (r.titulo_publico || r.service_description || null) : null, cat);
  const cid = String(cidade || "").split(/[,–—-]/)[0].trim();
  const n = (z: string) => String(z).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return (cid && n(t).indexOf(n(cid)) === -1) ? t + " em " + cid : t;
}

/* v12.13 · espelha FIELDO.Credenciais (db.js): mesmo texto, mesmas
 * classes, para o HTML servido e o hidratado serem iguais. */
const PAGAMENTOS: Record<string, string> = { pix: "Pix", dinheiro: "Dinheiro", cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito", boleto: "Boleto", transferencia: "Transferência" };
function fmtCnpj(c: string): string {
  return /^\d{14}$/.test(c) ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : c;
}
function pagamentosTexto(l: string[] | null | undefined): string {
  const n = (l || []).map((k) => PAGAMENTOS[k]).filter(Boolean);
  if (!n.length) return "";
  return n.length === 1 ? n[0] : n.slice(0, -1).join(", ") + " e " + n[n.length - 1];
}
function credenciaisHtml(p: ProfStats): string {
  const out: { ok?: boolean; t: string; x: string }[] = [];
  const agora = new Date().getFullYear();
  if (p.cnpj && p.cnpj_situacao === "ATIVA") {
    out.push({ ok: true, t: "Empresa ativa na Receita Federal",
      x: (p.empresa_nome ? p.empresa_nome + " · " : "") + "CNPJ " + fmtCnpj(p.cnpj) + (p.cnpj_abertura ? " · aberta em " + String(p.cnpj_abertura).slice(0, 4) : "") });
  }
  if (p.atua_desde && p.atua_desde <= agora) {
    const a = agora - p.atua_desde;
    out.push({ t: "Atua desde " + p.atua_desde, x: a >= 1 ? `${a} ${a === 1 ? "ano" : "anos"} de experiência` : "Começou este ano" });
  }
  if ((p.garantia || "").trim()) out.push({ t: "Garantia: " + p.garantia!.trim(), x: "Nos serviços que realiza" });
  if (p.atende_urgencia) out.push({ t: "Atende urgência", x: "Chamados fora do horário comercial" });
  const pg = pagamentosTexto(p.formas_pagamento);
  if (pg) out.push({ t: "Formas de pagamento", x: pg });
  if ((p.registros || "").trim()) out.push({ t: "Registros e certificações", x: p.registros!.trim() });
  if (!out.length) return "";
  const conf = out.some((i) => i.ok), decl = out.some((i) => !i.ok);
  return `<ul class="cred-lista">` + out.map((i) =>
    `<li class="cred-item${i.ok ? " cred-item--ok" : ""}"><span class="cred-ico" aria-hidden="true">${i.ok ? "✓" : "•"}</span>` +
    `<span><strong>${escHtml(i.t)}</strong><span class="cred-txt">${escHtml(i.x)}</span></span></li>`).join("") + `</ul>` +
    `<p class="cred-nota">${[conf ? "CNPJ conferido na Receita Federal pelo Fieldo." : "", decl ? "Os demais itens são informados pelo profissional." : ""].filter(Boolean).join(" ")}</p>`;
}

/* v12.19e · para onde foi um endereço antigo de perfil (ou null). */
async function slugAtual(antigo: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/slug_atual`, {
      method: "POST",
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_slug: antigo }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const v = await r.json();
    return typeof v === "string" && /^[a-z0-9-]{3,120}$/.test(v) ? v : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function slugDoCaminho(pathname: string): string | null {
  const m = pathname.match(/^\/p\/([^/?#]+)\/?$/);
  return m ? decodeURIComponent(m[1]) : null;
}

/* v10.9 · o 301 passou a PRESERVAR a query string.
 *
 * Antes montava `${origin}/p/${slug}` e descartava tudo depois do "?".
 * O share-card.js gera o link como `perfil.html?slug=X&src=card_generico`;
 * esse link bate aqui, leva 301, perde o `src` e chega em /p/X sem origem
 * nenhuma. O perfil então registra a visita como 'organico'.
 *
 * É por isso que o banco tem 4 `card_generated` e ZERO views com
 * `source` começando em `card_` — a única atribuição que o produto
 * tinha era destruída no redirecionamento.
 *
 * `_i` fica de fora: é o marcador interno do rewrite do netlify.toml e
 * não tem por que aparecer na barra do visitante. */
function redir301(origin: string, slug: string, query?: URLSearchParams): Response {
  const qs = new URLSearchParams(query ?? undefined);
  qs.delete("_i");
  qs.delete("slug");   /* o slug agora vive no caminho */
  qs.delete("id");     /* idem — a forma canônica é /p/:slug */
  const sufixo = qs.toString() ? `?${qs}` : "";

  return new Response(null, {
    status: 301,
    headers: {
      Location: `${origin}/p/${encodeURIComponent(slug)}${sufixo}`,
      /* v10.9 · 1 dia era demais para um redirect que agora carrega
         parâmetro variável: o navegador guardaria o primeiro `src` visto
         e reusaria para os próximos links. Uma hora dá o mesmo alívio de
         tráfego sem colar a atribuição de uma campanha na outra. */
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const slugNaQuery = url.searchParams.get("slug");
  const slug = slugNaQuery || slugDoCaminho(url.pathname);
  const id = url.searchParams.get("id");

  /* v10.3 · TRAVA ANTI-LOOP.
   *
   * O netlify.toml faz o rewrite interno /p/:slug → /perfil.html?slug=…
   * e esta function responde 301 em /perfil.html?slug=…. As duas coisas
   * juntas só não são um loop porque, no Netlify, a Edge Function casa
   * com o path ORIGINAL da requisição e não roda de novo depois do
   * rewrite. Isso é verdade hoje e está confirmado em produção — mas é
   * um detalhe de plataforma, não um contrato, e se mudar o site
   * inteiro entra em redirect infinito.
   *
   * O rewrite passa `_i=1` (interno). Aqui, `_i=1` desliga o 301. Custo:
   * um parâmetro que nunca aparece na barra do visitante, porque o
   * rewrite é interno. Ganho: o loop deixa de ser possível mesmo que a
   * ordem de execução do Netlify mude. */
  const requisicaoInterna = url.searchParams.get("_i") === "1";

  /* ── 301 da URL antiga ────────────────────────────────────────────
   * /perfil.html?slug=X → /p/X
   *
   * v10.3: o ?id= também passou a redirecionar. Ele exigia uma consulta
   * para virar slug, e a v10.2 preferiu deixar 200 — mas essa consulta
   * já acontece logo abaixo de qualquer jeito. Deixar o ?id= vivo
   * significava manter uma terceira URL competindo pela mesma pessoa. */
  if (url.pathname === "/perfil.html" && !requisicaoInterna) {
    const slugDireto = (slugNaQuery || "").trim();
    if (slugDireto) return redir301(url.origin, slugDireto, url.searchParams);

    if (id) {
      const achado = await buscarProfissional(null, id);
      // Só redireciona com um slug real em mãos. Sem isso (perfil sem
      // slug, ou Supabase fora do ar) segue o fluxo normal e serve a
      // página — nunca um 301 para uma URL que não resolve.
      if (achado.estado === "ok" && (achado.prof.slug || "").trim()) {
        return redir301(url.origin, achado.prof.slug!.trim(), url.searchParams);
      }
    }
  }

  /* `__falha=1` só existe para o arnês de verificação: força o caminho
     "banco indisponível" e prova que ele NÃO cai no mesmo lugar que
     "perfil não existe". Em produção o parâmetro nunca é enviado, e no
     máximo faz o PostgREST ignorar um filtro desconhecido. */
  const marcadorTeste = url.searchParams.get("__falha") === "1" ? "&__falha=1" : "";
  const busca = await buscarProfissional(slug, id, marcadorTeste);
  const resposta = await context.next();

  /* ── perfil que não existe ────────────────────────────────────────
   * v10.3 · antes isto devolvia 200 com o esqueleto da página: um
   * soft-404. O Google indexa páginas assim como conteúdo real e vazio,
   * e elas competem com os perfis de verdade.
   *
   * O corpo continua sendo a mesma página (o JS do cliente mostra o
   * estado "não encontrado"); o que muda é o status e o noindex, que é
   * o que o crawler lê. */
  if (busca.estado === "ausente" && (slug || id)) {
    /* v12.19e · endereço que mudou (ex.: /p/outro-caraguatatuba-fci9 →
       /p/higienizacao-de-estofados-caraguatatuba-fci9). O banco guarda os
       endereços antigos (professional_slug_antigos) e esta consulta diz
       para onde o perfil foi: 301, e o Google transfere o que já tinha. */
    if (slug) {
      const novo = await slugAtual(slug);
      if (novo && novo !== slug) return redir301(url.origin, novo, url.searchParams);
    }
    const html404 = (await resposta.text()).replace(
      '<meta name="robots" content="noindex"/>',
      '<meta name="robots" content="noindex,nofollow"/>',
    );
    return new Response(html404, {
      status: 404,
      headers: cabecalhos(resposta.headers, CDN_AUSENTE),
    });
  }

  // Requisição sem slug/id nenhum → devolve exatamente o que o Netlify
  // ia servir.
  if (busca.estado !== "ok" && !(slug || id)) return resposta;

  /* v12.1 · Supabase indisponível. Uma queda do banco continua não
   * podendo virar 404 num perfil que existe — e também não pode virar
   * 200 com o `noindex` do estático e sem canonical, que foi o que o
   * Integrity Agent mediu 32 vezes. 503 + Retry-After diz ao Google
   * "temporário"; o canonical vai junto, montado do slug pedido; nada
   * disso entra na CDN. O visitante vê a mesma página de sempre. */
  if (busca.estado !== "ok") {
    let htmlDegradado = await resposta.text();
    const slugPedido = (slug || "").trim();
    if (slugPedido) {
      const canon = `${url.origin}/p/${encodeURIComponent(slugPedido)}`;
      htmlDegradado = htmlDegradado.replace(
        "</head>",
        () => `<link rel="canonical" href="${canon}"/>\n</head>`,
      );
    }
    const h = cabecalhos(resposta.headers, CDN_NUNCA);
    h.set("Retry-After", "120");
    return new Response(htmlDegradado, { status: 503, headers: h });
  }
  const prof = busca.prof;

  let html = await resposta.text();

  /* v10.3 · marca a página como vinda do servidor.
     O cliente lê isto para saber que já existe conteúdo bom na tela e
     não substituí-lo por uma tela de erro se a própria carga falhar. */
  html = html.replace('<html lang="pt-BR">', '<html lang="pt-BR" data-ssr="1">');

  const nome = prof.name || prof.profissao || "Profissional";
  const profissaoDesc = prof.profissao || "profissional"; // aqui SIM precisa de uma palavra, é frase corrida (description/JSON-LD)
  const cidade = prof.city || "";
  const totalServicos = prof.total_servicos_confirmados || 0;
  const totalAvals = prof.total_geral || 0;
  const nota = prof.media_geral ? parseFloat(prof.media_geral) : 0;

  // Mesmo formato que renderTudo() já usa em perfil.html — mantém
  // title/description idênticos entre o que o crawler vê e o que o JS
  // produz um instante depois. Uma diferença: aqui uso o total real da
  // view (total_servicos_confirmados), não os até-20 registros que o
  // client busca — mais preciso pra quem tem mais de 20 serviços.
  // v8.8: mesma regra do FIELDO.UI.subtitulo do db.js — não repetir o que
  // já está escrito. Um perfil real tinha profissao = "Marcelo Ferreira
  // Rodrigues — Eletricista em Caraguatatuba, SP" com city = "Caraguatatuba",
  // e a description saía "...em Caraguatatuba, SP em Caraguatatuba."
  //
  // A causa está no cadastro (corrigido na v8.8, que passou a pedir o nome),
  // mas o dado ruim já existe no banco e vai continuar aparecendo: é assim
  // que as pessoas se apresentam.
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

  // v-perfil-fix3 \u00b7 mesmo c\u00e1lculo que especSemNome() faz no cliente
  // (perfil.html), replicado aqui porque o HTML servido precisa
  // chegar com o MESMO texto que o JS vai mostrar um instante depois
  // \u2014 nunca duas vers\u00f5es da mesma frase (ver coment\u00e1rio grande logo
  // abaixo, "conte\u00fado p\u00fablico no HTML servido"). Parte de
  // `prof.profissao || ""` (vazio, n\u00e3o "profissional") de prop\u00f3sito:
  // \u00e9 o texto exato da linha hero-spec, que sempre mostrou vazio
  // quando a pessoa n\u00e3o preencheu a profiss\u00e3o \u2014 diferente de `espec`
  // logo abaixo, que usa o fallback "profissional" porque vira frase
  // corrida na description/JSON-LD.
  let especHero = (prof.profissao || "").trim();
  if (nome && especHero && norm(especHero).indexOf(norm(nome)) === 0) {
    especHero = especHero.slice(nome.length).replace(/^[\s\u2013\u2014\-\u00b7,:|]+/, "").trim();
  }
  // v12.7 · espelha especParaHero() de perfil.html: a cidade já tem
  // linha própria logo abaixo, então "… em Caraguatatuba" no fim sai.
  {
    const cid = cidade.split(/[,–—-]/)[0].trim();
    if (especHero && cid.length >= 3) {
      const re = new RegExp("\\s+(em|de|-|–|—)\\s+" + cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s*[,/-]\\s*[A-Za-z]{2})?\\.?\\s*$", "i");
      const semCidade = especHero.replace(re, "").trim();
      if (semCidade) especHero = semCidade;
    }
  }

  let espec = profissaoDesc.trim();
  if (nome && espec && norm(espec).indexOf(norm(nome)) === 0) {
    espec = espec.slice(nome.length).replace(/^[\s–—\-·,:|]+/, "").trim();
  }
  // v12.26b · pontuação solta no fim ("Empreiteiro construtor.") saía no
  // título do Google como "Empreiteiro construtor. em Caraguatatuba"
  // (auditoria SEO/GEO, P8). Mesma limpeza de FIELDO.UI.subtitulo (db.js).
  espec = espec.replace(/[\s.,;:·|\-–—]+$/, "").trim();
  especHero = especHero.replace(/[\s.,;:·|\-–—]+$/, "").trim();
  let mostrarCidade = !!cidade;
  if (cidade && espec) {
    const base = cidade.split(/[,–—-]/)[0].trim();
    if (base.length >= 4 && norm(espec).indexOf(norm(base)) !== -1) mostrarCidade = false;
  }
  const oQueFaz = espec + (mostrarCidade ? ` em ${cidade}` : "");

  // v8.8: o title passou a liderar com o que a pessoa FAZ e ONDE. Quem
  // procura no Google digita "eletricista em Caraguatatuba", não o nome de
  // alguém que ainda não conhece — e o title é o campo de maior peso na
  // busca local. Antes gastava o espaço todo com o nome.
  // v12.26b · P8/P9: tituloDaPagina() e descricaoDaPagina(), cópias das de
  // perfil.html (o teste confere as duas).
  const titleTxt = tituloDaPagina(oQueFaz, nome);
  const title = escHtml(titleTxt);
  const fotosTrab = Number(prof.total_fotos_trabalho) || 0;
  const descTxt = descricaoDaPagina({
    oQueFaz, servicos: totalServicos, fotos: fotosTrab, nota, avaliacoes: totalAvals, bio: prof.bio,
  });
  const desc = escHtml(descTxt);

  // ── <head>: title, description, OG (substitui os placeholders que já existem) ──
  html = substituirTexto(html, '<title id="pageTitle">', "</title>", title);
  html = substituirAtributo(
    html,
    '<meta name="description" id="metaDesc" content="Perfil de profissional verificado no Fieldo"/>',
    `<meta name="description" id="metaDesc" content="${desc}"/>`,
  );
  html = substituirAtributo(
    html,
    '<meta property="og:title" id="ogTitle" content="Profissional · Fieldo"/>',
    `<meta property="og:title" id="ogTitle" content="${title}"/>`,
  );
  html = substituirAtributo(
    html,
    '<meta property="og:description" id="ogDesc" content="Veja o histórico e avaliações verificadas"/>',
    `<meta property="og:description" id="ogDesc" content="${desc}"/>`,
  );

  // robots: só index,follow com 3+ serviços — mesmo limiar do client
  // (reports.length >= 3) e do próprio marketplace (explorar.html só
  // lista quem passou desse ponto). Abaixo disso, mantém noindex: perfil
  // "aberto" mas ainda sem prova social suficiente pra valer indexação.
  //
  // v12.26 · a regra mora na vista (`indexavel`): 3 serviços reais, ou
  // biografia de verdade + 6 fotos de trabalho. Foto sem cliente deixou de
  // contar como serviço (auditoria SEO/GEO, P2). Sem a coluna (antes do
  // SQL), a regra antiga.
  const indexar = typeof prof.indexavel === "boolean" ? prof.indexavel : totalServicos >= 3;
  if (indexar) {
    html = substituirAtributo(
      html,
      '<meta name="robots" content="noindex"/>',
      '<meta name="robots" content="index,follow,max-image-preview:large"/>',
    );
  }

  // ── canonical, og:image, og:url, JSON-LD: não existem como placeholder
  // no HTML estático, então são inseridos antes de </head>. ──
  // v10.2 · canonical na forma limpa. A URL antiga com ?slug= já recebe
  // 301 acima; ?id= continua podendo cair aqui e usa o id como fallback.
  const slugCanonico = (prof.slug || slug || prof.id || "").trim();
  const canonicalUrl = `${url.origin}/p/${encodeURIComponent(slugCanonico)}`;
  let injecaoHead = `<link rel="canonical" href="${canonicalUrl}"/>\n` +
    `<meta property="og:url" content="${canonicalUrl}"/>\n`;
  // v12.14 · imagem nos resultados de busca. O Google escolhe a miniatura
  // do resultado entre a og:image, o `image` do JSON-LD e as imagens da
  // página; a foto do profissional agora está nos três. Sem foto de
  // perfil, vale a foto do último serviço publicado (foto_capa, que a view
  // só preenche com o portfólio público). max-image-preview:large, no
  // robots acima, autoriza o Google a mostrar a imagem em tamanho grande.
  const imagens = [prof.logo_url, prof.foto_capa]
    .map((u) => (u || "").trim())
    .filter((u, i, a) => /^https:\/\//.test(u) && a.indexOf(u) === i);
  if (imagens.length) {
    injecaoHead += `<meta property="og:image" content="${escHtml(imagens[0])}"/>\n` +
      `<meta property="og:image:alt" content="${escHtml(nome)}"/>\n` +
      `<meta name="twitter:card" content="summary"/>\n` +
      `<meta name="twitter:image" content="${escHtml(imagens[0])}"/>\n`;
  }

  // v10.30 · movida pra cá (antes vinha só lá embaixo, perto dos cards):
  // o bloco `review` do JSON-LD e o fallback de description precisam do
  // conteúdo público antes de montar `ld`.
  const [conteudo, relacionados] = await Promise.all([buscarConteudo(prof.id), buscarRelacionados(prof)]);
  // v12.26 · foto de trabalho (tipo = 'portfolio') vai para a galeria, não
  // para a lista de serviços nem para o resumo "atua com serviços de…".
  const todosReports = conteudo.reports;
  conteudo.reports = todosReports.filter((r) => r.tipo !== "portfolio");

  // JSON-LD — mesmo shape de renderTudo() em perfil.html (ProfessionalService
  // + aggregateRating condicional). v5.7.7 já documentou por que o bloco
  // de rating é OMITIDO, não zerado, quando não há avaliação: nota 0.0
  // é pior que nota ausente, o Google pode desqualificar o rich result
  // inteiro. Replicado aqui ao pé da letra.
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: nome,
    description: prof.bio || resumoPorCategorias(conteudo.reports) || desc,
    url: canonicalUrl,
  };
  // areaServed passou a ser condicional na v10.1: com city NULL a
  // versão anterior emitia `areaServed: ""`, um campo vazio que só
  // serve pra o validador reclamar.
  // v12.28 · com cidades marcadas, a lista toda (a principal primeiro)
  const atendidas = (Array.isArray(prof.cidades_atendidas) ? prof.cidades_atendidas : []).map((c) => nomeCidade(c));
  if (cidade) ld.areaServed = atendidas.length ? [cidade, ...atendidas] : cidade;
  if (imagens.length) ld.image = imagens;

  // v10.3 · serviceType: o que a pessoa faz, na forma como ela mesma
  // escreveu (`profissao`) ou, na falta, a chave do nicho. Já passou
  // pela limpeza que tira o nome e a cidade repetidos do texto livre,
  // então aqui é só o serviço.
  // O serviceType é o SERVIÇO, sem o "em <cidade>" grudado. O campo
  // `profissao` é texto livre e a base está cheia de "Eletricista em
  // Caraguatatuba, SP" — a cidade já viaja em areaServed e address, e
  // repeti-la aqui transforma o tipo de serviço em endereço.
  // v12.29 · era espec.split(" em ")[0]: "Técnico em Refrigeração e
  // Ar-Condicionado" virava "Técnico". especHero já tira o nome e só o
  // "em <cidade>" do fim, que é o que se queria tirar.
  const servico = especHero || (prof.niche || "").trim();
  if (servico) ld.serviceType = servico;
  // v12.25 · as outras profissões do perfil (mesma lista de perfil.html)
  const outras = outrasRotulos(prof);
  if (outras.length) ld.knowsAbout = [servico, ...outras].filter(Boolean);

  // ── v10.30 · `review` DESTRAVADO ──────────────────────────────────
  // Até aqui isto era só um comentário explicando por que o bloco não
  // existia: `avaliacoes.nome_avaliador` estava NULL em 100% da base,
  // porque avaliar.html nunca pedia o nome. `author` é campo
  // obrigatório de schema.org/Review, e escrever "Cliente" no lugar de
  // alguém que não se identificou seria inventar dado.
  //
  // avaliar.html passou a pedir o primeiro nome (opcional) — quem
  // deixou em branco continua exatamente tão anônimo quanto antes, e
  // essa avaliação continua de fora daqui. Só entra author quando
  // existe nome de verdade. nomeCurto() é a mesma redução que o resto
  // do produto já usa (perfil.html, esta própria function): "Maria",
  // não sobrenome nenhum, porque só o primeiro nome é pedido.
  //
  // Tetado em 10 — mesma ordem de grandeza dos outros limites desta
  // function (12 serviços, 8 avaliações no corpo) — pra não fazer o
  // JSON-LD crescer sem limite num perfil com centenas de avaliações.
  const avaliacoesComAutor = conteudo.avals.filter((a) => (a.nome_avaliador || "").trim() && a.nota);
  if (avaliacoesComAutor.length) {
    ld.review = avaliacoesComAutor.slice(0, 10).map((a) => {
      const r: Record<string, unknown> = {
        "@type": "Review",
        reviewRating: { "@type": "Rating", ratingValue: String(a.nota) },
        author: { "@type": "Person", name: nomeCurto(a.nome_avaliador) },
      };
      if (a.created_at) r.datePublished = a.created_at.slice(0, 10);
      if (a.comentario) r.reviewBody = a.comentario;
      return r;
    });
  }

  // ── v10.1 · address ──────────────────────────────────────────────
  // Os rich results de negócio local praticamente exigem PostalAddress.
  // Mas o Fieldo NÃO tem o endereço do profissional: o cadastro pede
  // cidade, e só. Então o address é montado do que existe de verdade
  // no banco e mais nada — sem street inventada, sem CEP chutado, sem
  // país presumido quando não há sequer cidade.
  //
  // A região vem da coluna `uf` da view, que é o campo certo. Hoje ela
  // está NULL para 100% da base — então addressRegion simplesmente não
  // é emitido, e é assim que tem que ser. Quando o cadastro começar a
  // preenchê-la, o campo aparece sozinho, sem tocar neste arquivo.
  //
  // O fallback lê a UF de dentro de `city`, que é texto livre e chega
  // como "Caraguatatuba" ou "Caraguatatuba, SP". Só aceita duas letras:
  // "Caraguatatuba, Litoral Norte" não é região postal, e marcá-la como
  // tal seria dado errado apresentado como certo.
  //
  // Sem cidade → nenhum bloco address. Ausente é melhor que vazio: o
  // Google desqualifica o rich result inteiro por campo inválido, não
  // por campo faltando. E não há street nem CEP aqui porque o cadastro
  // do Fieldo não pede endereço — inventar um para agradar o validador
  // é exatamente o tipo de conteúdo que a auditoria proibiu.
  if (cidade) {
    const partes = cidade.split(/\s*[,–—-]\s*/).filter(Boolean);
    const localidade = (partes[0] || "").trim();
    const regiao = (prof.uf || partes[1] || "").trim();
    if (localidade) {
      const endereco: Record<string, string> = {
        "@type": "PostalAddress",
        addressLocality: localidade,
        addressCountry: "BR", // único campo que não vem do banco, e é verdade para toda a base: o Fieldo é um produto brasileiro
      };
      if (/^[A-Za-z]{2}$/.test(regiao)) endereco.addressRegion = regiao.toUpperCase();
      ld.address = endereco;
    }
  }

  // v12.13 · CNPJ conferido e formas de pagamento (schema.org: taxID, paymentAccepted)
  if (prof.cnpj && prof.cnpj_situacao === "ATIVA") {
    ld.taxID = fmtCnpj(prof.cnpj);
    if (prof.empresa_nome) ld.legalName = prof.empresa_nome;
  }
  const pgLd = pagamentosTexto(prof.formas_pagamento);
  if (pgLd) ld.paymentAccepted = pgLd.replace(" e ", ", ");

  if (totalAvals > 0 && nota > 0) {
    ld.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: nota.toFixed(1),
      reviewCount: String(totalAvals),
      bestRating: "5",
      worstRating: "1",
    };
  }
  // v8.0 · XSS armazenado: JSON.stringify NÃO escapa "<". Uma bio contendo
  // "</script><script>…" fechava este bloco e o script rodava no perfil
  // público, para qualquer visitante. escHtml() já era aplicado no title e
  // nas metas — só o JSON-LD recebia `nome` e `prof.bio` crus.
  // Escapar "<" como < é seguro para JSON (mesma string após o parse)
  // e impede o fechamento da tag.
  injecaoHead += `<script type="application/ld+json">${
    JSON.stringify(ld).replace(/</g, "\\u003c")
  }</script>\n`;

  // v12.26b · P13 · trilha (Início › Eletricistas em Caraguatatuba › nome)
  // e a página como ProfilePage de uma pessoa. A trilha só passa pela
  // página da cidade quando ela é indexável; senão, pelo Explorar.
  const trilhaMeio = relacionados && relacionados.paginaIndexavel
    ? { name: relacionados.rotulo, item: `${url.origin}/${relacionados.termo}-em-${encodeURIComponent(prof.city_slug || "")}` }
    : { name: "Profissionais", item: `${url.origin}/explorar` };
  const trilha = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Fieldo", item: `${url.origin}/` },
      { "@type": "ListItem", position: 2, ...trilhaMeio },
      { "@type": "ListItem", position: 3, name: nome, item: canonicalUrl },
    ],
  };
  const pessoa: Record<string, unknown> = { "@type": "Person", name: nome, url: canonicalUrl };
  if (servico) pessoa.jobTitle = servico;
  if (prof.logo_url) pessoa.image = prof.logo_url;
  if (outras.length) pessoa.knowsAbout = [servico, ...outras].filter(Boolean);
  if (ld.address) pessoa.workLocation = { "@type": "Place", address: ld.address };
  const paginaPerfil = { "@context": "https://schema.org", "@type": "ProfilePage", url: canonicalUrl, name: titleTxt, mainEntity: pessoa };
  for (const bloco of [trilha, paginaPerfil]) {
    injecaoHead += `<script type="application/ld+json">${JSON.stringify(bloco).replace(/</g, "\\u003c")}</script>\n`;
  }

  // v8.0 · String.replace expande $&, $' e $` na string de substituição.
  // Uma bio com $' injetava o resto inteiro do documento aqui dentro.
  // A forma com função devolve o texto literal, sem interpretar $.
  html = html.replace("</head>", () => injecaoHead + "</head>");

  // ── corpo: mesmos elementos que o JS preenche, valores já prontos ──
  // v12.18 · o nome é o H1 da página (antes era <div> e o perfil não tinha H1).
  html = substituirTexto(html, '<h1 class="hero-name" id="heroName">', "</h1>", escHtml(nome));
  html = substituirTexto(html, '<div class="hero-spec" id="heroSpec">', "</div>", escHtml(especHero));
  // v12.25 · "Também: Encanador · Técnico de ar-condicionado" — mesma
  // frase que perfil.html escreve; no HTML servido para o Google ler.
  {
    const outrasHero = outrasRotulos(prof);
    if (outrasHero.length) {
      html = html.replace('<div class="hero-outras" id="heroOutras" hidden></div>',
        () => `<div class="hero-outras" id="heroOutras">Também: ${escHtml(outrasHero.join(" · "))}</div>`);
    }
  }
  if (cidade) {
    html = substituirTexto(html, '<div class="hero-city" id="heroCity">', "</div>", escHtml(cidade));
  }

  // v10.30 · espelha o bloco "hero-area" de perfil.html: só diz algo
  // quando diz mais do que a cidade já disse. "ambos" (o padrão) fica
  // de fora de propósito — não restringe nada, só empataria a hero.
  const areaPartes: string[] = [];
  // v12.28 · as cidades marcadas e, depois, o texto livre. Igual a
  // FIELDO.Regiao.textoAtende() (db.js), que perfil.html usa.
  const atende = textoAtende(prof);
  if (atende) areaPartes.push(atende);
  if (prof.tipo_atendimento === "residencial") areaPartes.push("Atende só residencial");
  else if (prof.tipo_atendimento === "comercial") areaPartes.push("Atende só comercial");
  if (areaPartes.length) {
    html = substituirAtributo(
      html,
      '<div class="hero-area" id="heroArea" style="display:none">',
      '<div class="hero-area" id="heroArea">',
    );
    html = substituirTexto(html, '<div class="hero-area" id="heroArea">', "</div>", escHtml(areaPartes.join(" · ")));
  }
  if (prof.logo_url) {
    html = substituirTexto(
      html,
      '<div class="hero-avatar" id="heroAvatar">',
      "</div>",
      `<img src="${escHtml(prof.logo_url)}" alt="${escHtml("Foto de " + (prof.name || "perfil"))}"/>`,
    );
  }
  if (totalServicos > 0) {
    html = substituirAtributo(
      html,
      '<div class="hero-verified" style="display:none" id="heroVerified">',
      '<div class="hero-verified" id="heroVerified">',
    );
  }
  // v12.13 · selo "CNPJ ativo" e bloco "Por que confiar"
  if (prof.cnpj && prof.cnpj_situacao === "ATIVA") {
    html = substituirAtributo(html, '<div class="hero-verified" style="display:none" id="heroCnpj">', '<div class="hero-verified" id="heroCnpj">');
  }
  const credHtml = credenciaisHtml(prof);
  if (credHtml) {
    html = substituirAtributo(html, '<div class="sec-bloco" id="secCred" style="display:none">', '<div class="sec-bloco" id="secCred">');
    html = substituirTexto(html, '<div id="credBox">', "</div>", credHtml);
  }
  if (nota > 0 || totalAvals > 0) {
    html = substituirAtributo(
      html,
      '<div class="hero-score-row" id="heroScoreRow" style="display:none">',
      '<div class="hero-score-row" id="heroScoreRow">',
    );
    if (nota > 0) {
      html = substituirTexto(html, '<div class="hero-stat-val" id="heroScore"><em>', "</em>", escHtml(nota.toFixed(1)));
      const cheias = Math.round(nota);
      const estrelas = "★".repeat(cheias) + "☆".repeat(5 - cheias);
      html = substituirTexto(html, '<div class="hero-stat-stars" id="heroStars">', "</div>", estrelas);
    }
    html = substituirTexto(html, '<div class="hero-stat-val" id="heroAvals">', "</div>", String(totalAvals || "—"));
    html = substituirTexto(html, '<div class="hero-stat-val" id="heroServicos">', "</div>", String(totalServicos || "—"));
  }
  /* ── v10.3 · listas de serviços e avaliações no HTML servido ──────
   *
   * Marcadores: os dois containers têm id fixo e hoje trazem apenas
   * esqueletos de carregamento. Substituição cirúrgica, mesma técnica
   * do resto do arquivo: marcador não encontrado → não mexe em nada.
   *
   * O HTML dos cartões é o mesmo que renderTudo() monta no cliente —
   * mesmas classes, mesmo texto, mesmo href. Se divergir, o Google vê
   * uma coisa e a pessoa vê outra, e isso tem nome.
   *
   * v10.30 · `conteudo` já foi buscado lá em cima, antes do JSON-LD
   * (precisa dele pro bloco `review` e pro fallback de description). */

  // v10.30 · ver comentário grande em "BIO" de perfil.html. Quando não
  // há bio, uma frase é derivada da categoria mais frequente entre os
  // serviços REALMENTE registrados — nunca inventada.
  const textoBio = prof.bio || resumoPorCategorias(conteudo.reports);
  if (textoBio) {
    // bioText tem um PAI (bioWrap) também escondido por style — sem
    // mostrar os dois, o texto entra certo no HTML mas continua
    // invisível. O client faz show('bioWrap') separadamente; replico
    // os dois passos aqui.
    html = substituirAtributo(
      html,
      '<div id="bioWrap" style="display:none">',
      '<div id="bioWrap">',
    );
    html = substituirTexto(html, '<p class="bio-text" id="bioText">', "</p>", escHtml(textoBio));
  }

  if (conteudo.reports.length) {
    const cartoes = conteudo.reports.map((r, i) => {
      const fotos = Array.isArray(r.photos) ? r.photos as string[] : [];
      const thumb = fotos[0]
        ? `<img src="${escHtml(String(fotos[0]))}" loading="lazy" alt="${escHtml(fotoAlt(r, oQueFaz, cidade))}"/>`
        : `<div class="service-thumb-ph">${escHtml(((r.category_label || r.niche || r.category_key || "S").trim().charAt(0) || "S").toUpperCase())}</div>`; // v12.9 · inicial, sem ícone
      const nota = r.rating ? `<div class="service-score">${estrelasDe(r.rating)}</div>` : "";
      const rotulo = r.category_label || r.niche || r.category_key || "";
      // v12.7 · só o título do que foi feito, nunca valores nem o nome do
      // cliente — mesmo texto que renderTudo() produz no cliente.
      const titulo = tituloServico(r.titulo_publico ?? r.service_description ?? null, rotulo);
      // v12.9 · sem link: relatorio.html?id= exige login e mandava o
      // visitante (o cliente!) para a tela de entrar. O dono ganha o
      // link de volta no cliente, que sabe quem está logado.
      return `<div class="service-card" data-rid="${escHtml(r.id)}"${i >= SERV_INICIAIS ? " hidden" : ""}>` +
        `<div class="service-thumb">${thumb}</div>` +
        `<div class="service-info">` +
          `<div class="service-titulo">${escHtml(titulo)}</div>` +
          `<div class="service-meta">` +
            (rotulo ? `<span class="service-niche">${escHtml(rotulo)}</span><span class="service-dot"></span>` : "") +
            `<span class="service-date">${escHtml(fmtData(r.service_date || r.created_at))}</span>` +
          `</div>` +
        `</div>` +
        nota +
      `</div>`;
    }).join("");

    html = substituirTexto(html, '<div id="serviceList">', "\n    </div>", cartoes);
    html = substituirTexto(
      html,
      '<div class="sec-count" id="secServCount">',
      "</div>",
      `${totalServicos} ${totalServicos === 1 ? "registrado" : "registrados"}`,
    );
    if (conteudo.reports.length > SERV_INICIAIS) {
      html = substituirAtributo(
        html,
        '<button type="button" class="gal-mais" id="servMais" style="display:none"></button>',
        `<button type="button" class="gal-mais" id="servMais">Ver todos os ${totalServicos} serviços</button>`,
      );
    }
  }

  // v12.26 · galeria "Trabalhos" no HTML servido. Até aqui ela só existia
  // depois do JavaScript; com as fotos de trabalho fora da lista de
  // serviços, um perfil indexado pelas fotos chegaria ao Google sem
  // nenhuma. total_fotos_trabalho > 0 já diz que há consentimento de
  // portfólio (a vista só conta com portfolio_publico). Mesmo texto
  // alternativo de renderGrid() em perfil.html; o cliente redesenha.
  if (fotosTrab > 0) {
    const fotosGal: { url: string; alt: string }[] = [];
    for (const r of todosReports) {
      if (r.portfolio_ok === false) continue;
      const alt = fotoAlt(r, oQueFaz, cidade);
      for (const u of (Array.isArray(r.photos) ? r.photos as unknown[] : [])) {
        if (typeof u === "string" && /^https:\/\//.test(u) && fotosGal.length < 12) fotosGal.push({ url: u, alt });
      }
    }
    if (fotosGal.length) {
      const itens = fotosGal.map((f, i) =>
        `<button class="gal-item" type="button" aria-label="Ver foto ${i + 1}">` +
        `<img src="${escHtml(f.url)}" loading="lazy" alt="${escHtml(f.alt)}"/></button>`
      ).join("");
      html = substituirAtributo(html, '<div style="margin-bottom:1.5rem;display:none" id="secGaleria">', '<div style="margin-bottom:1.5rem" id="secGaleria">');
      html = substituirTexto(html, '<div class="gal-grid" id="galGrid">', "</div>", itens);
      html = substituirTexto(html, '<div class="sec-count" id="secGalCount">', "</div>", `${fotosTrab} ${fotosTrab === 1 ? "foto" : "fotos"}`);
    }
  }

  // v12.29 · "Em resumo" (ver resumoDoPerfil)
  {
    let ultimo: string | null = null;
    for (const r of conteudo.reports) {
      const d = r.service_date || r.created_at || null;
      if (d && (!ultimo || d > ultimo)) ultimo = d;
    }
    const resumo = resumoDoPerfil({
      nome: prof.name, servico: especHero, outras, cidade, uf: prof.uf,
      atendidas, servicos: totalServicos, ultimoServico: ultimo, fotos: fotosTrab,
      nota, avaliacoes: totalAvals, criadoEm: prof.created_at || null,
      atuaDesde: prof.atua_desde || null, cnpjAtivo: !!(prof.cnpj && prof.cnpj_situacao === "ATIVA"),
    });
    html = substituirTexto(html, '<div id="resumo">', "</div>",
      `<p class="resumo"><strong class="resumo-lbl">Em resumo</strong> ${escHtml(resumo)}</p>`);
  }

  // v12.26b · P12 · bloco "Outros eletricistas em Caraguatatuba"
  if (relacionados) {
    const itens = relacionados.itens.map((p) => {
      const nomeR = p.name || p.profissao || "Profissional";
      const foto = p.logo_url || p.foto_capa;
      const fotoHtml = foto
        ? `<img src="${escHtml(foto)}" loading="lazy" alt="${escHtml("Foto de " + nomeR)}"/>`
        : escHtml((nomeR.trim()[0] || "F").toUpperCase());
      const sv = p.total_servicos_confirmados || 0, ft = p.total_fotos_trabalho || 0;
      const prova = sv > 0 ? `${sv} ${sv === 1 ? "serviço" : "serviços"}` : (ft > 0 ? `${ft} ${ft === 1 ? "foto" : "fotos"} de trabalhos` : "");
      const prof2 = (p.profissao || "").replace(/[\s.,;:·|\-–—]+$/, "").trim();
      return `<li><a class="rel-item" href="/p/${encodeURIComponent(p.slug || p.id)}">` +
        `<span class="rel-foto">${fotoHtml}</span>` +
        `<span class="rel-txt"><span class="rel-nome">${escHtml(nomeR)}</span>` +
        `<span class="rel-prof">${escHtml([prof2, prova].filter(Boolean).join(" · "))}</span></span></a></li>`;
    }).join("");
    const todos = relacionados.paginaIndexavel
      ? `<a class="rel-todos" href="/${relacionados.termo}-em-${encodeURIComponent(prof.city_slug || "")}">Ver a lista: ${escHtml(relacionados.rotulo)}</a>`
      : "";
    html = substituirTexto(html, '<div id="relacionados">', "</div>",
      `<section class="rel" aria-labelledby="relTitulo"><div class="sec-head"><h2 class="sec-title" id="relTitulo">${escHtml(relacionados.listaRotulo)}</h2></div>` +
      `<ul class="rel-lista">${itens}</ul>${todos}</section>`);
  }

  if (conteudo.avals.length) {
    const cartoes = conteudo.avals.map((a) => {
      const autor = a.nome_avaliador
        ? `<div class="review-author">${escHtml(nomeCurto(a.nome_avaliador))}</div>`
        : "";
      // v12.7 · era class="review-text", que não existe no CSS: no HTML
      // servido o comentário aparecia sem estilo até o JS trocar.
      const texto = a.comentario
        ? `<div class="review-comment">${escHtml(a.comentario)}</div>`
        : "";
      const resp = (a.resposta || "").trim()
        ? `<div class="review-reply"><div class="review-reply-lbl">Resposta do profissional</div><div>${escHtml(a.resposta)}</div></div>`
        : "";
      return `<div class="review-card">` +
        `<div class="review-head">` +
          `<div class="review-stars">${estrelasDe(a.nota || 0)}</div>` +
          `<div class="review-date">${escHtml(fmtData(a.created_at))}</div>` +
        `</div>` +
        autor + texto + resp +
      `</div>`;
    }).join("");

    html = substituirTexto(html, '<div id="reviewList">', "\n    </div>", cartoes);
    html = substituirTexto(
      html,
      '<div class="sec-count" id="secAvalCount">',
      "</div>",
      `${totalAvals} ${totalAvals === 1 ? "avaliação" : "avaliações"}`,
    );
  } else if (conteudo.completo) {
    // v12.7 · sem nenhuma avaliação a seção some (o cliente faz o mesmo)
    html = substituirAtributo(
      html,
      '<div class="sec-bloco" id="secAvaliacoes">',
      '<div class="sec-bloco" id="secAvaliacoes" style="display:none">',
    );
  }

  return new Response(html, {
    status: resposta.status,
    headers: cabecalhos(resposta.headers, conteudo.completo ? CDN_OK : CDN_NUNCA),
  });
};

export const config: Config = {
  // v10.2 · dois caminhos: a URL nova e a antiga. Declarado também no
  // netlify.toml para manter o registro explícito no deploy.
  path: ["/perfil.html", "/p/*"],
  // v12.1 · liga o cache da resposta desta function na CDN. Quem decide
  // o que fica e por quanto tempo é o Netlify-CDN-Cache-Control de cada
  // resposta (ver CDN_OK / CDN_NUNCA no topo do arquivo).
  cache: "manual",
};
