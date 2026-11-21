/* Fieldo v10.1 · Edge Function "sitemap"
 *
 * POR QUE O SITEMAP MUDOU DE CASA
 * ─────────────────────────────────────────────────────────────────
 * Até a v10.0 o sitemap era uma function no Supabase, alcançada por
 * um proxy declarado no netlify.toml:
 *
 *     /sitemap.xml  ->  supabase.co/functions/v1/sitemap   (status 200)
 *
 * Funcionava, mas tinha três defeitos que a auditoria de indexação
 * expôs de uma vez:
 *
 *   1. Listava /perfil.html?slug=… e a v10.1 passou a canonizar
 *      /p/…. Sitemap apontando para uma URL cujo canonical aponta
 *      para OUTRA é um sinal contraditório — o Google registra a
 *      discrepância e desconfia das duas.
 *   2. Não listava "/" nem a landing. A página mais indexável do
 *      projeto estava fora do próprio sitemap.
 *   3. Listava perfis sem checar elegibilidade. Um perfil com menos
 *      de 3 serviços sai com noindex pelo perfil-seo — pedir ao
 *      Google que indexe uma URL que se declara noindex gera erro
 *      "URL enviada marcada como noindex" no Search Console, e esse
 *      erro contamina a leitura do sitemap inteiro.
 *
 * Os três vinham da mesma causa: a regra de indexação morava no
 * repositório (perfil-seo.ts) e o sitemap morava em outro projeto.
 * Duas fontes da verdade que ninguém sincronizava.
 *
 * Agora é um arquivo só, ao lado da function que decide o noindex,
 * com a constante do limiar compartilhada por leitura direta. Quando
 * o limiar mudar, muda nos dois porque é o mesmo número escrito no
 * mesmo lugar.
 *
 * A function do Supabase pode ser desativada — nada mais aponta pra
 * ela. Deixá-la publicada não quebra nada, só não é mais usada.
 */
import type { Context, Config } from "@netlify/edge-functions";
import { vitrineIndexavel } from "./vitrine.ts"; /* v12.32 */
/* v10.8 · a regra das páginas de categoria vem do arquivo que as serve.
   Ver o bloco "AS PÁGINAS DE CATEGORIA" mais abaixo. */
import { NICHO_POR_TERMO, MIN_INDEXAVEL, MIN_REGIAO, CIDADES_REGIAO } from "./lista-local.ts";

const SUPABASE_URL = "https://jrsctnncoljdcvdofxsg.supabase.co";
/* Anon key — não é segredo: já está no db.js, servido a qualquer
   visitante. A proteção real é a RLS do Postgres. */
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impyc2N0bm5jb2xqZGN2ZG9meHNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTEzMzgsImV4cCI6MjA5MDc4NzMzOH0.XJj5d37fOgK4nN9B3xI_x7P1HE_4lvnYC_qx_5eF0FI";

/* O MESMO limiar do perfil-seo.ts (`if (totalServicos >= 3)`) e do
   lista-local.ts (MIN_SERVICOS). Abaixo disto o perfil é servido com
   noindex — então não pode entrar aqui. Um sitemap que lista páginas
   noindex é um sitemap que o Search Console marca como cheio de
   erros. */
const MIN_SERVICOS_INDEXAVEL = 3;

interface Prof {
  id: string;
  slug: string | null;
  total_servicos_confirmados: number;
  last_public_change: string | null;
  /* v10.8 · vieram junto para montar as páginas de categoria sem uma
     segunda consulta. Ver agruparCategorias(). */
  niche: string | null;
  nichos?: string[] | null; // v12.25 · principal + outras profissões
  city_slug: string | null;
  cidades?: string[] | null; // v12.28 · cidade principal + as que a pessoa atende
}

/* ── AS PÁGINAS DE CATEGORIA (v10.8) ──────────────────────────────
 *
 * /eletricista-em-caraguatatuba existia, respondia e não estava aqui.
 * Também não recebia link de nenhuma página. Sitemap é sugestão e link
 * é voto — ela não tinha nem um nem outro, então para o Google
 * simplesmente não existia.
 *
 * A regra de quais URLs entram é a MESMA do lista-local.ts, importada
 * dele: só o par nicho × cidade com MIN_INDEXAVEL profissionais ou mais.
 * Abaixo disso a página sai com noindex (2) ou vira 301 para o perfil
 * (1), e listar aqui uma URL que se declara noindex é o erro que
 * contamina a leitura do sitemap inteiro no Search Console — a mesma
 * razão pela qual perfis abaixo do piso já ficavam de fora.
 *
 * O termo da URL é a CHAVE do dicionário ("eletricista"), não o nicho do
 * banco ("eletrica") — por isso o mapa invertido.
 */
const TERMO_POR_NICHO: Record<string, string> = Object.fromEntries(
  Object.entries(NICHO_POR_TERMO).map(([termo, def]) => [def.niche, termo]),
);

function agruparCategorias(profs: Prof[]): { caminho: string; lastmod: string | null }[] {
  const balde = new Map<string, { n: number; lastmod: string | null }>();

  for (const p of profs) {
    /* v12.25 · cada profissão do perfil (principal + outras) conta para
       a página dela — a mesma regra de lista-local.ts. */
    const todos = Array.isArray(p.nichos) && p.nichos.length ? p.nichos : (p.niche ? [p.niche] : []);
    for (const nicho of new Set(todos)) {
      const termo = TERMO_POR_NICHO[nicho];
      /* Nicho fora do dicionário (inclusive 'outro', excluído de
         propósito lá) não vira página — e portanto não entra aqui. */
      if (!termo) continue;
      /* v12.28 · cada cidade que a pessoa atende (a mesma regra da
         página: quem mora OU atende). Sem a coluna, só a principal. */
      const cidades = Array.isArray(p.cidades) && p.cidades.length ? p.cidades : (p.city_slug ? [p.city_slug] : []);
      for (const cid of new Set(cidades)) {
        const chave = `${termo}-em-${cid}`;
        const atual = balde.get(chave) || { n: 0, lastmod: null };
        atual.n += 1;
        /* A lista muda quando qualquer perfil dela muda. */
        if (p.last_public_change &&
            (!atual.lastmod || p.last_public_change > atual.lastmod)) {
          atual.lastmod = p.last_public_change;
        }
        balde.set(chave, atual);
      }
    }
  }

  return [...balde.entries()]
    .filter(([, v]) => v.n >= MIN_INDEXAVEL)
    .sort((a, b) => b[1].n - a[1].n)
    .map(([caminho, v]) => ({ caminho: "/" + caminho, lastmod: v.lastmod }));
}

/* Páginas fixas. São as públicas e indexáveis — nada de painel,
   entrar, planos ou qualquer tela que exija sessão: essas estão no
   Disallow do robots.txt e listá-las aqui seria pedir ao Google que
   ignore o próprio robots.

   "/" e não "/index.html": as duas servem o mesmo arquivo, e é "/"
   que o canonical da landing declara. */
const FIXAS = [
  { caminho: "/", prioridade: "1.0", frequencia: "weekly" },
  /* v10.11 · a URL limpa, a mesma que o canonical do explorar declara
     e a mesma para onde todo link interno aponta. Listar a forma .html
     aqui enquanto o canonical apontava para outra era o sinal
     contraditório que o comentário no topo deste arquivo descreve. */
  { caminho: "/explorar", prioridade: "0.8", frequencia: "daily" },
  /* v12.29 · páginas para quem contrata e sobre a empresa (auditoria
     SEO/GEO, Fase 4). Estáticas: como-contratar.html e sobre.html,
     servidas sem o .html, que é a forma do canonical delas. */
  { caminho: "/como-contratar", prioridade: "0.8", frequencia: "monthly" },
  { caminho: "/sobre", prioridade: "0.6", frequencia: "monthly" },
  /* v12.26 · /verificar.html saiu (auditoria SEO/GEO, P18): é uma
     ferramenta para conferir um documento, não conteúdo para busca. */
  /* v12.23 · páginas públicas do assistente de IA. Conteúdo estático em
     /ia/…/index.html, gerado por ia-gerador. Barra no fim: é a forma que
     o canonical de cada uma declara. */
  { caminho: "/ia/", prioridade: "0.9", frequencia: "weekly" },
  { caminho: "/ia/orcamento/", prioridade: "0.8", frequencia: "monthly" },
  { caminho: "/ia/contratos/", prioridade: "0.8", frequencia: "monthly" },
  { caminho: "/ia/relatorio-de-servico/", prioridade: "0.7", frequencia: "monthly" },
  { caminho: "/ia/eletricista/", prioridade: "0.8", frequencia: "monthly" },
  { caminho: "/ia/pedreiro/", prioridade: "0.8", frequencia: "monthly" },
  { caminho: "/ia/pintor/", prioridade: "0.8", frequencia: "monthly" },
];

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/* v10.3 · <lastmod> vem do banco, numa coluna.
 *
 * A v10.2 restaurou o lastmod puxando até 50.000 linhas de `reports` e
 * 50.000 de `avaliacoes` a CADA requisição de /sitemap.xml, para
 * agrupar em memória aqui dentro. Funciona com 11 perfis; não funciona
 * com mil. É varredura completa de duas tabelas no caminho crítico de
 * um recurso público, sob timeout de 5s — e agrupamento é trabalho de
 * banco.
 *
 * A migração v10_3 adicionou `last_public_change` à view
 * professional_stats: o maior entre a edição do perfil, o serviço
 * público mais recente e a avaliação mais recente. Exatamente o que
 * muda o que a página pública mostra.
 *
 * Duas consultas viraram nenhuma: o campo vem junto com o resto.
 * Sem data → <lastmod> omitido, nunca inventado.
 */
function lastmod(valor: string | null | undefined): string {
  if (!valor) return "";
  const d = new Date(valor);
  if (isNaN(d.getTime())) return "";
  // W3C Datetime completo — o Google usa a hora para priorizar
  // rastreio, e a view já entrega o timestamp com fuso.
  return `    <lastmod>${d.toISOString()}</lastmod>\n`;
}

/* v12.1 · auditoria 28/10/2026: null = a consulta falhou. O sitemap só
   com as páginas fixas continua sendo servido (é verdade), mas não pode
   ficar na CDN no lugar do completo. */
async function elegiveis(): Promise<Prof[] | null> {
  const url =
    `${SUPABASE_URL}/rest/v1/professional_stats` +
    `?total_servicos_confirmados=gte.${MIN_SERVICOS_INDEXAVEL}` +
    `&active=is.true` +
    `&slug=not.is.null` +
    /* v10.8 · niche e city_slug entram no MESMO select: as páginas de
       categoria são agrupadas em memória a partir destas linhas, sem
       uma segunda consulta no caminho crítico. */
    `&select=id,slug,total_servicos_confirmados,last_public_change,niche,city_slug` +
    `&order=total_servicos_confirmados.desc&limit=5000`;
  /* v12.25 · com nichos (todas as profissões); sem a coluna, a antiga.
     v12.26 · e pela coluna `indexavel` da vista, a mesma que o
     perfil-seo usa para liberar o index (3 serviços reais, ou biografia
     + 6 fotos de trabalho). Antes do SQL da v12.26 → 400 → a antiga. */
  const comNichos = url
    .replace(`?total_servicos_confirmados=gte.${MIN_SERVICOS_INDEXAVEL}`, `?indexavel=is.true`)
    .replace("niche,city_slug", "niche,nichos,city_slug");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const h = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
    /* v12.28 · + cidades (principal + atendidas); sem a coluna, a de cima */
    let r = await fetch(comNichos.replace("niche,nichos,city_slug", "niche,nichos,city_slug,cidades"), { headers: h, signal: ctrl.signal });
    if (r.status === 400) r = await fetch(comNichos, { headers: h, signal: ctrl.signal });
    if (r.status === 400) r = await fetch(url, { headers: h, signal: ctrl.signal });
    if (!r.ok) throw new Error("REST " + r.status);
    return await r.json();
  } catch (e) {
    /* Falha de rede não pode virar 500: o Search Console trata
       sitemap que erra como "não foi possível buscar" e para de
       tentar por um tempo. Devolve o sitemap com as páginas fixas,
       que é sempre verdade, e loga a falha. */
    console.error("[sitemap] falha ao buscar perfis:", e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/* v12.2 · vitrines das locadoras (/l/:slug). Mesma regra da página
   (vitrine.ts): só entra a que tem pelo menos um equipamento visível —
   sem isso ela se declara noindex, e URL noindex no sitemap é o erro
   descrito lá em cima. O !inner faz o filtro no banco, e a RLS já
   limita a equipamentos públicos e ativos de locadora publicada. */
/* v12.32 · e esse equipamento precisa ter foto: a mesma vitrineIndexavel()
   da página. Sem isso a página se declara noindex e não pode estar aqui. */
interface Vitrine { slug: string | null; updated_at: string | null; equipamentos?: { fotos?: unknown }[] }

async function vitrines(): Promise<Vitrine[] | null> {
  const url =
    `${SUPABASE_URL}/rest/v1/locadoras?is_public=eq.true&slug=not.is.null` +
    `&select=slug,updated_at,equipamentos!inner(id,fotos)&order=updated_at.desc&limit=5000`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(url, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error("REST " + r.status);
    return await r.json();
  } catch (e) {
    console.error("[sitemap] falha ao buscar vitrines:", e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(t);
  }
}

export default async (req: Request, context: Context) => {
  const origin = new URL(req.url).origin;
  const [resultado, resultadoVitrines] = await Promise.all([elegiveis(), vitrines()]);
  const incompleto = resultado === null || resultadoVitrines === null;
  const profs = resultado ?? [];

  const entradas: string[] = [];

  for (const f of FIXAS) {
    entradas.push(
      `  <url>\n` +
      `    <loc>${escXml(origin + f.caminho)}</loc>\n` +
      `    <changefreq>${f.frequencia}</changefreq>\n` +
      `    <priority>${f.prioridade}</priority>\n` +
      `  </url>`,
    );
  }

  /* v10.8 · páginas de categoria, logo depois das fixas: são páginas de
     entrada, mais importantes que um perfil isolado e menos que a home. */
  /* v12.28 · /litoral-norte: a mesma regra de regiao.ts (MIN_REGIAO
     profissionais indexáveis que moram ou atendem alguma das 4 cidades) */
  {
    const reg = new Set(CIDADES_REGIAO.map((c) => c.slug));
    const naRegiao = profs.filter((p) =>
      (Array.isArray(p.cidades) && p.cidades.length ? p.cidades : [p.city_slug]).some((c) => !!c && reg.has(c)));
    if (naRegiao.length >= MIN_REGIAO) {
      const ult = naRegiao.map((p) => p.last_public_change).filter(Boolean).sort().pop() || null;
      entradas.push(
        `  <url>\n` +
        `    <loc>${escXml(origin + "/litoral-norte")}</loc>\n` +
        lastmod(ult) +
        `    <changefreq>weekly</changefreq>\n` +
        `    <priority>0.9</priority>\n` +
        `  </url>`,
      );
    }
  }

  for (const c of agruparCategorias(profs)) {
    entradas.push(
      `  <url>\n` +
      `    <loc>${escXml(origin + c.caminho)}</loc>\n` +
      lastmod(c.lastmod) +
      `    <changefreq>weekly</changefreq>\n` +
      `    <priority>0.9</priority>\n` +
      `  </url>`,
    );
  }

  for (const p of profs) {
    /* slug=not.is.null já filtra no banco; esta segunda checagem
       existe porque slug pode ser string vazia, que não é NULL e
       geraria "/p/" — uma URL que não resolve. */
    const slug = (p.slug || "").trim();
    if (!slug) continue;
    entradas.push(
      `  <url>\n` +
      `    <loc>${escXml(origin + "/p/" + encodeURIComponent(slug))}</loc>\n` +
      lastmod(p.last_public_change) +
      `    <changefreq>weekly</changefreq>\n` +
      `    <priority>0.9</priority>\n` +
      `  </url>`,
    );
  }

  for (const v of resultadoVitrines ?? []) {
    const slug = (v.slug || "").trim();
    if (!slug || !vitrineIndexavel(v.equipamentos || [])) continue;
    entradas.push(
      `  <url>\n` +
      `    <loc>${escXml(origin + "/l/" + encodeURIComponent(slug))}</loc>\n` +
      lastmod(v.updated_at) +
      `    <changefreq>weekly</changefreq>\n` +
      `    <priority>0.8</priority>\n` +
      `  </url>`,
    );
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entradas.join("\n") + `\n` +
    `</urlset>\n`;

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      /* 1 hora. O sitemap muda quando um profissional cruza o terceiro
         serviço — evento raro, mas que não deve esperar um dia pra
         valer. Mesma lógica do cache curto do robots.txt. */
      "Cache-Control": incompleto ? "no-cache" : "public, max-age=3600",
      "Netlify-CDN-Cache-Control": incompleto
        ? "no-store"
        : "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
};

export const config: Config = {
  path: "/sitemap.xml",
  cache: "manual", // v12.1 · ver perfil-seo.ts
};
