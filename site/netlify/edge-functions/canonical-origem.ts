/* Fieldo v10.1 · Edge Function "canonical-origem"
 *
 * Reescreve canonical e og:url das páginas ESTÁTICAS públicas para o
 * domínio que está de fato servindo a requisição.
 *
 * POR QUE ISSO EXISTE
 * ─────────────────────────────────────────────────────────────────
 * O canonical precisa ser absoluto, então o HTML estático traz o
 * domínio escrito à mão:
 *
 *     <link rel="canonical" href="https://fieldo-zelo.netlify.app/"/>
 *
 * E o plano imediato do Fieldo é sair do netlify.app para um domínio
 * próprio — netlify.app está na Public Suffix List, não transmite
 * autoridade nenhuma e é rastreado com prioridade baixa por ser
 * hospedagem gratuita. É o teto estrutural do projeto.
 *
 * No dia dessa migração, um canonical esquecido apontando para o
 * domínio antigo é o pior erro possível: o site novo diria ao Google,
 * em toda página, "a versão boa desta página está no domínio velho".
 * O Google obedece. A migração perde o efeito e ninguém entende por
 * quê, porque a única pista está numa linha de <head> que ninguém
 * relê.
 *
 * O perfil já não tinha esse problema — o perfil-seo monta o canonical
 * a partir de url.origin. Esta function estende a mesma regra às
 * páginas que não têm edge function própria.
 *
 * Efeito colateral bom: em preview deploy e em localhost o canonical
 * passa a apontar para o próprio ambiente, em vez de mandar todo mundo
 * para produção.
 *
 * Nada a fazer quando o domínio já bate — a substituição é literal e
 * simplesmente não encontra nada.
 */
import type { Context, Config } from "@netlify/edge-functions";

/* O domínio escrito no HTML estático. Se ele mudar lá, muda aqui —
   e a partir daí esta function vira no-op, que é o estado saudável. */
/* v12.1 · auditoria 28/10/2026: o HTML estático passou a trazer o domínio
   próprio. Em produção esta function vira no-op (o estado saudável que o
   comentário acima prevê); em preview ela segue apontando o canonical
   para o próprio preview. */
const DOMINIO_ESTATICO = "https://fieldo-zelo.com.br";

export default async (req: Request, context: Context) => {
  const origem = new URL(req.url).origin;
  const resposta = await context.next();

  if (origem === DOMINIO_ESTATICO) return resposta;

  const tipo = resposta.headers.get("content-type") || "";
  if (!tipo.includes("text/html")) return resposta;

  const html = await resposta.text();
  return new Response(html.replaceAll(DOMINIO_ESTATICO, origem), {
    status: resposta.status,
    headers: resposta.headers,
  });
};

/* v10.18 · /verificar.html entrou na lista.
 *
 * Três páginas trazem o domínio escrito à mão no <head>: index.html,
 * explorar.html e verificar.html. As duas primeiras já eram reescritas
 * — a index por esta function, a explorar pelo explorar-seo (linha 226).
 * A verificar.html não era por ninguém.
 *
 * No domínio antigo isso não aparecia: o canonical dela apontava para o
 * netlify.app, e o site ERA o netlify.app. No domínio próprio ela
 * passaria a dizer, em toda visita, "a versão boa desta página está no
 * domínio velho" — exatamente o erro que o comentário no topo deste
 * arquivo descreve. Uma linha. */
export const config: Config = {
  path: ["/", "/index.html", "/verificar.html"],
};
