/* Fieldo · página de categoria × cidade  —  v9.7
 *
 * Atende URLs como:
 *
 *     /eletricista-em-caraguatatuba
 *     /pedreiro-em-caraguatatuba
 *
 * POR QUE ESTA PÁGINA EXISTE
 * O cliente busca "eletricista em Caraguatatuba". Hoje o site NÃO TEM
 * nenhuma página sobre isso: o explorar.html é um shell genérico,
 * título "Explorar profissionais · Fieldo", preenchido por JavaScript.
 * Antes de discutir autoridade de domínio ou backlink, o problema é
 * mais simples — a página não existe.
 *
 * ── A REGRA QUE IMPEDE ISTO DE VIRAR LIXO ─────────────────────────
 *
 * Uma página "Os melhores eletricistas de Caraguatatuba" listando UMA
 * pessoa é a mesma fraude do diretório que promete 10 e entrega 2. E
 * hoje é exatamente esse o caso: elétrica em Caraguatatuba tem 1
 * profissional qualificado — o dono do produto.
 *
 * Então a decisão é do código, não do otimismo:
 *
 *   >= 3 profissionais  → lista indexável, entra no sitemap
 *      2 profissionais  → lista com noindex: serve quem tem o link,
 *                         não polui o índice com página magra
 *      1 profissional   → 301 para o perfil dele. Com um eletricista,
 *                         o melhor resultado para a busca É o perfil.
 *                         Sem página intermediária fingindo lista.
 *      0                → 404
 *
 * A consequência honesta: HOJE isto não publica nenhuma página
 * indexável. Publica seis redirecionamentos. A máquina liga sozinha
 * quando a oferta chegar — e é esse o ponto.
 *
 * ── O QUE NÃO GERA PÁGINA ────────────────────────────────────────
 * O nicho "outro" é o maior balde de Caraguatatuba (3 pessoas) e é
 * justamente o que NÃO vira página: "Outros em Caraguatatuba" não é
 * busca que alguém faz, e a página seria conteúdo sem assunto. Só
 * gera página o nicho que tem um substantivo que o cliente digita.
 *
 * ── O TEXTO ──────────────────────────────────────────────────────
 * Não promete seleção ("os 10 melhores"), promete o que só o Fieldo
 * tem: serviço com foto, data e avaliação de quem contratou. Essa
 * frase é verdadeira com 3 profissionais e com 40 — não precisa ser
 * reescrita quando a lista crescer, e não mente quando ela é curta.
 */
import type { Context, Config } from "@netlify/edge-functions";
/* v12.31 · topo, rodapé e fontes iguais em todas as páginas de quem contrata */
import { FONTES, topoPublico, rodapePublico, SCRIPT_ENTRAR, IMAGEM_OG } from "../compartilhado/publico.ts";

const SUPABASE_URL = "https://jrsctnncoljdcvdofxsg.supabase.co";
/* Anon key — não é segredo: já está no db.js, servido a qualquer
   visitante. A proteção real é a RLS, não esconder a string. */
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impyc2N0bm5jb2xqZGN2ZG9meHNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTEzMzgsImV4cCI6MjA5MDc4NzMzOH0.XJj5d37fOgK4nN9B3xI_x7P1HE_4lvnYC_qx_5eF0FI";

/* v10.8 · exportados. O sitemap.ts passou a listar estas páginas e
   precisa da MESMA regra e do MESMO dicionário — importar daqui é o que
   impede as duas fontes da verdade que já divergiram uma vez (ver o
   comentário longo no topo do sitemap.ts sobre o sitemap que morava no
   Supabase). */
/* v12.28 · auditoria SEO/GEO (04/11), Fase 3. As cidades do Litoral
   Norte com o nome escrito certo: "sao-sebastiao" não pode virar "Sao
   Sebastiao" no título do Google, e a página de Ubatuba não pode herdar
   o nome da cidade de quem mora em Caraguatatuba e atende lá. A mesma
   lista está em db.js (FIELDO.Regiao). */
export const CIDADES_REGIAO: { slug: string; nome: string }[] = [
  { slug: "caraguatatuba", nome: "Caraguatatuba" },
  { slug: "sao-sebastiao", nome: "São Sebastião" },
  { slug: "ilhabela", nome: "Ilhabela" },
  { slug: "ubatuba", nome: "Ubatuba" },
];
export function nomeCidade(slug: string, reserva?: string | null): string {
  const c = CIDADES_REGIAO.find((x) => x.slug === slug);
  if (c) return c.nome;
  if (reserva) return reserva;
  return slug.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}
export function juntarPt(lista: string[]): string {
  lista = lista.filter(Boolean);
  if (lista.length < 2) return lista.join("");
  return lista.slice(0, -1).join(", ") + " e " + lista[lista.length - 1];
}

/* v12.28 · /litoral-norte só entra no índice com profissionais reais
   suficientes na região inteira (regiao.ts e sitemap.ts). */
export const MIN_REGIAO = 3;

export const MIN_INDEXAVEL = 3;   /* abaixo disto a página não entra no índice */
export const MIN_SERVICOS  = 3;   /* mesmo piso do sitemap e do perfil-seo */

/* O substantivo que o CLIENTE digita → a chave do nicho no banco.
   Repare que 'outro' não está aqui, de propósito. */
export const NICHO_POR_TERMO: Record<string, { niche: string; plural: string; singular: string; servico?: boolean }> = {
  "eletricista":                { niche: "eletrica",        plural: "Eletricistas",              singular: "Eletricista" },
  "encanador":                  { niche: "hidraulica",      plural: "Encanadores",               singular: "Encanador" },
  "pintor":                     { niche: "pintura",         plural: "Pintores",                  singular: "Pintor" },
  "pedreiro":                   { niche: "alvenaria",       plural: "Pedreiros",                 singular: "Pedreiro" },
  "serralheiro":                { niche: "serralheria",     plural: "Serralheiros",              singular: "Serralheiro" },
  "tecnico-de-ar-condicionado": { niche: "ar-condicionado", plural: "Técnicos de ar-condicionado", singular: "Técnico de ar-condicionado" },
  "tecnico-de-informatica":     { niche: "informatica",     plural: "Técnicos de informática",   singular: "Técnico de informática" },
  /* v12.9 · as demais profissões da lista única (FIELDO.Profissoes em
     db.js). Mesma chave, mesmo nome; o teste tests/profissoes.mjs confere. */
  "corretor-de-imoveis"           : { niche: "imoveis", plural: "Corretores de imóveis", singular: "Corretor de imóveis" },
  "empreiteiro"                   : { niche: "construtor", plural: "Empreiteiros", singular: "Empreiteiro" },
  "azulejista"                    : { niche: "azulejista", plural: "Azulejistas", singular: "Azulejista" },
  "gesseiro"                      : { niche: "gesseiro", plural: "Gesseiros", singular: "Gesseiro" },
  "telhadista"                    : { niche: "telhadista", plural: "Telhadistas", singular: "Telhadista" },
  "impermeabilizador"             : { niche: "impermeabilizacao", plural: "Impermeabilizadores", singular: "Impermeabilizador" },
  "marceneiro"                    : { niche: "marceneiro", plural: "Marceneiros", singular: "Marceneiro" },
  "carpinteiro"                   : { niche: "carpinteiro", plural: "Carpinteiros", singular: "Carpinteiro" },
  "vidraceiro"                    : { niche: "vidraceiro", plural: "Vidraceiros", singular: "Vidraceiro" },
  "soldador"                      : { niche: "soldador", plural: "Soldadores", singular: "Soldador" },
  "montador-de-moveis"            : { niche: "montador-de-moveis", plural: "Montadores de móveis", singular: "Montador de móveis" },
  "marido-de-aluguel"             : { niche: "marido-de-aluguel", plural: "Maridos de aluguel", singular: "Marido de aluguel" },
  "desentupidor"                  : { niche: "desentupidor", plural: "Desentupidores", singular: "Desentupidor" },
  "instalador-de-energia-solar"   : { niche: "energia-solar", plural: "Instaladores de energia solar", singular: "Instalador de energia solar" },
  "instalador-de-cameras-e-alarmes": { niche: "cameras-e-alarmes", plural: "Instaladores de câmeras e alarmes", singular: "Instalador de câmeras e alarmes" },
  "tecnico-de-redes-e-internet"   : { niche: "redes-e-internet", plural: "Técnicos de redes e internet", singular: "Técnico de redes e internet" },
  "antenista"                     : { niche: "antenista", plural: "Antenistas", singular: "Antenista" },
  "tecnico-de-eletrodomesticos"   : { niche: "eletrodomesticos", plural: "Técnicos de eletrodomésticos", singular: "Técnico de eletrodomésticos" },
  "tecnico-de-celular"            : { niche: "tecnico-de-celular", plural: "Técnicos de celular", singular: "Técnico de celular" },
  "chaveiro"                      : { niche: "chaveiro", plural: "Chaveiros", singular: "Chaveiro" },
  "jardineiro"                    : { niche: "jardineiro", plural: "Jardineiros", singular: "Jardineiro" },
  "piscineiro"                    : { niche: "piscineiro", plural: "Piscineiros", singular: "Piscineiro" },
  "diarista"                      : { niche: "diarista", plural: "Diaristas", singular: "Diarista" },
  "limpeza-pos-obra"              : { niche: "limpeza-pos-obra", plural: "Limpeza pós-obra", singular: "Limpeza pós-obra", servico: true },
  "higienizacao-de-estofados"     : { niche: "higienizacao-de-estofados", plural: "Higienização de estofados", singular: "Higienização de estofados", servico: true },
  "dedetizador"                   : { niche: "dedetizacao", plural: "Dedetizadores", singular: "Dedetizador" },
  "limpeza-de-caixa-d-agua"       : { niche: "limpeza-de-caixa-dagua", plural: "Limpeza de caixa d'água", singular: "Limpeza de caixa d'água", servico: true },
  "tapeceiro"                     : { niche: "tapeceiro", plural: "Tapeceiros", singular: "Tapeceiro" },
  "costureira"                    : { niche: "costureira", plural: "Costureiras", singular: "Costureira" },
  "fretes-e-mudancas"             : { niche: "fretes-e-mudancas", plural: "Fretes e mudanças", singular: "Fretes e mudanças", servico: true },
  "locacao-de-equipamentos"       : { niche: "locacao-de-equipamentos", plural: "Locação de equipamentos", singular: "Locação de equipamentos", servico: true },
  "mecanico"                      : { niche: "mecanico", plural: "Mecânicos", singular: "Mecânico" },
  "eletricista-automotivo"        : { niche: "eletricista-automotivo", plural: "Eletricistas automotivos", singular: "Eletricista automotivo" },
  "funileiro"                     : { niche: "funilaria", plural: "Funileiros", singular: "Funileiro" },
  "estetica-automotiva"           : { niche: "estetica-automotiva", plural: "Estética automotiva", singular: "Estética automotiva", servico: true },
  "borracheiro"                   : { niche: "borracheiro", plural: "Borracheiros", singular: "Borracheiro" },
  "guincho"                       : { niche: "guincho", plural: "Guinchos", singular: "Guincho", servico: true },
  "cabeleireiro"                  : { niche: "cabeleireiro", plural: "Cabeleireiros", singular: "Cabeleireiro" },
  "barbeiro"                      : { niche: "barbeiro", plural: "Barbeiros", singular: "Barbeiro" },
  "manicure"                      : { niche: "manicure", plural: "Manicures", singular: "Manicure" },
  "maquiador"                     : { niche: "maquiador", plural: "Maquiadores", singular: "Maquiador" },
  "esteticista"                   : { niche: "esteticista", plural: "Esteticistas", singular: "Esteticista" },
  "massoterapeuta"                : { niche: "massoterapeuta", plural: "Massoterapeutas", singular: "Massoterapeuta" },
  "personal-trainer"              : { niche: "personal-trainer", plural: "Personal trainers", singular: "Personal trainer" },
  "professor-particular"          : { niche: "professor-particular", plural: "Professores particulares", singular: "Professor particular" },
  "professor-de-musica"           : { niche: "professor-de-musica", plural: "Professores de música", singular: "Professor de música" },
  "fotografo"                     : { niche: "fotografo", plural: "Fotógrafos", singular: "Fotógrafo" },
  "videomaker"                    : { niche: "videomaker", plural: "Videomakers", singular: "Videomaker" },
  "designer-grafico"              : { niche: "designer-grafico", plural: "Designers gráficos", singular: "Designer gráfico" },
  "buffet-e-eventos"              : { niche: "buffet", plural: "Buffets e eventos", singular: "Buffet e eventos", servico: true },
  "confeiteiro"                   : { niche: "confeiteiro", plural: "Confeiteiros", singular: "Confeiteiro" },
  "cozinheiro"                    : { niche: "cozinheiro", plural: "Cozinheiros", singular: "Cozinheiro" },
  "cuidador-de-idosos"            : { niche: "cuidador-de-idosos", plural: "Cuidadores de idosos", singular: "Cuidador de idosos" },
  "baba"                          : { niche: "baba", plural: "Babás", singular: "Babá" },
  "adestrador"                    : { niche: "adestrador", plural: "Adestradores", singular: "Adestrador" },
  "banho-e-tosa"                  : { niche: "banho-e-tosa", plural: "Banho e tosa", singular: "Banho e tosa", servico: true },
  "arquiteto"                     : { niche: "arquiteto", plural: "Arquitetos", singular: "Arquiteto" },
  "engenheiro-civil"              : { niche: "engenheiro-civil", plural: "Engenheiros civis", singular: "Engenheiro civil" },
  "topografo"                     : { niche: "topografo", plural: "Topógrafos", singular: "Topógrafo" },
  "contador"                      : { niche: "contador", plural: "Contadores", singular: "Contador" },
  "despachante"                   : { niche: "despachante", plural: "Despachantes", singular: "Despachante" },
  "artesao"                       : { niche: "artesao", plural: "Artesãos", singular: "Artesão" },
};

export interface Prof {
  id: string;
  name: string | null;
  profissao: string | null;
  city: string | null;
  slug: string | null;
  bio: string | null;
  /* numeric no Postgres → NÚMERO no JSON do PostgREST. Declarado como
     number|string porque a coluna pode mudar de tipo e esc() já trata
     os dois; declarar só `string` foi a causa do 500 da v10.7. */
  media_geral: number | string | null;
  total_geral: number;
  total_servicos_confirmados: number;
  city_slug?: string | null; // v12.28 · para dizer "mora em …" no cartão de quem só atende a cidade
  /* v12.26 · fotos de trabalho visíveis (portfólio + serviços); só existe depois do SQL da v12.26 */
  total_fotos_trabalho?: number | null;
  /* v12.15 · foto, avatar e os fatos de credibilidade do cartão */
  logo_url?: string | null;
  foto_capa?: string | null;
  atua_desde?: number | null;
  cnpj_situacao?: string | null;
  atende_urgencia?: boolean | null;
  /* v12.25 · mais de uma profissão por perfil */
  niche?: string | null;
  nichos?: string[] | null;
  outras_profissoes?: { rotulo: string; nicho: string }[] | null;
  /* v12.31 · Explorar (explorar-seo.ts usa o mesmo cartão e esta interface) */
  plan?: string | null;
  indexavel?: boolean | null;
  tem_whatsapp?: boolean | null;
  cidades?: string[] | null;
  created_at?: string | null;
}

/* v10.8 · esc() aceita qualquer coisa e converte antes de escapar.
 *
 * O 500 em /eletricista-em-caraguatatuba e /pedreiro-em-caraguatatuba
 * nasceu aqui. `media_geral` é `numeric` no Postgres e o PostgREST
 * serializa numeric como NÚMERO JSON, não string — verificado no banco
 * com jsonb_typeof(to_jsonb(media_geral)) = "number". A interface Prof
 * declarava `string | null`, o cartão chamava esc(p.media_geral), e
 * `s.replace` não existe em número: TypeError, e a Edge Function inteira
 * responde 500.
 *
 * Por que só esta function quebrava: perfil-seo.ts e explorar-seo.ts
 * passam o mesmo campo por parseFloat(), que aceita número. lista-local
 * era a única a mandar o valor cru para uma função de string.
 *
 * A correção é no esc() e não só na chamada, de propósito: qualquer
 * coluna numérica futura (total_geral, valor) cai no mesmo buraco, e um
 * escapador que só funciona quando o tipo está certo é uma armadilha
 * esperando a próxima coluna. */
function esc(s: unknown): string {
  return String(s ?? "")
          .replace(/&/g, "&amp;").replace(/</g, "&lt;")
          .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* "caraguatatuba" → "Caraguatatuba"; "sao-paulo" → "São Paulo" não dá
   sem tabela, então fica "Sao Paulo". Preferi o nome real vindo do
   banco (coluna city) quando existe — este é só o fallback do título
   quando a lista vem vazia. */
function titulizar(slug: string): string {
  return slug.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

/* v12.25 · a lista de "pedreiros em X" inclui quem tem pedreiro como
   OUTRA profissão (coluna nichos = principal + outras). Quem tem como
   principal vem primeiro. Se o banco ainda não tem a coluna (site
   publicado antes do SQL), cai na consulta antiga em vez de quebrar. */
async function buscar(niche: string, citySlug: string): Promise<Prof[] | null> {
  /* v12.26 · quem entra na lista é quem o perfil-seo indexa: a coluna
     `indexavel` da vista (3 serviços reais, ou biografia + 6 fotos de
     trabalho). Antes do SQL da v12.26 ela não existe → 400 → consulta
     antiga, pelo número de registros. */
  /* v12.28 · e quem MORA ou ATENDE a cidade (coluna `cidades` = a
     principal + as marcadas em "Também atende"). Antes do SQL da v12.28
     → 400 → só quem mora (consulta da v12.26). */
  const resto = (filtro: string, cidade = `&city_slug=eq.${encodeURIComponent(citySlug)}`) =>
    cidade + filtro +
    `&select=id,name,profissao,city,city_slug,slug,bio,media_geral,total_geral,total_servicos_confirmados,` +
    `logo_url,foto_capa,atua_desde,cnpj_situacao,atende_urgencia,niche`;
  const ordem = `&order=total_servicos_confirmados.desc&limit=60`;
  const urlV1228 = `${SUPABASE_URL}/rest/v1/professional_stats` +
    `?nichos=cs.${encodeURIComponent("{" + niche + "}")}` +
    resto(`&indexavel=is.true`, `&cidades=cs.${encodeURIComponent("{" + citySlug + "}")}`) +
    `,outras_profissoes,total_fotos_trabalho` + ordem;
  const url = `${SUPABASE_URL}/rest/v1/professional_stats` +
    `?nichos=cs.${encodeURIComponent("{" + niche + "}")}` + resto(`&indexavel=is.true`) +
    `,outras_profissoes,total_fotos_trabalho` + ordem;
  const antiga = `${SUPABASE_URL}/rest/v1/professional_stats` +
    `?niche=eq.${encodeURIComponent(niche)}` + resto(`&total_servicos_confirmados=gte.${MIN_SERVICOS}`) + ordem;

  /* Timeout curto: isto está no caminho crítico de cada visita. Se o
     Supabase estiver lento, é melhor devolver o controle ao site do
     que segurar o visitante. null = "não sei", tratado como passagem. */
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    const h = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
    let r = await fetch(urlV1228, { headers: h, signal: ctrl.signal });
    if (r.status === 400) r = await fetch(url, { headers: h, signal: ctrl.signal });
    if (r.status === 400) r = await fetch(antiga, { headers: h, signal: ctrl.signal });
    if (!r.ok) throw new Error("REST " + r.status);
    const rows: Prof[] = await r.json();
    /* estável: quem mora na cidade primeiro (v12.28), depois quem tem a
       profissão como principal; dentro de cada grupo, por serviços */
    const local = (p: Prof) => (p.city_slug && p.city_slug !== citySlug ? 1 : 0);
    return rows.map((p, i) => ({ p, i }))
      .sort((a, b) => local(a.p) - local(b.p) || (a.p.niche === niche ? 0 : 1) - (b.p.niche === niche ? 0 : 1) || a.i - b.i)
      .map((x) => x.p);
  } catch (e) {
    console.error("[lista-local] falha ao buscar:", e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/* ── v12.15 · auditoria de UX/UI da página da cidade ──────────────────
 *
 * Quem chega aqui veio do Google procurando "eletricista em <cidade>" e
 * quer duas coisas: ver se o trabalho presta e chamar alguém. A versão
 * anterior não mostrava foto nenhuma, não tinha como chamar e o único
 * botão grande era para o PROFISSIONAL se cadastrar. O que mudou:
 *
 *  - Cada cartão abre com a foto do último serviço publicado (foto_capa,
 *    que a view só preenche com portfólio público). É a prova que só o
 *    Fieldo tem — o resto da internet mostra foto de banco de imagem.
 *  - Duas ações por cartão: "Ver serviços e avaliações" (o perfil) e
 *    WhatsApp, quando o profissional cadastrou um número válido.
 *  - Os fatos viraram itens separados (nota, serviços, CNPJ ativo,
 *    urgência, desde quando atua), sem a linha em fonte de máquina.
 *  - A profissão perde o "em <cidade>" repetido; a bio é cortada em
 *    palavra inteira.
 *  - Cabeçalho com a marca, trilha de navegação, links para as outras
 *    profissões da mesma cidade e rodapé: a página deixou de ser beco.
 *  - O convite para profissionais virou uma faixa discreta no fim.
 *  - As fontes da marca passaram a carregar (o título saía em Times).
 *  - "3 avaliaçãoões": o plural somava "ões" ao singular inteiro.
 * ──────────────────────────────────────────────────────────────────── */

type Extras = {
  whatsapp: Record<string, string>;                         // id → número
  relacionadas: { termo: string; plural: string; n: number }[];
};

/* Mesma regra de FIELDO.UI.waNumero (db.js): só celular/fixo brasileiro. */
export function waNumero(bruto: unknown): string {
  let d = String(bruto ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  return "";
}

/* v12.31 · o WhatsApp de uma lista de perfis (id → número no formato do
   wa.me). Só ids de verdade entram na consulta; falha → {}. O Explorar
   usa esta mesma função. */
export async function buscarWhatsapp(ids: string[], ms = 1500): Promise<Record<string, string>> {
  const ok = ids.filter((id) => /^[0-9a-f-]{8,36}$/i.test(id));
  if (!ok.length) return {};
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/professionals?id=in.(${ok.join(",")})&select=id,whatsapp`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }, signal: ctrl.signal });
    if (!r.ok) return {};
    const out: Record<string, string> = {};
    for (const x of await r.json()) { const n = waNumero(x?.whatsapp); if (n) out[x.id] = n; }
    return out;
  } catch {
    return {};
  } finally {
    clearTimeout(t);
  }
}

/* As duas consultas que enriquecem a página. Nenhuma é essencial: se o
   banco demorar, a lista sai sem o botão de WhatsApp e sem os links das
   outras profissões — nunca 503 por causa delas. */
async function buscarExtras(profs: Prof[], citySlug: string, nichoAtual: string): Promise<Extras> {
  const vazio: Extras = { whatsapp: {}, relacionadas: [] };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  const get = (q: string) => fetch(`${SUPABASE_URL}/rest/v1/${q}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    signal: ctrl.signal,
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  try {
    const ids = profs.map((p) => p.id).filter((id) => /^[0-9a-f-]{8,36}$/i.test(id));
    const base = `professional_stats?city_slug=eq.${encodeURIComponent(citySlug)}&limit=500`;
    /* v12.28 · as outras profissões da cidade contam quem mora OU atende */
    const baseCidades = `professional_stats?cidades=cs.${encodeURIComponent("{" + citySlug + "}")}&limit=500`;
    const [wa, nichosV1228] = await Promise.all([
      ids.length ? get(`professionals?id=in.(${ids.join(",")})&select=id,whatsapp`) : null,
      get(baseCidades + `&indexavel=is.true&select=niche,nichos`),
    ]);
    /* v12.25/v12.26/v12.28 · sem as colunas novas (SQL ainda não rodou):
       a consulta de antes de cada uma */
    const nichos = nichosV1228 ?? await get(base + `&indexavel=is.true&select=niche,nichos`) ??
      await get(base + `&total_servicos_confirmados=gte.${MIN_SERVICOS}&select=niche`);
    const out: Extras = { whatsapp: {}, relacionadas: [] };
    if (Array.isArray(wa)) {
      for (const r of wa) { const n = waNumero(r?.whatsapp); if (n) out.whatsapp[r.id] = n; }
    }
    if (Array.isArray(nichos)) {
      const cont: Record<string, number> = {};
      for (const r of nichos) {
        const todos: string[] = Array.isArray(r?.nichos) && r.nichos.length ? r.nichos : (r?.niche ? [r.niche] : []);
        for (const k of new Set(todos)) cont[k] = (cont[k] || 0) + 1;
      }
      const vistos = new Set<string>();
      for (const [termo, d] of Object.entries(NICHO_POR_TERMO)) {
        /* 2+ e não a desta página: com 1 a URL só redireciona para um
           perfil, e um link "Pintores em X" que abre UM pintor engana. */
        if (d.niche === nichoAtual || vistos.has(d.niche) || (cont[d.niche] || 0) < 2) continue;
        vistos.add(d.niche);
        out.relacionadas.push({ termo, plural: d.plural, n: cont[d.niche] });
      }
      out.relacionadas.sort((a, b) => b.n - a.n);
    }
    return out;
  } catch {
    return vazio;
  } finally {
    clearTimeout(t);
  }
}

/* "Eletricista Residencial e Comercial 24h em Caraguatatuba" → sem a
   cidade, que o título da página e o cartão já dizem. Mesma regra do
   serviceType em perfil-seo.ts. */
/* v12.31 · era split(" em ")[0]: "Técnico em Refrigeração e
   Ar-Condicionado" virava "Técnico". Agora só sai o "em <cidade>" do fim,
   como no perfil (perfil-seo.ts, especHero). */
export function profissaoLimpa(p: Prof, origem: string): string {
  let s = (p.profissao || "").trim();
  const cid = String(p.city || "").split(/[,–—-]/)[0].trim();
  if (cid.length >= 3) {
    const re = new RegExp("\\s+(em|de|-|–|—)\\s+" + cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s*[,/-]\\s*[A-Za-z]{2})?\\.?\\s*$", "i");
    s = s.replace(re, "").trim();
  }
  s = s.replace(/[\s.,;:·|\-–—]+$/, "").trim();
  return s || origem;
}

/* v12.31 · fora de uma página de profissão (no Explorar), o cartão diz
   as outras profissões como o perfil diz: "Também: Eletricista · Encanador". */
function outrasRotulos(p: Prof): string[] {
  const out: string[] = [];
  for (const o of Array.isArray(p.outras_profissoes) ? p.outras_profissoes : []) {
    const r = o && typeof o.rotulo === "string" ? o.rotulo.trim() : "";
    if (r && !out.includes(r) && out.length < 3) out.push(r);
  }
  return out;
}

/* v12.25 · está nesta lista por uma das OUTRAS profissões: o cartão diz
   qual, senão "Eletricista" numa página de ar-condicionado parece erro. */
function outraDaPagina(p: Prof, nichoPagina: string): string {
  if (!nichoPagina || p.niche === nichoPagina) return "";
  const o = (Array.isArray(p.outras_profissoes) ? p.outras_profissoes : []).find((x) => x && x.nicho === nichoPagina);
  return o && o.rotulo ? String(o.rotulo).trim() : "";
}

/* Corta em palavra inteira; o CSS ainda limita a 3 linhas. */
function resumo(bio: string | null, max = 170): string {
  const s = (bio || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const corte = s.slice(0, max);
  const fim = corte.lastIndexOf(" ");
  return corte.slice(0, fim > 80 ? fim : max).replace(/[\s.,;:—–-]+$/, "") + "…";
}

const nota1 = (v: unknown) => (parseFloat(String(v ?? "")) || 0).toFixed(1).replace(".", ",");
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const urlFoto = (u: unknown) => /^https:\/\//.test(String(u || "")) ? String(u) : "";

const ICONE_WA = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.6 21.4l4.7-1.2A9.5 9.5 0 1 0 12 2.5Zm0 1.7a7.8 7.8 0 1 1-4.1 14.4l-.3-.2-2.8.7.7-2.7-.2-.3A7.8 7.8 0 0 1 12 4.2Zm-3 3.9c-.2 0-.5 0-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.9 4.5 3.9 2.2.9 2.7.7 3.2.7s1.5-.6 1.7-1.2c.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3l-1.7-.8c-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.4 6.4 0 0 1-3.2-2.8c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.9c-.2-.5-.4-.4-.6-.4H9Z"/></svg>`;
const ICONE_ESTRELA = `<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" focusable="false"><path fill="currentColor" d="m10 1.8 2.5 5.3 5.8.7-4.3 4 1.1 5.7L10 14.7l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7z"/></svg>`;

/* v12.30 · auditoria SEO/GEO, Fase 5 (P15): quem dá para chamar no
   WhatsApp vem primeiro. Dentro de cada grupo, a ordem de buscar()
   (mora na cidade, profissão principal, serviços). Sem a consulta do
   WhatsApp (falhou), a ordem não muda. */
export function comContatoPrimeiro<T extends { id: string }>(profs: T[], whatsapp: Record<string, string>): T[] {
  return profs.map((p, i) => ({ p, i }))
    .sort((a, b) => (whatsapp[a.p.id] ? 0 : 1) - (whatsapp[b.p.id] ? 0 : 1) || a.i - b.i)
    .map((x) => x.p);
}

/* v12.30 · a mensagem pronta diz de que lista veio o pedido (profissão e
   cidade) e já pergunta o serviço e o bairro. */
export function mensagemWhatsApp(nome: string, plural: string, cidade: string): string {
  const primeiro = String(nome || "").trim().split(/\s+/)[0] || "";
  const lista = /^[A-ZÀ-Ý][a-zà-ÿ]/.test(plural) ? plural.charAt(0).toLowerCase() + plural.slice(1) : plural;
  return `Olá${primeiro ? ", " + primeiro : ""}! Vi seu perfil no Fieldo, na lista de ${lista} em ${cidade}, ` +
    `e gostaria de pedir um orçamento.\nServiço: \nBairro: `;
}

/* v12.31 · o mesmo cartão serve o Explorar (explorar-seo.ts): lá não há
   "lista de X em Y", então a mensagem vem pronta (msgWa) e a cidade é a
   do próprio profissional. */
export function cartao(p: Prof, origem: string, cidade: string, wa: string, i: number, nichoPagina = "", citySlugPagina = "", pluralPagina = "", msgWa = "", attrs = ""): string {
  const nome = p.name || "Profissional";
  const href = `/p/${encodeURIComponent(p.slug || p.id)}`;
  const foto = urlFoto(p.foto_capa);
  const avatar = urlFoto(p.logo_url);
  const inicial = esc((nome.trim()[0] || "F").toUpperCase());
  const temNota = (p.total_geral || 0) > 0 && (parseFloat(String(p.media_geral ?? "")) || 0) > 0;
  const sv = p.total_servicos_confirmados || 0;

  const fatos: string[] = [];
  fatos.push(temNota
    ? `<li class="ll-f ll-f--nota">${ICONE_ESTRELA}<strong>${nota1(p.media_geral)}</strong><span>${plural(p.total_geral, "avaliação", "avaliações")}</span></li>`
    : `<li class="ll-f ll-f--sem">Ainda sem avaliação</li>`);
  /* v12.26 · perfil que entrou pelas fotos (0 serviço real): mostra as
     fotos de trabalho, em vez de "0 serviços registrados" */
  const fotosTrab = p.total_fotos_trabalho || 0;
  fatos.push(sv === 0 && fotosTrab > 0
    ? `<li class="ll-f"><strong>${fotosTrab}</strong><span>${fotosTrab === 1 ? "foto de trabalho" : "fotos de trabalhos"}</span></li>`
    : `<li class="ll-f"><strong>${sv}</strong><span>${sv === 1 ? "serviço registrado" : "serviços registrados"}</span></li>`);
  if (p.cnpj_situacao === "ATIVA") fatos.push(`<li class="ll-f ll-f--ok">CNPJ ativo</li>`);
  if (p.atende_urgencia) fatos.push(`<li class="ll-f">Atende urgência</li>`);
  const anoAtual = new Date().getFullYear();
  if (p.atua_desde && p.atua_desde >= 1950 && p.atua_desde <= anoAtual) {
    fatos.push(`<li class="ll-f">Na área desde ${p.atua_desde}</li>`);
  }

  const textoWa = msgWa || mensagemWhatsApp(p.name || "", pluralPagina || origem, cidade);
  const bio = resumo(p.bio);
  /* Os primeiros cartões aparecem sem rolar: carregam já. Os demais, sob demanda. */
  const carga = i < 2 ? `fetchpriority="${i === 0 ? "high" : "auto"}"` : `loading="lazy"`;

  return `<li class="ll-card${foto ? "" : " ll-card--sem-foto"}"${attrs}>
    ${foto ? `<a class="ll-foto" href="${href}" tabindex="-1" aria-hidden="true">
      <img src="${esc(foto)}" alt="${esc(`Trabalho de ${nome}, ${profissaoLimpa(p, origem).toLowerCase()} em ${cidade}`)}" ${carga} decoding="async" width="640" height="400"/>
      <span class="ll-foto-leg">Trabalho recente</span>
    </a>` : ""}
    <div class="ll-corpo">
      <div class="ll-quem">
        <span class="ll-av">${avatar ? `<img src="${esc(avatar)}" alt="" loading="lazy" width="52" height="52"/>` : inicial}</span>
        <div class="ll-quem-txt">
          <h2 class="ll-nome"><a href="${href}">${esc(nome)}</a></h2>
          <p class="ll-prof">${esc(profissaoLimpa(p, origem))}</p>
          ${outraDaPagina(p, nichoPagina) ? `<p class="ll-tambem">Também ${esc(outraDaPagina(p, nichoPagina))}</p>` : ""}
          ${!nichoPagina && outrasRotulos(p).length ? `<p class="ll-tambem">Também: ${esc(outrasRotulos(p).join(" · "))}</p>` : ""}
          ${citySlugPagina && p.city_slug && p.city_slug !== citySlugPagina && p.city ? `<p class="ll-tambem">Mora em ${esc(p.city)} e atende ${esc(cidade)}</p>` : ""}
        </div>
      </div>
      <ul class="ll-fatos" aria-label="Histórico no Fieldo">${fatos.join("")}</ul>
      ${bio ? `<p class="ll-bio">${esc(bio)}</p>` : ""}
      <div class="ll-acoes">
        <a class="ll-btn ll-btn--perfil" href="${href}"><span class="ll-btn-longo">Ver serviços e avaliações</span><span class="ll-btn-curto">Ver perfil</span></a>
        ${wa ? `<a class="ll-btn ll-btn--wa" href="https://wa.me/${wa}?text=${encodeURIComponent(textoWa)}" target="_blank" rel="noopener" data-wa="${esc(p.id)}" aria-label="Chamar ${esc(nome)} no WhatsApp">${ICONE_WA}<span>WhatsApp</span></a>` : ""}
      </div>
    </div>
  </li>`;
}

/* v10.21 · auditoria GEO — dado estruturado desta lista.
 * Espelha só o que o cartão mostra. v12.15: entra a foto (image) de cada
 * profissional e a trilha de navegação (BreadcrumbList), que é a mesma
 * do topo da página. */
function itemListJsonLd(
  profs: Prof[],
  origem: string,
  origin: string,
  h1: string,
  canonical: string,
): string {
  const itens = profs.map((p, i) => {
    const nome = p.name || "Profissional";
    const href = `${origin}/p/${encodeURIComponent(p.slug || p.id)}`;
    const avg = parseFloat(String(p.media_geral ?? "")) || 0;

    const entidade: Record<string, unknown> = {
      "@type": "ProfessionalService",
      name: nome,
      url: href,
      serviceType: profissaoLimpa(p, origem),
    };
    if (p.city) entidade.areaServed = p.city;
    const img = urlFoto(p.logo_url) || urlFoto(p.foto_capa);
    if (img) entidade.image = img;
    if (avg > 0 && (p.total_geral || 0) > 0) {
      entidade.aggregateRating = {
        "@type": "AggregateRating",
        ratingValue: avg.toFixed(1),
        reviewCount: String(p.total_geral || 0),
        bestRating: "5",
        worstRating: "1",
      };
    }
    return { "@type": "ListItem", position: i + 1, item: entidade };
  });

  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: h1,
        url: canonical,
        mainEntity: { "@type": "ItemList", numberOfItems: itens.length, itemListElement: itens },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Fieldo", item: origin + "/" },
          { "@type": "ListItem", position: 2, name: "Profissionais", item: origin + "/explorar" },
          { "@type": "ListItem", position: 3, name: h1, item: canonical },
        ],
      },
    ],
  };
  /* Mesma proteção do perfil-seo contra XSS armazenado. */
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`;
}


function pagina(termo: string, citySlug: string, profs: Prof[], indexavel: boolean, origin: string, extras: Extras): string {
  const t = NICHO_POR_TERMO[termo];
  /* v12.28 · o nome vem da lista da região (com acento), ou de quem mora
     na cidade; nunca de quem só atende (moraria em outra). */
  const cidade = nomeCidade(citySlug, profs.find((p) => p.city_slug === citySlug)?.city || null);
  const n = profs.length;

  const h1 = `${t.plural} em ${cidade}`;
  const title = `${h1} com serviço verificado · Fieldo`;
  /* v12.9 · nome de SERVIÇO ("Limpeza pós-obra") não vira gente. */
  const quem = t.servico
    ? `${n === 1 ? "profissional" : "profissionais"} de ${t.singular.toLowerCase()}`
    : (n === 1 ? t.singular.toLowerCase() : t.plural.toLowerCase());
  const desc = `${n} ${quem} em ${cidade} ` +
    `com histórico de serviços registrados — foto, data e avaliação de quem contratou.`;
  const canonical = `${origin}/${termo}-em-${citySlug}`;
  const ld = indexavel ? itemListJsonLd(profs, t.singular, origin, h1, canonical) : "";

  /* Os números do resumo saem da própria lista: somam o que os cartões mostram. */
  const totalSv = profs.reduce((s, p) => s + (p.total_servicos_confirmados || 0), 0);
  const comNota = profs.filter((p) => (p.total_geral || 0) > 0 && (parseFloat(String(p.media_geral ?? "")) || 0) > 0);
  const totalAv = comNota.reduce((s, p) => s + p.total_geral, 0);
  const media = totalAv
    ? comNota.reduce((s, p) => s + (parseFloat(String(p.media_geral)) || 0) * p.total_geral, 0) / totalAv
    : 0;
  const resumoLista = `Juntos, ${plural(totalSv, "serviço registrado", "serviços registrados")}` +
    (totalAv ? ` e nota média ${media.toFixed(1).replace(".", ",")} em ${plural(totalAv, "avaliação", "avaliações")}.` : ".");

  const imgOg = urlFoto(profs.find((p) => urlFoto(p.foto_capa))?.foto_capa);
  const quemSou = t.servico ? `Trabalha com ${t.singular.toLowerCase()}` : `É ${t.singular.toLowerCase()}`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<meta name="robots" content="${indexavel ? "index,follow,max-image-preview:large" : "noindex,follow"}"/>
<link rel="canonical" href="${esc(canonical)}"/>
<meta property="og:title" content="${esc(h1)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${esc(canonical)}"/>
${imgOg ? `<meta property="og:image" content="${esc(imgOg)}"/>\n<meta name="twitter:card" content="summary_large_image"/>\n` : IMAGEM_OG + "\n"}<meta name="theme-color" content="#f0ece3"/>
<link rel="icon" href="/favicon.ico"/>
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"/>
${FONTES}
${ld}</head>
<body class="pub">
<a class="pub-skip" href="#lista">Pular para a lista</a>
${topoPublico("")}
<main class="pub-wrap">
  <nav class="pub-trilha" aria-label="Você está em">
    <ol>
      <li><a href="/">Fieldo</a></li>
      <li><a href="/explorar">Profissionais</a></li>
      <li aria-current="page">${esc(h1)}</li>
    </ol>
  </nav>

  <header class="pub-cab">
    <h1 class="pub-h1">${esc(t.plural)} em <em>${esc(cidade)}</em></h1>
    <p class="pub-lead">${esc(`${n} ${quem} com trabalho comprovado no Fieldo: fotos de trabalhos, serviços registrados com data e avaliações de quem contratou.`)}</p>
    <p class="pub-soma">${esc(resumoLista)}</p>
  </header>

  <p class="ll-ordem" id="lista">${Object.keys(extras.whatsapp).length ? "Primeiro quem atende pelo WhatsApp, depois por serviços registrados." : "Em ordem de serviços registrados."}</p>
  <ul class="ll-lista">
    ${profs.map((p, i) => cartao(p, t.singular, cidade, extras.whatsapp[p.id] || "", i, t.niche, citySlug, t.plural)).join("\n")}
  </ul>

  <section class="pub-sec" aria-labelledby="confere">
    <h2 class="pub-h2" id="confere">O que o Fieldo confere</h2>
    <dl class="ll-confere">
      <div><dt>Serviço registrado</dt><dd>Lançado pelo profissional com foto, data e categoria, e enviado ao cliente. Foto de trabalho sem cliente aparece à parte e não conta como serviço.</dd></div>
      <div><dt>Avaliação</dt><dd>Feita por quem contratou, pelo link que recebe junto com o relatório do serviço.</dd></div>
      <div><dt>CNPJ ativo</dt><dd>Conferido na Receita Federal quando o profissional informa o CNPJ.</dd></div>
    </dl>
  </section>

  ${extras.relacionadas.length ? `<section class="pub-sec" aria-labelledby="outros">
    <h2 class="pub-h2" id="outros">Outros profissionais em ${esc(cidade)}</h2>
    <ul class="ll-rel">
      ${extras.relacionadas.slice(0, 12).map((r) => `<li><a href="/${r.termo}-em-${encodeURIComponent(citySlug)}">${esc(r.plural)}<small>${r.n}</small></a></li>`).join("")}
      <li><a href="/explorar">Ver todos</a></li>
    </ul>
  </section>` : ""}

  <aside class="ll-pro">
    <p>${esc(quemSou)} em ${esc(cidade)}? Registre seus serviços e apareça nesta lista.</p>
    <a href="/entrar.html?de=lista-local">Criar meu perfil</a>
  </aside>
</main>
${rodapePublico()}
${SCRIPT_ENTRAR}
<script>
/* v12.30 · conta o clique no WhatsApp desta lista (impact_events,
   origem lista_local), como o perfil já conta o dele. Falhar não impede
   nada: o link abre de qualquer jeito. */
(function () {
  var U = "${SUPABASE_URL}/rest/v1/rpc/log_impact_event", K = "${ANON_KEY}";
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[data-wa]") : null;
    if (!a) return;
    try {
      fetch(U, { method: "POST", keepalive: true,
        headers: { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" },
        body: JSON.stringify({ p_professional_id: a.getAttribute("data-wa"), p_event_type: "whatsapp_click", p_source: "lista_local" }) });
    } catch (_) {}
  });
})();
</script>
</body>
</html>`;
}

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const m = /^\/([a-z0-9-]+)-em-([a-z0-9-]+)\/?$/.exec(url.pathname);
  if (!m) return context.next();

  const termo = m[1];
  const citySlug = m[2];
  const t = NICHO_POR_TERMO[termo];
  /* Termo que não é profissão conhecida: deixa passar. Pode ser um
     arquivo real do site com hífen no nome — não é papel desta função
     decidir que ele não existe. */
  if (!t) return context.next();

  const profs = await buscar(t.niche, citySlug);
  /* v12.1 · auditoria 28/10/2026. Era `return context.next()` — e não
     existe arquivo estático neste caminho, então a Netlify respondia 404.
     O Integrity Agent mediu exatamente isso: /eletricista-em-caraguatatuba
     "era 200, agora é 404" em três rodadas. 404 diz ao Google que a
     página acabou. 503 + Retry-After diz que volta. */
  if (profs === null) {
    return new Response("Temporariamente indisponível. Tente de novo em instantes.", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": "120",
        "Netlify-CDN-Cache-Control": "no-store",
      },
    });
  }

  /* 0 → não existe. 404 de verdade, não página vazia: página vazia
     indexada é pior que página nenhuma. */
  if (profs.length === 0) {
    /* v12.44 · a mesma página 404 do site (com caminho de volta), não
       "Não encontrado" em texto puro. Se ela não vier, cai no texto. */
    const pagina404 = await fetch(new URL("/404.html", url.origin))
      .then((r) => (r.ok ? r.text() : null)).catch(() => null);
    return new Response(pagina404 ?? "Não encontrado", {
      status: 404,
      headers: {
        "Content-Type": pagina404 ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
        "Netlify-CDN-Cache-Control": "public, s-maxage=60",
      },
    });
  }

  /* 1 → o melhor resultado para esta busca É o perfil dele. */
  if (profs.length === 1) {
    const p = profs[0];
    return Response.redirect(
      `${url.origin}/p/${encodeURIComponent(p.slug || p.id)}`, 301);
  }

  const indexavel = profs.length >= MIN_INDEXAVEL;
  const extras = await buscarExtras(profs, citySlug, t.niche);
  return new Response(pagina(termo, citySlug, comContatoPrimeiro(profs, extras.whatsapp), indexavel, url.origin, extras), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      /* Curto: a lista muda quando alguém novo qualifica. */
      "Cache-Control": "public, max-age=600",
      /* v12.1 · e na CDN, servindo cópia enquanto revalida. */
      "Netlify-CDN-Cache-Control": "public, s-maxage=600, stale-while-revalidate=604800",
      "X-Fieldo-Lista": `${profs.length}`,
      "X-Fieldo-Indexavel": indexavel ? "sim" : "nao",
    },
  });
};

export const config: Config = {
  pattern: "^/[a-z0-9-]+-em-[a-z0-9-]+/?$",
  cache: "manual", // v12.1 · ver perfil-seo.ts
};
