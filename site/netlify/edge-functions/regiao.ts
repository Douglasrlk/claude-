/**
 * Fieldo · v12.28 · /litoral-norte
 *
 * Auditoria SEO/GEO (04/11), Fase 3 · SEO local.
 *
 * Quem pergunta "onde encontrar pedreiros no Litoral Norte" (no Google
 * ou numa IA) não achava nenhuma página do Fieldo que respondesse: só
 * existiam a home, que fala com o profissional, e uma página por
 * profissão e cidade. Esta é a página da região: as quatro cidades, as
 * profissões que têm profissionais REAIS em cada uma, como contratar e o
 * que o Fieldo confere.
 *
 * Regras, iguais às do resto do site:
 *  - só entra quem o perfil-seo indexa (coluna `indexavel` da vista);
 *  - quem mora numa cidade e marcou outras em "Também atende" aparece em
 *    cada uma, dizendo onde mora;
 *  - profissão com 3+ profissionais na cidade ganha link para a página
 *    dela; com 1 ou 2, os links vão direto para os perfis;
 *  - cidade sem ninguém diz isso, sem inventar lista;
 *  - a página só pede index com MIN_REGIAO profissionais na região
 *    (a mesma conta do sitemap.ts).
 */
import type { Context, Config } from "@netlify/edge-functions";
import { NICHO_POR_TERMO, CIDADES_REGIAO, MIN_REGIAO, MIN_INDEXAVEL, MIN_SERVICOS, nomeCidade } from "./lista-local.ts";
/* v12.31 · topo, rodapé e fontes iguais em todas as páginas de quem contrata */
import { FONTES, topoPublico, rodapePublico, SCRIPT_ENTRAR, IMAGEM_OG } from "../compartilhado/publico.ts";

const SUPABASE_URL = "https://jrsctnncoljdcvdofxsg.supabase.co";
/* Anon key — não é segredo: já está no db.js, servido a qualquer
   visitante. A proteção real é a RLS, não esconder a string. */
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impyc2N0bm5jb2xqZGN2ZG9meHNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTEzMzgsImV4cCI6MjA5MDc4NzMzOH0.XJj5d37fOgK4nN9B3xI_x7P1HE_4lvnYC_qx_5eF0FI";

interface Prof {
  id: string;
  slug: string | null;
  name: string | null;
  profissao: string | null;
  niche: string | null;
  nichos?: string[] | null;
  city: string | null;
  city_slug: string | null;
  cidades?: string[] | null;
  total_servicos_confirmados: number;
  total_fotos_trabalho?: number | null;
  last_public_change?: string | null;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* Três consultas, da mais nova para a mais antiga: cada SQL que ainda
   não rodou devolve 400 e a seguinte responde. */
async function buscar(): Promise<Prof[] | null> {
  const base = `${SUPABASE_URL}/rest/v1/professional_stats?slug=not.is.null&order=total_servicos_confirmados.desc&limit=500` +
    `&select=id,slug,name,profissao,niche,city,city_slug,total_servicos_confirmados,last_public_change`;
  const tentativas = [
    base + `,nichos,cidades,total_fotos_trabalho&indexavel=is.true`,
    base + `,nichos,total_fotos_trabalho&indexavel=is.true`,
    base + `&total_servicos_confirmados=gte.${MIN_SERVICOS}`,
  ];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    const h = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
    let r: Response | null = null;
    for (const u of tentativas) {
      r = await fetch(u, { headers: h, signal: ctrl.signal });
      if (r.status !== 400) break;
    }
    if (!r || !r.ok) throw new Error("REST " + (r ? r.status : "?"));
    return await r.json();
  } catch (e) {
    console.error("[regiao] falha ao buscar:", e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(t);
  }
}

const cidadesDe = (p: Prof) => (Array.isArray(p.cidades) && p.cidades.length ? p.cidades : (p.city_slug ? [p.city_slug] : []));
const nichosDe = (p: Prof) => (Array.isArray(p.nichos) && p.nichos.length ? p.nichos : (p.niche ? [p.niche] : []));
const TERMO_POR_NICHO: Record<string, string> = Object.fromEntries(
  Object.entries(NICHO_POR_TERMO).map(([termo, d]) => [d.niche, termo]),
);

interface Grupo { termo: string; plural: string; singular: string; servico: boolean; profs: Prof[] }
interface Cidade { slug: string; nome: string; grupos: Grupo[]; total: number }

export function montarRegiao(profs: Prof[]): { cidades: Cidade[]; total: number; ultimo: string | null } {
  const reg = new Set(CIDADES_REGIAO.map((c) => c.slug));
  const naRegiao = profs.filter((p) => cidadesDe(p).some((c) => reg.has(c)));
  const cidades: Cidade[] = CIDADES_REGIAO.map((c) => {
    const daqui = naRegiao.filter((p) => cidadesDe(p).includes(c.slug));
    const grupos = new Map<string, Grupo>();
    for (const p of daqui) {
      for (const n of new Set(nichosDe(p))) {
        const termo = TERMO_POR_NICHO[n];
        if (!termo) continue;
        const d = NICHO_POR_TERMO[termo];
        const g = grupos.get(termo) || { termo, plural: d.plural, singular: d.singular, servico: !!d.servico, profs: [] };
        g.profs.push(p);
        grupos.set(termo, g);
      }
    }
    /* quem mora na cidade primeiro; depois por serviços (a ordem da consulta) */
    for (const g of grupos.values()) {
      g.profs = g.profs.map((p, i) => ({ p, i }))
        .sort((a, b) => (a.p.city_slug === c.slug ? 0 : 1) - (b.p.city_slug === c.slug ? 0 : 1) || a.i - b.i)
        .map((x) => x.p);
    }
    return {
      slug: c.slug, nome: c.nome, total: daqui.length,
      grupos: [...grupos.values()].sort((a, b) => b.profs.length - a.profs.length || a.plural.localeCompare(b.plural, "pt-BR")),
    };
  });
  const ultimo = naRegiao.map((p) => p.last_public_change || "").filter(Boolean).sort().pop() || null;
  return { cidades, total: naRegiao.length, ultimo };
}


const PERGUNTAS: [string, string][] = [
  ["Preciso me cadastrar para chamar um profissional?",
    "Não. No perfil do profissional, o botão “Pedir orçamento no WhatsApp” abre a conversa direto com ele, já com uma mensagem pronta."],
  ["O que é um serviço registrado?",
    "É um serviço que o próprio profissional lançou no Fieldo, com foto, data e categoria, e enviou ao cliente. Foto de trabalho sem cliente aparece à parte, na galeria, e não conta como serviço."],
  ["Quem escreve as avaliações?",
    "Quem contratou, pelo link que recebe junto com o relatório do serviço. Só quem tem esse link consegue avaliar, e cada avaliação fica ligada a um serviço registrado."],
  ["O Fieldo cobra de quem contrata?",
    "Não. O Fieldo não cobra do cliente e não intermedia o pagamento: preço, prazo e pagamento são combinados direto com o profissional."],
];

function pagina(origin: string, dados: ReturnType<typeof montarRegiao>, indexavel: boolean): string {
  const canonical = `${origin}/litoral-norte`;
  const nomes = CIDADES_REGIAO.map((c) => c.nome);
  const listaCidades = nomes.slice(0, -1).join(", ") + " e " + nomes[nomes.length - 1];
  const h1 = "Profissionais no Litoral Norte de São Paulo";
  const title = "Profissionais no Litoral Norte de SP · Fieldo";
  /* as profissões com mais gente na região, para a descrição */
  const cont = new Map<string, number>();
  for (const c of dados.cidades) for (const g of c.grupos) cont.set(g.plural, Math.max(cont.get(g.plural) || 0, g.profs.length));
  const top = [...cont.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p.toLowerCase());
  let desc = `Profissionais com fotos de trabalhos e avaliações de quem contratou em ${listaCidades}` +
    (top.length ? `: ${top.join(", ")} e mais.` : ".") + " Contato direto pelo WhatsApp.";
  if (desc.length > 160) desc = `Profissionais com fotos de trabalhos e avaliações em ${listaCidades}. Contato direto pelo WhatsApp.`;

  const perfisNaPagina = new Map<string, Prof>();
  const secoes = dados.cidades.map((c) => {
    if (!c.grupos.length) {
      return `<section class="pub-sec rg-cid" aria-labelledby="c-${c.slug}">
    <h2 class="pub-h2" id="c-${c.slug}">${esc(c.nome)}</h2>
    <p class="rg-vazio">Ainda não há profissionais com trabalho comprovado no Fieldo em ${esc(c.nome)}.</p>
    <p class="rg-convite">É profissional em ${esc(c.nome)}? <a href="/entrar.html?de=litoral-norte">Crie seu perfil</a>, ou, se mora em outra cidade e atende ${esc(c.nome)}, marque a cidade em “Também atende”.</p>
  </section>`;
    }
    const itens = c.grupos.map((g) => {
      const temPagina = g.profs.length >= MIN_INDEXAVEL;
      const rotulo = g.servico ? g.singular : g.plural;
      if (temPagina) {
        return `<li class="rg-grupo"><a class="rg-pag" href="/${g.termo}-em-${c.slug}">${esc(rotulo)} em ${esc(c.nome)}</a> <small>${g.profs.length} profissionais</small></li>`;
      }
      const pessoas = g.profs.map((p) => {
        perfisNaPagina.set(p.id, p);
        const mora = p.city_slug && p.city_slug !== c.slug && p.city ? ` <small>mora em ${esc(p.city)}</small>` : "";
        return `<a href="/p/${encodeURIComponent(p.slug || p.id)}">${esc(p.name || p.profissao || "Profissional")}</a>${mora}`;
      }).join(", ");
      return `<li class="rg-grupo"><span class="rg-prof">${esc(rotulo)}:</span> ${pessoas}</li>`;
    }).join("\n      ");
    return `<section class="pub-sec rg-cid" aria-labelledby="c-${c.slug}">
    <h2 class="pub-h2" id="c-${c.slug}">${esc(c.nome)}</h2>
    <p class="rg-sub">${c.total} ${c.total === 1 ? "profissional que mora ou atende" : "profissionais que moram ou atendem"} em ${esc(c.nome)}.</p>
    <ul class="rg-lista">
      ${itens}
    </ul>
  </section>`;
  }).join("\n\n  ");

  /* JSON-LD: a coleção (as páginas por cidade e os perfis listados), a
     trilha e as perguntas, que estão escritas na página. */
  const itensLd: { url: string; name: string }[] = [];
  for (const c of dados.cidades) for (const g of c.grupos) {
    if (g.profs.length >= MIN_INDEXAVEL) itensLd.push({ url: `${origin}/${g.termo}-em-${c.slug}`, name: `${g.servico ? g.singular : g.plural} em ${c.nome}` });
  }
  for (const p of perfisNaPagina.values()) itensLd.push({ url: `${origin}/p/${encodeURIComponent(p.slug || p.id)}`, name: p.name || p.profissao || "Profissional" });
  const ld = indexavel ? [
    {
      "@context": "https://schema.org", "@type": "CollectionPage", name: h1, description: desc, url: canonical,
      about: { "@type": "Place", name: "Litoral Norte de São Paulo", containsPlace: CIDADES_REGIAO.map((c) => ({ "@type": "City", name: c.nome })) },
      mainEntity: { "@type": "ItemList", numberOfItems: itensLd.length,
        itemListElement: itensLd.map((x, i) => ({ "@type": "ListItem", position: i + 1, url: x.url, name: x.name })) },
    },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Fieldo", item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: "Litoral Norte de SP", item: canonical },
    ] },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: PERGUNTAS.map(([q, a]) => ({
      "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ] : [];
  const ldHtml = ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>\n`).join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<meta name="robots" content="${indexavel ? "index,follow" : "noindex,follow"}"/>
<link rel="canonical" href="${esc(canonical)}"/>
<meta property="og:title" content="${esc(h1)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${esc(canonical)}"/>
${IMAGEM_OG}
<meta name="theme-color" content="#f0ece3"/>
<link rel="icon" href="/favicon.ico"/>
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"/>
${FONTES}
${ldHtml}</head>
<body class="pub">
${topoPublico("regiao")}
<main class="pub-wrap">
  <nav class="pub-trilha" aria-label="Você está em">
    <ol>
      <li><a href="/">Fieldo</a></li>
      <li aria-current="page">Litoral Norte de SP</li>
    </ol>
  </nav>

  <header class="pub-cab">
    <h1 class="pub-h1">Profissionais no <em>Litoral Norte</em> de São Paulo</h1>
    <p class="pub-lead">Profissionais de ${esc(listaCidades)} com o trabalho à mostra: fotos de trabalhos, serviços registrados com data e avaliações de quem contratou. O contato é direto com o profissional, pelo WhatsApp, sem cadastro.</p>
    <ul class="rg-cidades" aria-label="Cidades">
      ${dados.cidades.map((c) => `<li><a href="#c-${c.slug}">${esc(c.nome)}</a></li>`).join("")}
    </ul>
  </header>

  ${secoes}

  <section class="pub-sec" aria-labelledby="como">
    <h2 class="pub-h2" id="como">Como contratar pelo Fieldo</h2>
    <ol class="rg-passos">
      <li>Escolha a profissão e a cidade e abra os perfis.</li>
      <li>Veja as fotos de trabalhos, os serviços registrados e as avaliações de quem já contratou.</li>
      <li>Toque em “Pedir orçamento no WhatsApp” e combine preço, prazo e pagamento direto com o profissional.</li>
    </ol>
    <p class="rg-mais"><a href="/como-contratar">Como contratar: o passo a passo completo e o que cada informação do perfil quer dizer</a></p>
  </section>

  <section class="pub-sec" aria-labelledby="perguntas">
    <h2 class="pub-h2" id="perguntas">Perguntas de quem contrata</h2>
    <dl class="rg-faq">
      ${PERGUNTAS.map(([q, a]) => `<div><dt>${esc(q)}</dt><dd>${esc(a)}</dd></div>`).join("\n      ")}
    </dl>
  </section>
</main>
${rodapePublico()}
${SCRIPT_ENTRAR}
</body>
</html>`;
}

export default async (request: Request, _context: Context) => {
  const url = new URL(request.url);
  const profs = await buscar();
  /* Banco fora: 503 com Retry-After, nunca 404 nem página vazia indexável
     (mesma decisão de lista-local.ts, v12.1). */
  if (profs === null) {
    return new Response("Temporariamente indisponível. Tente de novo em instantes.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "120", "Netlify-CDN-Cache-Control": "no-store" },
    });
  }
  const dados = montarRegiao(profs);
  const indexavel = dados.total >= MIN_REGIAO;
  return new Response(pagina(url.origin, dados, indexavel), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=600",
      "Netlify-CDN-Cache-Control": "public, s-maxage=600, stale-while-revalidate=604800",
      "X-Fieldo-Regiao": `${dados.total}`,
      "X-Fieldo-Indexavel": indexavel ? "sim" : "nao",
    },
  });
};

export const config: Config = {
  path: ["/litoral-norte", "/litoral-norte/"],
  cache: "manual",
};
