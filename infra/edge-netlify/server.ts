// Fieldo · executor local das Netlify Edge Functions (perfil-seo, explorar-seo,
// lista-local, vitrine, regiao, sitemap, canonical-origem, home-anuncio).
//
// As functions são importadas SEM alteração de /site/netlify/edge-functions.
// Elas só usam `context.next()` da API da Netlify, então o adaptador precisa de
// duas coisas:
//   1. context.next() → busca a mesma URL no nginx estático (o "resto do site");
//   2. as functions têm a URL e a anon key de PRODUÇÃO fixas no código. O fetch
//      global é interceptado: chamada para o Supabase de produção vai para o
//      gateway local, com a anon key local. Nada sai para produção.
//
// A ordem e os caminhos espelham o netlify.toml. `dominio-canonico` fica de fora:
// só faz 301 do domínio antigo, que não existe aqui.

const PROD_URL = "https://jrsctnncoljdcvdofxsg.supabase.co";
const LOCAL_API = Deno.env.get("LOCAL_API_INTERNAL") ?? "http://gateway:8000";
const STATIC_ORIGIN = Deno.env.get("STATIC_ORIGIN") ?? "http://gateway:8081";
const LOCAL_ANON = Deno.env.get("ANON_KEY") ?? "";
const PORT = Number(Deno.env.get("PORT") ?? "8787");

const fetchOriginal = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input: Request | URL | string, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  if (!req.url.startsWith(PROD_URL)) return fetchOriginal(req);
  const headers = new Headers(req.headers);
  if (headers.has("apikey")) headers.set("apikey", LOCAL_ANON);
  const auth = headers.get("authorization");
  if (auth && auth.startsWith("Bearer ey")) headers.set("authorization", `Bearer ${LOCAL_ANON}`);
  const url = LOCAL_API + req.url.slice(PROD_URL.length);
  return fetchOriginal(new Request(url, { method: req.method, headers, body: req.body, signal: req.signal, redirect: req.redirect }));
};

type Handler = (req: Request, ctx: { next: () => Promise<Response> }) => Promise<Response | undefined> | Response | undefined;
const base = "/site/netlify/edge-functions/";
const carregar = async (nome: string): Promise<Handler> => (await import(`file://${base}${nome}.ts`)).default;

const [perfilSeo, explorarSeo, listaLocal, vitrine, regiao, sitemap, canonicalOrigem, homeAnuncio] = await Promise.all(
  ["perfil-seo", "explorar-seo", "lista-local", "vitrine", "regiao", "sitemap", "canonical-origem", "home-anuncio"].map(carregar),
);

// [teste do caminho, cadeia de functions] — mesma ordem do netlify.toml
const ROTAS: Array<[(p: string) => boolean, Handler[]]> = [
  [(p) => p === "/perfil.html" || p === "/perfil" || p.startsWith("/p/"), [perfilSeo]],
  [(p) => p === "/explorar.html" || p === "/explorar", [explorarSeo]],
  [(p) => p === "/sitemap.xml", [sitemap]],
  [(p) => p === "/" || p === "/index.html", [canonicalOrigem, homeAnuncio]],
  [(p) => /^\/[a-z0-9-]+-em-[a-z0-9-]+\/?$/.test(p), [listaLocal]],
  [(p) => p.startsWith("/l/"), [vitrine]],
  [(p) => p === "/litoral-norte", [regiao]],
];

function estatico(req: Request): Promise<Response> {
  const u = new URL(req.url);
  return fetchOriginal(STATIC_ORIGIN + u.pathname + u.search, {
    method: req.method,
    headers: { "accept": req.headers.get("accept") ?? "*/*", "user-agent": req.headers.get("user-agent") ?? "" },
    redirect: "manual",
  });
}

async function cadeia(req: Request, fns: Handler[], i = 0): Promise<Response> {
  if (i >= fns.length) return estatico(req);
  const r = await fns[i](req, { next: () => cadeia(req, fns, i + 1) });
  return r ?? cadeia(req, fns, i + 1);
}

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, async (req) => {
  // o nginx repassa o Host público; as functions montam URLs a partir de req.url
  const fwdHost = req.headers.get("x-forwarded-host");
  if (fwdHost) {
    const u = new URL(req.url);
    u.host = fwdHost;
    u.protocol = (req.headers.get("x-forwarded-proto") ?? "http") + ":";
    req = new Request(u, req);
  }
  const p = new URL(req.url).pathname;
  const rota = ROTAS.find(([t]) => t(p));
  try {
    return rota ? await cadeia(req, rota[1]) : await estatico(req);
  } catch (e) {
    console.error("[edge-netlify]", p, e);
    return estatico(req); // mesma degradação da Netlify: sem a function, serve o estático
  }
});
