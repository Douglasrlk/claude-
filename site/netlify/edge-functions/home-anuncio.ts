/* Fieldo v12.35 · Edge Function "home-anuncio"
 *
 * O link dos anúncios já leva a profissão: /?p=pintor&c=ubatuba abre a
 * home com o formulário montado e (v12.34) o desenho do pintor. Mas
 * quem recebe esse link no WhatsApp via a prévia genérica da home.
 * Aqui, só quando ?p= é uma das seis profissões que têm desenho, a
 * prévia ganha a imagem daquela profissão (og-p-<cena>.jpg, gerada das
 * mesmas cenas do rabisco.js) e o título com o nome dela.
 *
 * O título usa o NOME DA LISTA, nunca o texto que veio no link: um
 * link montado com qualquer coisa em ?p= não consegue pôr palavra
 * nenhuma na prévia do Fieldo. Sem ?p=, ou com profissão sem desenho,
 * a function nem lê a resposta (devolve undefined e a home segue igual).
 * O canonical continua "/" (a home é uma só para o Google).
 */
import type { Context, Config } from "@netlify/edge-functions";

export interface Profissao { id: string; nome: string; re: RegExp }

/* Mais estrito que o rabisco.js de propósito: lá "gesseiro" ganha o
   desenho do pintor; aqui a prévia diria "Pintor" para um gesseiro. */
export const PROFISSOES: Profissao[] = [
  { id: "encanador", nome: "Encanador", re: /encanad|hidraul|bombeiro hidr/ },
  { id: "eletricista", nome: "Eletricista", re: /eletricist/ },
  { id: "pintor", nome: "Pintor", re: /\bpintor|pintura/ },
  { id: "pedreiro", nome: "Pedreiro", re: /pedreir|alvenar|mestre de obra/ },
  { id: "diarista", nome: "Diarista", re: /diarist|faxin/ },
  { id: "ar", nome: "Técnico de ar-condicionado", re: /ar.?condicionado|refrigeracao|climatizacao/ },
];

export function profissaoDoParametro(p: string | null): Profissao | null {
  if (!p) return null;
  const s = p.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[-_+]+/g, " ").trim().slice(0, 60);
  if (s.length < 3) return null;
  return PROFISSOES.find((x) => x.re.test(s)) || null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function personalizar(html: string, prof: Profissao): string {
  const titulo = `${prof.nome}: seu próximo cliente vai ver seu trabalho antes de te ligar`;
  const alt = `Desenho de ${prof.id === "diarista" ? "uma diarista" : prof.id === "ar" ? "um técnico de ar-condicionado" : "um " + prof.nome.toLowerCase()} trabalhando, ao lado da frase: Seu próximo cliente vai ver seu trabalho antes de te ligar.`;
  return html
    .replace(/\/og-fieldo-v2\.jpg/g, `/og-p-${prof.id}.jpg`)
    .replace(/<meta property="og:title" content="[^"]*"\/>/, `<meta property="og:title" content="${esc(titulo)}"/>`)
    .replace(/<meta property="og:image:alt" content="[^"]*"\/>/, `<meta property="og:image:alt" content="${esc(alt)}"/>`);
}

export default async (req: Request, context: Context) => {
  const prof = profissaoDoParametro(new URL(req.url).searchParams.get("p"));
  if (!prof) return;
  const resposta = await context.next();
  if (!(resposta.headers.get("content-type") || "").includes("text/html")) return resposta;
  const html = await resposta.text();
  let saida = html;
  try { saida = personalizar(html, prof); } catch (_) { saida = html; }
  const cab = new Headers(resposta.headers); cab.delete("content-length");
  return new Response(saida, { status: resposta.status, headers: cab });
};

export const config: Config = { path: ["/", "/index.html"] };
