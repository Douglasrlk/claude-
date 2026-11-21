/* Fieldo · Edge Function "vitrine" — v12.2
 *
 * A página pública da locadora: /l/:slug
 *
 *     /l/edificar-caraguatatuba
 *
 * ── POR QUE EXISTE ──────────────────────────────────────────────
 * Até a v12.1 o botão "Publicar" do painel da Locação gravava
 * locadoras.is_public = true e mais nada acontecia: não existia página
 * pública, e o próprio painel admitia isso ("a página pública de
 * vitrine ainda está em construção"). A locadora tinha catálogo, preço
 * e WhatsApp cadastrados, e nenhum cliente conseguia ver.
 *
 * ── COMO É MONTADA ──────────────────────────────────────────────
 * Inteira no servidor, como a lista-local: não há arquivo estático por
 * trás e nenhum JavaScript é necessário para ler a página. É o que o
 * Google e o preview do WhatsApp recebem.
 *
 * Duas consultas com a anon key, que a RLS já limita ao que é público:
 *   - locadoras: só is_public = true (policy locadora_select_public)
 *   - equipamentos: só is_public AND ativo AND locadora.is_public
 *     (policy equip_select_public)
 * Os campos pedidos são só os de vitrine. CNPJ, Pix e endereço não
 * entram — o endereço da locadora pode ser a casa do dono, e o cliente
 * combina a retirada pelo WhatsApp.
 *
 * ── STATUS ──────────────────────────────────────────────────────
 *   locadora publicada               → 200, na CDN (mesmo padrão v12.1)
 *     sem nenhum equipamento COM FOTO → 200 com noindex: página magra
 *     (v12.32 · era "0 equipamento". Uma vitrine de teste, com três
 *     equipamentos sem foto e descrição de 4 a 6 letras, entrou no
 *     Google. A régua agora é a mesma ideia do perfil: só entra com
 *     prova — pelo menos um equipamento com foto.)
 *   não existe ou não publicada      → 404 (60 s na CDN)
 *   banco lento ou fora              → 503 + Retry-After, fora da CDN
 */
import type { Context, Config } from "@netlify/edge-functions";

const SUPABASE_URL = "https://jrsctnncoljdcvdofxsg.supabase.co";
/* Anon key — não é segredo: já está no db.js, servido a qualquer
   visitante. A proteção real é a RLS, não esconder a string. */
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impyc2N0bm5jb2xqZGN2ZG9meHNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTEzMzgsImV4cCI6MjA5MDc4NzMzOH0.XJj5d37fOgK4nN9B3xI_x7P1HE_4lvnYC_qx_5eF0FI";

const CDN_OK      = "public, s-maxage=300, stale-while-revalidate=604800";
const CDN_AUSENTE = "public, s-maxage=60";

interface Locadora {
  id: string;
  nome: string | null;
  slug: string | null;
  city: string | null;
  uf: string | null;
  bio: string | null;
  logo_url: string | null;
  whatsapp: string | null;
  instagram: string | null;
  entrega: boolean | null;
  raio_entrega_km: number | null;
  updated_at: string | null;
}

interface Equipamento {
  id: string;
  nome: string | null;
  marca: string | null;
  modelo: string | null;
  descricao: string | null;
  fotos: unknown;
  preco_dia: number | string | null;
  preco_semana: number | string | null;
  preco_quinzena?: number | string | null; /* v12.42 */
  preco_mes: number | string | null;
  caucao: number | string | null;
  quantidade: number | null;
  slug: string | null;
  /* v12.19 · "Condições de aluguel" e "Informações adicionais" do
     cadastro do equipamento (coluna jsonb que já existia, sem uso) */
  specs?: { condicoes?: unknown; info?: unknown } | null;
  categoria: { nome: string | null; slug: string | null } | null;
}

type Busca =
  | { estado: "ok"; loc: Locadora; equips: Equipamento[] }
  | { estado: "ausente" }
  | { estado: "indisponivel" };

/* ── utilitários ─────────────────────────────────────────────────── */

/* Aceita qualquer coisa: numeric do Postgres chega como número JSON, e
   foi exatamente um `s.replace` em número que derrubou a lista-local
   na v10.8. */
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* R$ 1.234,50 — sem depender de Intl no runtime. Inteiro sai sem
   centavos ("R$ 169"), que é como locadora escreve preço de diária. */
function brl(v: number, centavosSempre = false): string {
  const inteiro = Math.floor(v);
  const cent = Math.round((v - inteiro) * 100);
  const milhar = String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (!cent && !centavosSempre) return `R$ ${milhar}`;
  return `R$ ${milhar},${String(cent).padStart(2, "0")}`;
}

/* Espelha FIELDO.UI.waNumero (db.js, v5.5.2): número inválido devolve
   '' e o botão NÃO aparece. Melhor botão ausente que botão que abre o
   WhatsApp em branco. */
function waNumero(bruto: unknown): string {
  let d = String(bruto ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  return "";
}

function waLink(numero: string, texto: string): string {
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/* v12.3 · todas as fotos válidas, na ordem que a locadora escolheu
   (a primeira é a capa). Só https — nada de javascript: ou data:. */
/* v12.32 · a regra do index, exportada para o sitemap.ts usar a mesma */
export function vitrineIndexavel(equips: { fotos?: unknown }[]): boolean {
  return equips.some((e) => fotosValidas(e.fotos).length > 0);
}

export function fotosValidas(f: unknown): string[] {
  if (!Array.isArray(f)) return [];
  return f.map((x) => (typeof x === "string" ? x : (x && typeof x === "object" ? (x as { url?: unknown }).url : null)))
    .filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u))
    .slice(0, 5);
}

function primeiraFoto(f: unknown): string | null {
  if (!Array.isArray(f) || !f.length) return null;
  const x = f[0] as unknown;
  const u = typeof x === "string" ? x : (x && typeof x === "object" ? (x as { url?: unknown }).url : null);
  return typeof u === "string" && /^https:\/\//.test(u) ? u : null;
}

function marcaModelo(e: Equipamento): string {
  return [e.marca, e.modelo].map((s) => (s || "").trim()).filter(Boolean).join(" ");
}

/* "Betoneira 400l" já diz o que é; "Jusa" (só a marca) não diz. O nome
   do card é o que a locadora escreveu; quando ele não contém a
   categoria, a categoria vem em cima, como rótulo. */
function rotuloCategoria(e: Equipamento): string {
  return (e.categoria?.nome || "").trim();
}

function listaNatural(itens: string[]): string {
  if (itens.length <= 1) return itens[0] || "";
  return itens.slice(0, -1).join(", ") + " e " + itens[itens.length - 1];
}

/* ── consultas ───────────────────────────────────────────────────── */

async function rest<T>(caminho: string, signal: AbortSignal): Promise<T[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    signal,
  });
  if (!r.ok) throw new Error("REST " + r.status);
  return await r.json();
}

async function buscar(slug: string): Promise<Busca> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    const locs = await rest<Locadora>(
      `locadoras?slug=eq.${encodeURIComponent(slug)}&is_public=eq.true` +
      `&select=id,nome,slug,city,uf,bio,logo_url,whatsapp,instagram,entrega,raio_entrega_km,updated_at&limit=1`,
      ctrl.signal,
    );
    if (!locs[0]) return { estado: "ausente" };
    const loc = locs[0];
    const consulta = (comQuinzena: boolean) => rest<Equipamento>(
      `equipamentos?locadora_id=eq.${encodeURIComponent(loc.id)}&is_public=eq.true&ativo=eq.true` +
      `&select=id,nome,marca,modelo,descricao,fotos,preco_dia,preco_semana,${comQuinzena ? "preco_quinzena," : ""}preco_mes,caucao,quantidade,slug,specs,` +
      `categoria:equipamento_categorias(nome,slug)&order=nome.asc`,
      ctrl.signal,
    );
    /* v12.42 · se este código for ao ar antes da migration
       2026-11-21_locacao_precos_periodo.sql, a coluna ainda não existe e o
       PostgREST responde 400. A vitrine é pública: melhor sair sem o preço
       quinzenal do que fora do ar. */
    const equips = await consulta(true).catch((e) =>
      String(e && (e as Error).message) === "REST 400" ? consulta(false) : Promise.reject(e));
    return { estado: "ok", loc, equips };
  } catch (e) {
    console.error("[vitrine] falha ao buscar:", e instanceof Error ? e.message : e);
    return { estado: "indisponivel" };
  } finally {
    clearTimeout(t);
  }
}

/* ── JSON-LD ─────────────────────────────────────────────────────── */

function jsonLd(loc: Locadora, equips: Equipamento[], canonical: string, wa: string): string {
  const cidade = (loc.city || "").trim();
  const idLocadora = canonical + "#locadora";
  const negocio: Record<string, unknown> = {
    "@type": "LocalBusiness",
    "@id": idLocadora,
    name: loc.nome,
    url: canonical,
  };
  if (loc.bio) negocio.description = loc.bio;
  if (cidade) {
    negocio.areaServed = cidade;
    const endereco: Record<string, string> = { "@type": "PostalAddress", addressLocality: cidade, addressCountry: "BR" };
    if (loc.uf && /^[A-Za-z]{2}$/.test(loc.uf.trim())) endereco.addressRegion = loc.uf.trim().toUpperCase();
    negocio.address = endereco;
  }
  if (wa) negocio.telephone = "+" + wa;
  if (loc.logo_url && /^https:\/\//.test(loc.logo_url)) negocio.image = loc.logo_url;

  /* v12.44 · Search Console, 20/11: "Listagens do comerciante — o campo
   * hasMerchantReturnPolicy não foi encontrado (em offers)".
   *
   * Histórico: a v12.2 usava Offer → itemOffered: Product e levou erro
   * crítico de "Snippets do produto"; a v12.3b passou a Product com Offer
   * dentro. Isso calou o erro, mas declarou a vitrine como LOJA: Product +
   * Offer com preço é o que o Google chama de listagem de comerciante,
   * "página onde o cliente compra o produto". Daí o pedido de política de
   * devolução e de frete — que não existem num aluguel. Pior: a diária
   * (R$ 179) podia aparecer na aba Shopping como preço de VENDA da
   * betoneira.
   *
   * Inventar uma política de devolução para calar o aviso seria marcação
   * falsa. O que a página oferece é um serviço de locação, e é assim que
   * fica: cada equipamento é uma Offer de LOCAÇÃO (businessFunction
   * LeaseOut, o termo do schema.org para alugar) cujo itemOffered é um
   * Service, dentro do catálogo da locadora. Todos os períodos que a
   * locadora cadastrou entram como UnitPriceSpecification. Sem Product,
   * o Google não trata a página como loja (sai das listagens de
   * comerciante e dos snippets de produto) e o dado continua legível
   * para busca e para assistentes de IA.
   *
   * availability segue de fora: a vitrine não sabe se o equipamento está
   * livre hoje — isso é combinado no WhatsApp. */
  const ofertas = equips
    .map((e) => {
      const precos = precosDe(e);
      if (!precos.length) return null;
      const urlItem = `${canonical}#${encodeURIComponent(e.slug || e.id)}`;
      const nome = [e.nome, marcaModelo(e)].filter(Boolean).join(" · ");
      const servico: Record<string, unknown> = {
        "@type": "Service",
        name: `Aluguel de ${nome}`,
        serviceType: "Aluguel de equipamento",
        provider: { "@id": idLocadora },
      };
      if (e.descricao) servico.description = e.descricao;
      if (rotuloCategoria(e)) servico.category = rotuloCategoria(e);
      if (cidade) servico.areaServed = cidade;
      const fotos = fotosValidas(e.fotos);
      if (fotos.length) servico.image = fotos;
      return {
        "@type": "Offer",
        "@id": urlItem,
        url: urlItem,
        name: nome,
        businessFunction: "http://purl.org/goodrelations/v1#LeaseOut",
        priceCurrency: "BRL",
        priceSpecification: precos.map((p) => ({
          "@type": "UnitPriceSpecification",
          price: p.valor.toFixed(2),
          priceCurrency: "BRL",
          ...(p.unitCode ? { unitCode: p.unitCode } : {}),
          unitText: p.unitText,
        })),
        itemOffered: servico,
        offeredBy: { "@id": idLocadora },
      };
    })
    .filter(Boolean);
  if (ofertas.length) {
    negocio.hasOfferCatalog = { "@type": "OfferCatalog", name: "Equipamentos para alugar", itemListElement: ofertas };
  }

  const ld = { "@context": "https://schema.org", "@graph": [negocio] };
  /* Mesmo cuidado do perfil-seo v8.0: JSON.stringify não escapa "<",
     e o nome/descrição vêm de texto livre da locadora. */
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>\n`;
}

/* ── página ──────────────────────────────────────────────────────── */

/* v12.5 · auditoria de UX/UI da vitrine (28/10).
 *
 * O que mudou e por quê, na ordem do que mais pesa para quem aluga:
 *  - A foto é o que decide um aluguel e estava num quadrado de 112 px.
 *    Agora ocupa o topo do card (4:3); com mais de uma, desliza para o
 *    lado (scroll-snap, sem JavaScript) — antes eram miniaturas que
 *    abriam outra aba.
 *  - Eram até 7 botões pretos iguais na tela. O WhatsApp agora tem uma
 *    cor só dele (verde), um botão principal por tela e, nos cards, um
 *    botão contornado. No celular, a barra fixa é o botão principal.
 *  - "Unidades" saiu: é o tamanho da frota, não o que está livre hoje,
 *    e o cliente lia como disponibilidade.
 *  - Lista virou grade (1, 2 ou 3 colunas): no computador sobrava
 *    metade do card vazia.
 *  - "Como alugar" virou os três passos que de fato são.
 *  - A barra fixa não repete mais o nome da locadora (quebrava em duas
 *    linhas com nome longo). */

const ICONE_WA = `<svg class="vt-ic" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.6 21.4l4.7-1.2A9.5 9.5 0 1 0 12 2.5Zm0 1.7a7.8 7.8 0 1 1-4.1 14.4l-.3-.2-2.8.7.7-2.7-.2-.3A7.8 7.8 0 0 1 12 4.2Zm-3 3.9c-.2 0-.5 0-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.9 4.5 3.9 2.2.9 2.7.7 3.2.7s1.5-.6 1.7-1.2c.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3l-1.7-.8c-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.4 6.4 0 0 1-3.2-2.8c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.9c-.2-.5-.4-.4-.6-.4H9Z"/></svg>`;

function textoSpec(e: Equipamento, k: "condicoes" | "info"): string {
  const v = e.specs && typeof e.specs === "object" ? (e.specs as Record<string, unknown>)[k] : null;
  return typeof v === "string" ? v.trim() : "";
}

/* v12.42 · preços por período, na ordem dia → mês, só os que a locadora
   preencheu. O primeiro é o destaque do cartão. */
const PERIODOS = [
  { campo: "preco_dia", rotulo: "Diária", por: "por dia", unitCode: "DAY", unitText: "diária" },
  { campo: "preco_semana", rotulo: "Semana", por: "por semana", unitCode: "WEE", unitText: "semana" },
  { campo: "preco_quinzena", rotulo: "Quinzena", por: "por quinzena", unitCode: "", unitText: "quinzena (15 dias)" },
  { campo: "preco_mes", rotulo: "Mês", por: "por mês", unitCode: "MON", unitText: "mês (30 dias)" },
] as const;
function precosDe(e: Equipamento) {
  return PERIODOS.map((p) => ({ ...p, valor: num((e as unknown as Record<string, unknown>)[p.campo]) }))
    .filter((p): p is typeof p & { valor: number } => p.valor !== null);
}

function cartao(e: Equipamento, loc: Locadora, wa: string, indice: number): string {
  const id = e.slug || e.id;
  const nome = (e.nome || rotuloCategoria(e) || "Equipamento").trim();
  const cat = rotuloCategoria(e);
  const mm = marcaModelo(e);
  const fotos = fotosValidas(e.fotos);
  const precos = precosDe(e), principal = precos[0], caucao = num(e.caucao);

  /* Os dois primeiros cards carregam já; o resto, quando chegar perto. */
  const carregar = indice < 2 ? "eager" : "lazy";
  const midia = fotos.length
    ? `<div class="vt-midia">
        <div class="vt-galeria" ${fotos.length > 1 ? `tabindex="0" role="region" aria-label="Fotos de ${esc(nome)}: deslize para ver ${fotos.length}"` : ""}>
          ${fotos.map((u, i) => `<img src="${esc(u)}" alt="${esc(nome)}${fotos.length > 1 ? ` — foto ${i + 1} de ${fotos.length}` : ""}" loading="${i === 0 ? carregar : "lazy"}" decoding="async" width="800" height="600"/>`).join("")}
        </div>
        ${fotos.length > 1 ? `<span class="vt-nfotos" aria-hidden="true">${fotos.length} fotos ›</span>` : ""}
      </div>`
    : `<div class="vt-midia vt-midia--vazia" aria-hidden="true"><span>${esc(cat || "Equipamento")}</span><small>sem foto</small></div>`;

  const outros = precos.slice(1).map((p) => `${p.rotulo} <b>${esc(brl(p.valor))}</b>`);

  const msg = `Olá! Vi ${nome}${mm ? ` (${mm})` : ""} na vitrine de ${loc.nome} no Fieldo. ` +
    `Está disponível? Preciso para o dia `;

  return `<li class="vt-card" id="${esc(id)}">
    ${midia}
    <div class="vt-corpo">
      ${cat && !nome.toLowerCase().includes(cat.toLowerCase()) ? `<div class="vt-cat">${esc(cat)}</div>` : ""}
      <h3 class="vt-nome">${esc(nome)}</h3>
      ${mm ? `<div class="vt-mm">${esc(mm)}</div>` : ""}
      ${e.descricao ? `<p class="vt-desc">${esc(e.descricao.slice(0, 240))}</p>` : ""}
      ${textoSpec(e, "info") ? `<p class="vt-desc vt-info">${esc(textoSpec(e, "info").slice(0, 300))}</p>` : ""}
      ${textoSpec(e, "condicoes") ? `<p class="vt-cond"><b>Condições:</b> ${esc(textoSpec(e, "condicoes").slice(0, 300))}</p>` : ""}
      <div class="vt-preco">
        ${principal
          ? `<div class="vt-diaria"><span class="vt-valor">${esc(brl(principal.valor))}</span><span class="vt-unid">${principal.por}</span></div>`
          : `<div class="vt-diaria"><span class="vt-sob">Preço sob consulta</span></div>`}
        ${outros.length ? `<div class="vt-outros">${outros.join('<span aria-hidden="true"> · </span>')}</div>` : ""}
        ${caucao ? `<div class="vt-caucao">Caução de ${esc(brl(caucao))}, acertada na devolução</div>` : ""}
      </div>
      ${wa ? `<a class="vt-btn vt-btn--wa-sec" href="${esc(waLink(wa, msg))}" target="_blank" rel="noopener">${ICONE_WA}Pedir no WhatsApp</a>` : ""}
    </div>
  </li>`;
}

function pagina(loc: Locadora, equips: Equipamento[], origin: string): string {
  const nome = (loc.nome || "Locadora").trim();
  const cidade = (loc.city || "").trim();
  const canonical = `${origin}/l/${encodeURIComponent(loc.slug || loc.id)}`;
  const wa = waNumero(loc.whatsapp);
  const indexavel = vitrineIndexavel(equips); /* v12.32 · ver o topo do arquivo */
  const logo = loc.logo_url && /^https:\/\//.test(loc.logo_url) ? loc.logo_url : "";
  /* v12.3 · prévia do link no WhatsApp: a foto de perfil; sem ela, a capa
     do primeiro equipamento que tiver foto. */
  const ogImagem = logo || equips.map((e) => fotosValidas(e.fotos)[0]).find(Boolean) || "";

  const categorias = [...new Set(equips.map((e) => rotuloCategoria(e)).filter(Boolean))];
  const precos = equips.map((e) => num(e.preco_dia)).filter((n): n is number => n !== null);
  const menor = precos.length ? Math.min(...precos) : null;
  /* v12.42 · há quem só alugue por semana ou mês: o rótulo da seção não
     pode prometer "preço por diária" para esses. */
  const soDiaria = equips.every((e) => precosDe(e).every((p) => p.campo === "preco_dia"));
  const temPreco = equips.some((e) => precosDe(e).length > 0);

  const oQue = categorias.length ? listaNatural(categorias.slice(0, 4).map((c) => c.toLowerCase())) : "equipamentos";
  const title = `${nome} · Aluguel de ${oQue}${cidade ? ` em ${cidade}` : ""}`;
  const desc =
    `${nome}: aluguel de ${oQue}${cidade ? ` em ${cidade}` : ""}. ` +
    (menor ? `Diárias a partir de ${brl(menor)}. ` : "") +
    (wa ? "Peça direto pelo WhatsApp." : "");

  /* Equipamento com foto primeiro: é o que o cliente olha antes de rolar.
     Dentro de cada grupo, a ordem que veio do banco (por nome). */
  const ordenados = equips.slice().sort((a, b) =>
    Number(fotosValidas(b.fotos).length > 0) - Number(fotosValidas(a.fotos).length > 0));

  const fatos = [
    `${equips.length} ${equips.length === 1 ? "equipamento" : "equipamentos"}`,
    menor ? `Diárias a partir de ${brl(menor)}` : "",
    loc.entrega ? (loc.raio_entrega_km ? `Entrega até ${loc.raio_entrega_km} km` : "Faz entrega") : "Retirada combinada",
  ].filter(Boolean);

  const msgGeral = `Olá! Vi a vitrine de ${nome} no Fieldo e quero alugar um equipamento.`;
  const insta = (loc.instagram || "").trim().replace(/^@/, "");
  const instaOk = /^[A-Za-z0-9._]{1,30}$/.test(insta);
  const inicial = esc(nome.charAt(0).toUpperCase());

  const lista = equips.length
    ? `<ul class="vt-grade">${ordenados.map((e, i) => cartao(e, loc, wa, i)).join("\n")}</ul>`
    : `<div class="vt-vazio">${esc(nome)} ainda está montando o catálogo.${wa ? " Pergunte pelo WhatsApp o que está disponível." : ""}</div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<meta name="robots" content="${indexavel ? "index,follow" : "noindex,follow"}"/>
<link rel="canonical" href="${esc(canonical)}"/>
<meta property="og:title" content="${esc(nome + (cidade ? ` · ${cidade}` : ""))}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${esc(canonical)}"/>
${ogImagem ? `<meta property="og:image" content="${esc(ogImagem)}"/>\n` : ""}<meta name="theme-color" content="#f0ece3"/>
<link rel="icon" href="/favicon.ico"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,600;1,9..144,300;1,9..144,400&family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="/fieldo.css"/>
${jsonLd(loc, equips, canonical, wa)}<style>
  /* Vitrine v12.5 — vitrine de loja: cabeçalho da locadora, grade de
     produtos com foto grande, WhatsApp com cor própria. Tokens do
     fieldo.css; o verde do WhatsApp é o único acento novo. */
  :root{--wa:#1d7a46;--wa-d:#155c35;--wa-bg:rgba(29,122,70,.08);--wa-bd:rgba(29,122,70,.35)}
  body{background:var(--bg);color:var(--ink);margin:0;font-family:var(--sans)}
  .vt{max-width:1080px;margin:0 auto;padding-block:1rem 7rem;
    padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
  .vt-topo{display:flex;justify-content:space-between;align-items:center;gap:1rem;font-family:var(--mono);font-size:.66rem;
    letter-spacing:.14em;text-transform:uppercase;color:var(--muted);padding-bottom:1rem;margin-bottom:1.5rem;border-bottom:1px solid var(--border)}
  .vt-topo a{color:var(--ink);text-decoration:none;font-weight:500}

  /* ── cabeçalho da locadora ── */
  .vt-head{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.9rem 1rem;align-items:center;margin-bottom:1rem}
  .vt-logo{width:64px;height:64px;border-radius:50%;object-fit:contain;padding:8px;background:#fff;background:var(--paper3);border:1px solid var(--border2);display:block}
  .vt-logo--ini{display:grid;place-items:center;font-family:var(--serif);font-size:1.7rem;font-weight:300;color:var(--gold-text);background:var(--paper2)}
  .vt-h1{font-family:var(--serif);font-weight:400;font-size:clamp(1.65rem,5.2vw,2.5rem);line-height:1.08;margin:0;text-wrap:balance;letter-spacing:-.01em}
  .vt-local{font-size:.9rem;color:var(--text2);margin-top:.25rem}
  .vt-bio{font-size:1rem;line-height:1.6;color:var(--text2);margin:0 0 1rem;max-width:62ch}
  .vt-chips{display:flex;flex-wrap:wrap;gap:.45rem;margin:0 0 1.25rem;padding:0;list-style:none}
  .vt-chips li{font-size:.8rem;color:var(--text2);background:var(--paper);border:1px solid var(--border2);border-radius:999px;
    padding:.35rem .75rem;font-variant-numeric:tabular-nums;white-space:nowrap}
  .vt-acoes{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1.2rem;margin-bottom:2.2rem}
  .vt-insta{font-size:.9rem;color:var(--ink);text-underline-offset:3px}

  /* ── botões ── */
  .vt-btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;border-radius:10px;padding:.85rem 1.2rem;
    font:600 .95rem/1.1 var(--sans);text-decoration:none;border:1px solid transparent;transition:background .15s,border-color .15s}
  .vt-btn--wa{background:var(--wa);color:#fff}
  .vt-btn--wa:hover{background:var(--wa-d)}
  .vt-btn--wa-sec{width:100%;background:var(--wa-bg);color:var(--wa-d);border-color:var(--wa-bd);margin-top:1rem;padding:.75rem 1rem;font-size:.9rem}
  .vt-btn--wa-sec:hover{background:var(--wa);color:#fff;border-color:var(--wa)}
  .vt-ic{flex:none}
  .vt-btn:focus-visible,.vt-insta:focus-visible,.vt-galeria:focus-visible,.vt-link:focus-visible{outline:3px solid var(--gold);outline-offset:2px}

  /* ── catálogo ── */
  .vt-secao{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;margin:0 0 .9rem}
  .vt-secao h2{font-family:var(--serif);font-weight:400;font-size:1.45rem;margin:0}
  .vt-secao span{font-family:var(--mono);font-size:.7rem;color:var(--muted)}
  .vt-grade{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:1rem}
  .vt-card{display:flex;flex-direction:column;background:var(--paper);border:1px solid var(--border2);border-radius:14px;overflow:hidden;
    scroll-margin-top:1rem;min-width:0}
  .vt-card:target{border-color:var(--gold);box-shadow:0 0 0 2px var(--gold)}
  .vt-midia{position:relative;aspect-ratio:4/3;background:var(--paper3);max-width:100%}
  .vt-galeria{display:flex;height:100%;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-x:contain}
  .vt-galeria::-webkit-scrollbar{display:none}
  /* v12.42 · contain: foto panorâmica ou em pé aparecia cortada (o equipamento
     passava da borda do cartão). Agora cabe inteira; sobra = fundo neutro. */
  .vt-galeria img{flex:0 0 100%;width:100%;height:100%;object-fit:contain;scroll-snap-align:start;display:block}
  .vt-nfotos{position:absolute;right:.6rem;bottom:.6rem;background:rgba(14,14,20,.72);color:#fff;font:500 .7rem var(--sans);
    padding:.3rem .55rem;border-radius:999px;pointer-events:none}
  .vt-midia--vazia{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.2rem;
    background:repeating-linear-gradient(135deg,var(--paper2) 0 14px,var(--paper3) 14px 28px);border-bottom:1px solid var(--border)}
  .vt-midia--vazia span{font-family:var(--serif);font-size:1.35rem;color:var(--text2);background:var(--paper);padding:.15rem .7rem;border-radius:6px}
  .vt-midia--vazia small{font-family:var(--mono);font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
  .vt-corpo{display:flex;flex-direction:column;flex:1;padding:1rem 1rem 1.1rem}
  .vt-cat{font-family:var(--mono);font-size:.64rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-text);margin-bottom:.25rem}
  .vt-nome{font-family:var(--serif);font-weight:400;font-size:1.3rem;line-height:1.2;margin:0;text-wrap:balance}
  .vt-mm{font-size:.85rem;color:var(--muted);margin-top:.15rem}
  .vt-desc{font-size:.9rem;line-height:1.5;color:var(--text2);margin:.5rem 0 0;overflow-wrap:anywhere;
    display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .vt-preco{margin-top:auto;padding-top:.9rem}
  .vt-diaria{display:flex;align-items:baseline;gap:.4rem;font-variant-numeric:tabular-nums;margin-top:.4rem}
  .vt-valor{font-family:var(--serif);font-size:1.85rem;font-weight:600;line-height:1}
  .vt-unid{font-size:.85rem;color:var(--muted)}
  .vt-sob{font-size:.95rem;color:var(--text2);font-weight:500}
  .vt-outros{font-size:.85rem;color:var(--text2);margin-top:.35rem;font-variant-numeric:tabular-nums}
  .vt-outros b{font-weight:600;color:var(--ink)}
  .vt-caucao{font-size:.78rem;color:var(--muted);margin-top:.3rem}
  .vt-cond{font-size:.82rem;line-height:1.5;color:var(--text2);margin:.1rem 0 .7rem;background:var(--paper2,#ede9df);border-radius:8px;padding:.5rem .65rem}
  .vt-cond b{color:var(--ink,#0e0e14);font-weight:600}
  .vt-vazio{background:var(--paper);border:1px dashed var(--border2);border-radius:14px;padding:1.4rem;color:var(--text2)}

  /* ── como alugar ── */
  .vt-como{margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid var(--border2)}
  .vt-como h2{font-family:var(--serif);font-weight:400;font-size:1.3rem;margin:0 0 1rem}
  .vt-passos{list-style:none;margin:0;padding:0;display:grid;gap:1rem;counter-reset:p}
  .vt-passos li{counter-increment:p;display:grid;grid-template-columns:2rem minmax(0,1fr);gap:.75rem;align-items:start;
    font-size:.92rem;line-height:1.5;color:var(--text2)}
  .vt-passos li::before{content:counter(p);width:2rem;height:2rem;border-radius:50%;border:1px solid var(--gold);color:var(--gold-text);
    display:grid;place-items:center;font:500 .85rem var(--mono)}
  .vt-passos strong{display:block;color:var(--ink);font-weight:600}
  .vt-rodape{margin-top:2.5rem;padding-top:1rem;border-top:1px solid var(--border);font-size:.82rem;color:var(--muted);
    display:flex;flex-wrap:wrap;gap:.4rem 1rem;justify-content:space-between}
  .vt-link{color:var(--ink);text-underline-offset:3px}

  /* ── barra fixa (celular) ── */
  .vt-fixo{position:fixed;left:0;right:0;bottom:0;z-index:5;background:var(--bg);border-top:1px solid var(--border2);
    padding:.6rem max(16px,env(safe-area-inset-right,0px)) calc(.6rem + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px))}
  .vt-fixo .vt-btn{width:100%}
  .vt-acoes .vt-btn--wa{display:none}
  /* sem foto, no celular, não ocupa a altura de uma foto inteira */
  .vt-midia--vazia{aspect-ratio:16/7}

  @media (min-width:640px){
    .vt{padding-block:1.5rem 4rem}
    .vt-head{grid-template-columns:auto minmax(0,1fr);gap:1.25rem}
    .vt-logo{width:80px;height:80px}
    .vt-grade{grid-template-columns:repeat(2,minmax(0,1fr));gap:1.25rem}
    .vt-midia--vazia{aspect-ratio:4/3}
    .vt-acoes .vt-btn--wa{display:inline-flex}
    .vt-fixo{display:none}
    .vt-passos{grid-template-columns:repeat(3,minmax(0,1fr));gap:1.5rem}
  }
  @media (min-width:980px){
    .vt-grade{grid-template-columns:repeat(3,minmax(0,1fr))}
  }
  @media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
</style>
</head>
<body>
<main class="vt">
  <div class="vt-topo">
    <a href="/">Fieldo</a>
    <span>Aluguel de equipamentos</span>
  </div>

  <header>
    <div class="vt-head">
      ${logo
        ? `<img class="vt-logo" src="${esc(logo)}" alt="" width="80" height="80"/>`
        : `<div class="vt-logo vt-logo--ini" aria-hidden="true">${inicial}</div>`}
      <div>
        <h1 class="vt-h1">${esc(nome)}</h1>
        <div class="vt-local">Aluguel de equipamentos${cidade ? ` em ${esc(cidade)}${loc.uf && /^[A-Za-z]{2}$/.test(loc.uf.trim()) ? ` – ${esc(loc.uf.trim().toUpperCase())}` : ""}` : ""}</div>
      </div>
    </div>
    ${loc.bio ? `<p class="vt-bio">${esc(loc.bio)}</p>` : ""}
    <ul class="vt-chips">${fatos.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
    <div class="vt-acoes">
      ${wa ? `<a class="vt-btn vt-btn--wa" href="${esc(waLink(wa, msgGeral))}" target="_blank" rel="noopener">${ICONE_WA}Pedir orçamento no WhatsApp</a>` : ""}
      ${instaOk ? `<a class="vt-insta" href="https://instagram.com/${esc(insta)}" target="_blank" rel="noopener">Instagram @${esc(insta)}</a>` : ""}
    </div>
  </header>

  <section aria-labelledby="catalogo">
    <div class="vt-secao"><h2 id="catalogo">Para alugar</h2>${temPreco ? `<span>${soDiaria ? "preço por diária" : "preços por período"}</span>` : ""}</div>
    ${lista}
  </section>

  <section class="vt-como" aria-labelledby="como">
    <h2 id="como">Como alugar</h2>
    <ol class="vt-passos">
      <li><div><strong>Escolha o equipamento</strong>Veja fotos, preços e caução aqui na vitrine.</div></li>
      <li><div><strong>Chame no WhatsApp</strong>Diga a data em que você precisa. A mensagem já vai com o nome do equipamento.</div></li>
      <li><div><strong>Combine com a locadora</strong>Disponibilidade, retirada ou entrega e pagamento. O contrato pode ser assinado pelo celular.</div></li>
    </ol>
  </section>

  <footer class="vt-rodape">
    <span>Vitrine publicada no <a class="vt-link" href="/">Fieldo</a></span>
    <a class="vt-link" href="/locacao/">Tem uma locadora? Monte a sua vitrine</a>
    <a class="vt-link" href="/termos">Termos de Uso</a>
    <a class="vt-link" href="/privacidade">Privacidade</a>
    <div class="pub-pe-legal" data-legal="rodape"></div>
  </footer>
</main>
${wa ? `<div class="vt-fixo"><a class="vt-btn vt-btn--wa" href="${esc(waLink(wa, msgGeral))}" target="_blank" rel="noopener">${ICONE_WA}Pedir orçamento no WhatsApp</a></div>` : ""}
<script src="/dados-legais.js" defer></script>
<script src="/consentimento.js" defer></script>
<script src="/a11y.js" defer></script>
</body>
</html>`;
}

function paginaSimples(status: number, titulo: string, texto: string, cdn: string, extra: Record<string, string> = {}): Response {
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/><title>${esc(titulo)} · Fieldo</title>
<link rel="stylesheet" href="/fieldo.css"/>
<style>body{background:var(--bg);color:var(--ink);margin:0}main{max-width:560px;margin:0 auto;padding:3rem max(16px,env(safe-area-inset-right,0px)) 3rem max(16px,env(safe-area-inset-left,0px))}
h1{font-family:var(--serif);font-weight:400;font-size:2rem;margin:0 0 .6rem}p{color:var(--text2);line-height:1.55}a{color:var(--ink)}</style>
</head><body><main><h1>${esc(titulo)}</h1><p>${texto}</p><p><a href="/">Ir para o Fieldo</a></p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Netlify-CDN-Cache-Control": cdn, ...extra },
  });
}

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const m = /^\/l\/([a-z0-9-]{1,120})\/?$/.exec(url.pathname);
  if (!m) {
    return paginaSimples(404, "Vitrine não encontrada", "Confira o endereço que você recebeu.", CDN_AUSENTE);
  }

  /* /l/slug/ → /l/slug: um endereço só por vitrine. */
  if (url.pathname.endsWith("/")) {
    return new Response(null, {
      status: 301,
      headers: { Location: `${url.origin}/l/${m[1]}${url.search}`, "Cache-Control": "public, max-age=3600" },
    });
  }

  const busca = await buscar(m[1]);

  if (busca.estado === "indisponivel") {
    return paginaSimples(503, "Vitrine fora do ar por instantes",
      "Não conseguimos carregar esta vitrine agora. Tente de novo em alguns segundos.",
      "no-store", { "Retry-After": "120" });
  }
  if (busca.estado === "ausente") {
    return paginaSimples(404, "Vitrine não encontrada",
      "Esta locadora não existe ou tirou a vitrine do ar. Confira o endereço que você recebeu.", CDN_AUSENTE);
  }

  return new Response(pagina(busca.loc, busca.equips, url.origin), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Netlify-CDN-Cache-Control": CDN_OK,
    },
  });
};

export const config: Config = {
  path: "/l/*",
  cache: "manual", // ver CDN_OK em perfil-seo.ts (v12.1)
};
