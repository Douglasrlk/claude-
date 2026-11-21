/* Fieldo v10.1 · Edge Function "explorar-seo" (v12.31: o Explorar inteiro sai daqui)
 *
 * O PROBLEMA QUE ESTA FUNCTION RESOLVE
 * ─────────────────────────────────────────────────────────────────
 * A auditoria de indexação procurou, em todo o HTML estático do
 * projeto, um link para perfil.html partindo de uma página indexável.
 * Não existia nenhum. O único href para perfil.html morava no
 * painel do profissional, que é noindex.
 *
 * Ou seja: os 10 perfis existiam no sitemap.xml e em lugar nenhum
 * mais. Sitemap é uma sugestão de onde olhar; link é um voto de que
 * vale a pena. Num domínio novo, sem nenhum backlink, sugestão sem
 * voto costuma não sair da fila de rastreio — que é exatamente o
 * estado em que o site estava: zero páginas em site:.
 *
 * explorar.html era a página que deveria distribuir esses links, mas
 * o corpo servido era literalmente "Explorar profissionais …
 * Carregando…" — os cards chegavam por JavaScript, depois. Um
 * crawler recebia zero links.
 *
 * Esta function injeta os cards no HTML antes de servir. Mesmo padrão
 * do perfil-seo (substituição cirúrgica ancorada em id que já existe)
 * e mesmo HTML de card que o cliente monta em renderGrid().
 *
 * ── POR QUE NÃO FILTRAR AQUI ────────────────────────────────────
 * A tentação é servir só os perfis "bons" (3+ serviços). Seria
 * cloaking: o cliente com JavaScript vê a lista inteira, porque
 * FIELDO.Marketplace.list() não filtra. Entregar ao robô uma lista
 * diferente da que a pessoa vê é penalizável, e a diferença não teria
 * ganho nenhum.
 *
 * A seleção acontece onde ela pertence, e já acontecia:
 *   · perfil-seo   → noindex abaixo de 3 serviços
 *   · sitemap      → só lista os elegíveis
 * Um link para uma página noindex é normal e não custa nada. Então
 * aqui a regra é simples: o que a pessoa vê é o que o robô vê.
 *
 * Falha de rede, timeout, lista vazia → devolve a página intacta,
 * com os esqueletos de carregamento. Nunca quebra por causa de SEO.
 */
import type { Context, Config } from "@netlify/edge-functions";
/* v10.8 · a regra e o dicionário das páginas de categoria vêm do arquivo
   que as serve. Ver o bloco "o VOTO" mais abaixo.
   v12.31 · e o CARTÃO também: o Explorar usa o mesmo .ll-card das
   páginas por cidade (auditoria de UX/UI de 04/11). */
import { NICHO_POR_TERMO, MIN_INDEXAVEL, MIN_SERVICOS, nomeCidade, cartao, buscarWhatsapp, profissaoLimpa } from "./lista-local.ts";
import type { Prof } from "./lista-local.ts";

const SUPABASE_URL = "https://jrsctnncoljdcvdofxsg.supabase.co";
/* Anon key — não é segredo: já está no db.js, servido a qualquer
   visitante. A proteção real é a RLS do Postgres, não esconder a
   string. Mesma chave das outras duas functions, pelo mesmo motivo. */
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impyc2N0bm5jb2xqZGN2ZG9meHNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTEzMzgsImV4cCI6MjA5MDc4NzMzOH0.XJj5d37fOgK4nN9B3xI_x7P1HE_4lvnYC_qx_5eF0FI";

/* v12.30 · auditoria SEO/GEO, Fase 5 (P15): a ordem padrão passou a
   ser "Recomendados" — quem dá para chamar no WhatsApp primeiro, depois
   serviços registrados, fotos de trabalho e nota. Sem a coluna
   tem_whatsapp (SQL da fase 5 ainda não rodou) → ORDEM_SEM_WA, que é a
   mesma que o cliente usa nesse caso.
   v12.31 · o cliente não busca de novo para reordenar: reordena os
   itens que já estão na página (data-*), com as mesmas chaves. */
export const ORDEM = "tem_whatsapp.desc,total_servicos_confirmados.desc,total_fotos_trabalho.desc,media_geral.desc.nullslast";
export const ORDEM_SEM_WA = ORDEM.replace("tem_whatsapp.desc,", "");
const LIMITE = 60;

function categorias(profs: Prof[]): { href: string; rotulo: string; n: number }[] {
  const porNicho: Record<string, string> = Object.fromEntries(
    Object.entries(NICHO_POR_TERMO).map(([termo, d]) => [d.niche, termo]),
  );
  const balde = new Map<string, { n: number; termo: string; cidade: string }>();

  for (const p of profs) {
    /* v12.26 · mesma regra do perfil-seo e da lista: `indexavel` da vista;
       sem a coluna (antes do SQL), o número de registros */
    if (!(typeof p.indexavel === "boolean" ? p.indexavel : (p.total_servicos_confirmados || 0) >= MIN_SERVICOS)) continue;
    /* v12.25 · todas as profissões do perfil, como em lista-local.ts */
    const todos = Array.isArray(p.nichos) && p.nichos.length ? p.nichos : (p.niche ? [p.niche] : []);
    for (const nicho of new Set(todos)) {
      const termo = porNicho[nicho];
      if (!termo) continue;
      /* v12.28 · cada cidade que a pessoa atende (como lista-local.ts) */
      const cidades = Array.isArray(p.cidades) && p.cidades.length ? p.cidades : (p.city_slug ? [p.city_slug] : []);
      for (const cid of new Set(cidades)) {
        const chave = `${termo}-em-${cid}`;
        const at = balde.get(chave) || { n: 0, termo, cidade: nomeCidade(cid, cid === p.city_slug ? p.city : null) };
        at.n += 1;
        balde.set(chave, at);
      }
    }
  }

  return [...balde.entries()]
    .filter(([, v]) => v.n >= MIN_INDEXAVEL)
    .sort((a, b) => b[1].n - a[1].n)
    .map(([chave, v]) => ({
      href: "/" + chave,
      rotulo: `${NICHO_POR_TERMO[v.termo].plural} em ${v.cidade}`,
      n: v.n,
    }));
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
const plural = (n: number, um: string, muitos: string) => (n === 1 ? um : muitos);
const normal = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

async function listar(): Promise<Prof[] | null> {
  const base = (ordem: string) =>
    `${SUPABASE_URL}/rest/v1/professional_stats?order=${ordem}&limit=${LIMITE}` +
    `&select=id,name,profissao,city,slug,logo_url,foto_capa,plan,media_geral,total_geral,total_servicos_confirmados,niche,city_slug,` +
    `bio,atua_desde,cnpj_situacao,atende_urgencia,created_at`;
  /* da consulta mais nova para a mais antiga: cada SQL que ainda não
     rodou devolve 400 e a seguinte responde (v12.25 nichos e outras
     profissões, v12.26 indexavel e fotos, v12.28 cidades, v12.30 a ordem
     com tem_whatsapp) */
  const tentativas = [
    base(ORDEM) + ",nichos,outras_profissoes,indexavel,total_fotos_trabalho,cidades,tem_whatsapp",
    base(ORDEM_SEM_WA) + ",nichos,outras_profissoes,indexavel,total_fotos_trabalho,cidades",
    base(ORDEM_SEM_WA) + ",nichos,outras_profissoes,indexavel,total_fotos_trabalho",
    base("total_servicos_confirmados.desc"),
  ];
  /* Timeout curto e deliberado, igual ao perfil-seo: isto roda no
     caminho crítico de cada visita. Supabase lento → serve a página
     sem enriquecimento em vez de segurar o visitante. */
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    const h = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
    let r: Response | null = null;
    for (const u of tentativas) {
      r = await fetch(u, { headers: h, signal: ctrl.signal });
      if (r.status !== 400) break;
    }
    if (!r || !r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/* ── o que a página mostra ──────────────────────────────────────
   Duas partes, na mesma ordem:
     1. "Com trabalho comprovado": quem o Google indexa (a coluna
        `indexavel`, a mesma régua do perfil-seo e das listas por
        cidade), no cartão completo, com foto e WhatsApp.
     2. "Também no Fieldo": o resto, numa linha curta. Antes os 12
        perfis sem nada ocupavam 12 cartões de "0 avals. 0 serviços".
   O robô e a pessoa veem a mesma coisa (ver "POR QUE NÃO FILTRAR AQUI").
   Cada item leva em data-* o que o filtro e a ordenação do cliente
   precisam, para não buscar a lista de novo. */
export const comprovado = (p: Prof) =>
  typeof p.indexavel === "boolean" ? p.indexavel : (p.total_servicos_confirmados || 0) >= MIN_SERVICOS;

const NICHO_ROTULO: Record<string, { singular: string; plural: string }> = Object.fromEntries(
  Object.values(NICHO_POR_TERMO).map((d) => [d.niche, { singular: d.singular, plural: d.plural }]),
);
export function rotuloNicho(n: string): string {
  if (NICHO_ROTULO[n]) return NICHO_ROTULO[n].singular;
  const s = String(n || "").replace(/-/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}
export function nichosDe(p: Prof): string[] {
  const base = Array.isArray(p.nichos) && p.nichos.length ? p.nichos : (p.niche ? [p.niche] : []);
  const outras = (Array.isArray(p.outras_profissoes) ? p.outras_profissoes : []).map((o) => o && o.nicho).filter(Boolean) as string[];
  return [...new Set([...base, ...outras])].filter((n) => n && n !== "outro");
}
const nota = (p: Prof) => parseFloat(String(p.media_geral ?? "")) || 0;

export function atributos(p: Prof, i: number, wa: boolean): string {
  const busca = normal([p.name, p.profissao, ...(p.outras_profissoes || []).map((o) => o && o.rotulo), p.city].filter(Boolean).join(" "));
  const criado = Date.parse(String(p.created_at || "")) || 0;
  return ` data-i="${i}" data-cats="${esc(nichosDe(p).join(" "))}" data-busca="${esc(busca)}" data-contato="${wa ? 1 : 0}"` +
    ` data-sv="${p.total_servicos_confirmados || 0}" data-fotos="${p.total_fotos_trabalho || 0}" data-nota="${nota(p) ? nota(p).toFixed(2) : ""}"` +
    ` data-avals="${p.total_geral || 0}" data-criado="${criado}"`;
}

/* a mesma mensagem do botão do perfil (perfil.html, mensagemWhatsApp) */
export function mensagemPerfil(p: Prof): string {
  const nome = String(p.name || "").trim().split(/\s+/)[0] || "";
  let rot = p.niche && NICHO_ROTULO[p.niche] ? NICHO_ROTULO[p.niche].singular : "";
  if (/^[A-ZÀ-Ý][a-zà-ÿ]/.test(rot)) rot = rot.charAt(0).toLowerCase() + rot.slice(1);
  return `Olá${nome ? ", " + nome : ""}! Vi seu perfil${rot ? " de " + rot : ""} no Fieldo e gostaria de pedir um orçamento.\nServiço: \nBairro e cidade: `;
}

const SETA = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`;

export function linha(p: Prof, i: number): string {
  const nome = p.name || "Profissional";
  const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/perfil.html?id=${encodeURIComponent(p.id)}`;
  const av = /^https:\/\//.test(String(p.logo_url || "")) ? `<img src="${esc(p.logo_url)}" alt="" loading="lazy" width="40" height="40"/>` : esc((nome.trim()[0] || "F").toUpperCase());
  const prof = profissaoLimpa(p, rotuloNicho(p.niche || "") || "Profissional");
  const cid = p.city ? nomeCidade(p.city_slug || "", p.city) : "";
  const sv = p.total_servicos_confirmados || 0, ft = p.total_fotos_trabalho || 0;
  const fato = sv > 0 ? `${sv} ${plural(sv, "serviço", "serviços")}` : ft > 0 ? `${ft} ${plural(ft, "foto", "fotos")}` : "Novo no Fieldo";
  return `<li class="ex-linha"${atributos(p, i, false)}><a href="${href}">` +
    `<span class="ex-av">${av}</span>` +
    `<span class="ex-txt"><span class="ex-nome">${esc(nome)}</span><span class="ex-sub">${esc([prof, cid].filter(Boolean).join(" · "))}</span></span>` +
    `<span class="ex-fato">${esc(fato)}${SETA}</span></a></li>`;
}

export function montar(profs: Prof[], whatsapp: Record<string, string>) {
  const bons = profs.filter(comprovado), outros = profs.filter((p) => !comprovado(p));
  const cartoes = bons.map((p, i) => {
    const wa = whatsapp[p.id] || "";
    const cid = p.city ? nomeCidade(p.city_slug || "", p.city) : "";
    return cartao(p, rotuloNicho(p.niche || "") || "Profissional", cid, wa, i, "", "", "", mensagemPerfil(p), atributos(p, i, !!wa || p.tem_whatsapp === true));
  }).join("\n");
  const linhas = outros.map((p, i) => linha(p, bons.length + i)).join("\n");
  /* as profissões que têm alguém, da mais comum para a menos comum */
  const cont = new Map<string, number>();
  for (const p of profs) for (const n of nichosDe(p)) cont.set(n, (cont.get(n) || 0) + 1);
  const chips = [...cont.entries()]
    .sort((a, b) => b[1] - a[1] || rotuloNicho(a[0]).localeCompare(rotuloNicho(b[0]), "pt-BR"))
    .map(([n, q]) => `<button type="button" class="ex-chip" data-cat="${esc(n)}" aria-pressed="false">${esc(rotuloNicho(n))}<small>${q}</small></button>`);
  return {
    cartoes, linhas, nBons: bons.length, nOutros: outros.length,
    chips: `<button type="button" class="ex-chip" data-cat="" aria-pressed="true">Todos<small>${profs.length}</small></button>` + chips.join(""),
  };
}

/* v10.21 · auditoria GEO — dado estruturado da lista.
 * Regra igual à de perfil-seo.ts: espelha o que a página mostra e nada
 * além disso; só name/url/areaServed/serviceType/rating, o suficiente
 * para identificar CADA item sem duplicar o que o perfil já declara. */
function itemListJsonLd(profs: Prof[], origin: string): string {
  const itens = profs.map((p, i) => {
    const nome = p.name || "Profissional";
    const href = p.slug
      ? `${origin}/p/${encodeURIComponent(p.slug)}`
      : `${origin}/perfil.html?id=${encodeURIComponent(p.id)}`;
    const avg = nota(p);
    const entidade: Record<string, unknown> = { "@type": "ProfessionalService", name: nome, url: href };
    if (p.city) entidade.areaServed = p.city;
    const servico = profissaoLimpa(p, "");
    if (servico) entidade.serviceType = servico;
    /* nota 0 é pior que nota ausente: só entra com avaliação de verdade */
    if (avg > 0) {
      entidade.aggregateRating = { "@type": "AggregateRating", ratingValue: avg.toFixed(1), reviewCount: String(p.total_geral || 0), bestRating: "5", worstRating: "1" };
    }
    return { "@type": "ListItem", position: i + 1, item: entidade };
  });
  const ld = {
    "@context": "https://schema.org", "@type": "CollectionPage", name: "Explorar profissionais · Fieldo", url: `${origin}/explorar`,
    mainEntity: { "@type": "ItemList", numberOfItems: itens.length, itemListElement: itens },
  };
  /* JSON.stringify não escapa "<": nome e profissão são texto livre */
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>\n`;
}

/* Troca exata de um marcador do HTML estático. Não achou → não mexe
   (falha segura, mesma técnica do perfil-seo). */
function trocar(html: string, de: string, para: string): string {
  const i = html.indexOf(de);
  return i === -1 ? html : html.slice(0, i) + para + html.slice(i + de.length);
}

export default async (req: Request, context: Context) => {
  const profs = await listar();
  const resposta = await context.next();

  /* Lista vazia → devolve exatamente o que o Netlify ia servir. */
  if (profs && !profs.length) return resposta;

  /* v12.1 · banco lento ou fora: a página estática (o JS tenta de novo),
     com 503 + Retry-After e fora da CDN — o crawler não leva para casa
     uma lista sem nenhum link de perfil como se fosse a página. */
  if (!profs) {
    const h = new Headers(resposta.headers);
    h.set("Netlify-CDN-Cache-Control", "no-store");
    h.set("Retry-After", "120");
    return new Response(resposta.body, { status: 503, headers: h });
  }

  const whatsapp = await buscarWhatsapp(profs.filter(comprovado).map((p) => p.id));
  const m = montar(profs, whatsapp);
  let html = await resposta.text();

  /* v10.1 · canonical segue o domínio que está servindo (canonical-origem.ts) */
  const origin = new URL(req.url).origin;
  html = html.replaceAll("https://fieldo-zelo.com.br", origin);
  html = html.replace("</head>", itemListJsonLd(profs, origin) + "</head>");
  /* v10.3 · a lista já veio pronta: o cliente não pisca esqueleto nem a apaga se a atualização falhar */
  html = html.replace('<html lang="pt-BR">', '<html lang="pt-BR" data-ssr="1">');

  const n = profs.length;
  html = trocar(html, '<div class="ex-chips" id="exChips" role="group" aria-label="Filtrar por profissão"></div>',
    `<div class="ex-chips" id="exChips" role="group" aria-label="Filtrar por profissão">${m.chips}</div>`);
  html = trocar(html, '<p class="ex-conta" id="exConta" aria-live="polite">Carregando…</p>',
    `<p class="ex-conta" id="exConta" aria-live="polite">${n} ${plural(n, "profissional", "profissionais")}</p>`);
  if (m.nBons) {
    html = trocar(html, '<section class="ex-grupo" id="exBons" aria-labelledby="exBonsT" hidden>', '<section class="ex-grupo" id="exBons" aria-labelledby="exBonsT">');
    html = trocar(html, '<ul class="ll-lista" id="exLista"></ul>', `<ul class="ll-lista" id="exLista">\n${m.cartoes}\n</ul>`);
  }
  if (m.nOutros) {
    html = trocar(html, '<section class="ex-grupo" id="exOutros" aria-labelledby="exOutrosT" hidden>', '<section class="ex-grupo" id="exOutros" aria-labelledby="exOutrosT">');
    html = trocar(html, '<ul class="ex-linhas" id="exLinhas"></ul>', `<ul class="ex-linhas" id="exLinhas">\n${m.linhas}\n</ul>`);
  }
  html = trocar(html, '<div class="ex-carregando" id="exCarregando" aria-hidden="true">', '<div class="ex-carregando" id="exCarregando" aria-hidden="true" hidden>');

  /* ── v10.8 · o VOTO para as páginas de categoria ────────────────
   * Uma página que só existe no sitemap não recebe link de lugar nenhum.
   * O Explorar é a página que já linka todo perfil; daqui sai o link
   * para cada "profissão em cidade" que existe (3+ profissionais) e para
   * a região (v12.28). Desde a v12.31, depois da lista, não antes dela. */
  const cats = categorias(profs);
  html = trocar(html, '<ul class="ll-rel" id="exCidades"></ul>',
    `<ul class="ll-rel" id="exCidades"><li><a href="/litoral-norte">Litoral Norte de SP</a></li>` +
    cats.map((c) => `<li><a href="${esc(c.href)}">${esc(c.rotulo)}<small>${c.n}</small></a></li>`).join("") + `</ul>`);

  /* v12.1 · página montada com sucesso fica na CDN (CDN_OK em perfil-seo.ts) */
  const cab = new Headers(resposta.headers);
  cab.delete("content-length");
  cab.delete("etag");
  cab.set("Netlify-CDN-Cache-Control", "public, s-maxage=300, stale-while-revalidate=604800");
  return new Response(html, { status: resposta.status, headers: cab });
};

export const config: Config = {
  /* v10.8 · os DOIS endereços: o menu usa "/explorar", e a function
     casa por path. As duas URLs consolidam no canonical. */
  path: ["/explorar.html", "/explorar"],
  cache: "manual", // v12.1 · ver perfil-seo.ts
};
