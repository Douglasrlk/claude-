/* Fieldo v10.20 · Edge Function "dominio-canonico"
 *
 * 301 do endereço de produção antigo para o domínio próprio.
 *
 * ─────────────────────────────────────────────────────────────────
 * POR QUE ELA EXISTE
 *
 * O Fieldo saiu de fieldo-zelo.netlify.app para fieldo-zelo.com.br.
 * A Netlify NÃO redireciona o subdomínio .netlify.app sozinha — não é
 * comportamento automático e não existe chave para ligar. Sem este 301,
 * o mesmo site responde nos dois endereços: conteúdo duplicado, e a
 * ferramenta de mudança de endereço do Search Console, que exige o 301,
 * não pode ser usada.
 *
 * ─────────────────────────────────────────────────────────────────
 * POR QUE É EDGE FUNCTION, E NÃO UMA REGRA NO netlify.toml
 *
 * A ordem de processamento da Netlify é
 *
 *     Security → Compute (Edge Functions) → Caching → Static routing
 *
 * e "Static routing" é onde moram os redirects. As functions do Fieldo
 * cobrem /, /explorar, /p/*, /perfil*, /sitemap.xml e as categorias —
 * quase toda URL indexável. Uma regra de redirect comum rodaria depois
 * delas, quando a resposta já foi montada.
 *
 * ─────────────────────────────────────────────────────────────────
 * POR QUE NÃO TEM `export const config` AQUI DENTRO
 *
 * Este é o detalhe que decide se a function funciona.
 *
 * A ordem entre functions que casam o mesmo caminho é:
 *
 *     2. declaradas no netlify.toml   (na ordem do arquivo)
 *     4. declaradas inline            (ordem ALFABÉTICA de arquivo)
 *
 * E a documentação é explícita: declarar nos DOIS lugares faz a Netlify
 * fundir as configurações "and treats them as inline declarations" — ou
 * seja, rebaixa para a etapa 4.
 *
 * As cinco functions existentes têm config inline, então todas estão na
 * etapa 4. Se esta também tivesse, ela entraria na mesma fila
 * alfabética — "dominio-canonico" cairia entre "canonical-origem" e
 * "explorar-seo", e o perfil-seo (que serve /p/*) rodaria antes dela em
 * parte das rotas. O 301 não aconteceria justamente onde mais importa.
 *
 * Declarada SÓ no netlify.toml, ela fica na etapa 2 e roda antes de
 * todas. É por isso que este arquivo termina sem config, de propósito.
 * NÃO adicione um `export const config` aqui.
 *
 * ─────────────────────────────────────────────────────────────────
 * SEGURANÇA
 *
 * O destino é constante. Nada do que o visitante controla escolhe para
 * onde ele vai:
 *
 *   - o host de origem é comparado por IGUALDADE EXATA. Nada de
 *     includes/endsWith/regex: um preview chama-se
 *     `<id>--fieldo-zelo.netlify.app` e terminaria em ".netlify.app",
 *     então qualquer comparação parcial mataria os deploy previews;
 *   - o host de destino é a constante HOST_NOVO, nunca um cabeçalho
 *     nem um parâmetro — não há open redirect possível;
 *   - o protocolo é forçado a https. Sem isso, uma requisição em http
 *     sairia redirecionada para http no domínio novo: downgrade;
 *   - a porta é limpa, para o destino nunca herdar `:porta` de uma
 *     origem esquisita;
 *   - só pathname e query atravessam, e vêm da URL já parseada da
 *     requisição.
 *
 * O domínio novo cai no primeiro `return context.next()` e portanto não
 * pode se redirecionar para si mesmo. Não há laço possível.
 */
import type { Context } from "@netlify/edge-functions";

/* Igualdade exata, nos dois. Ver o bloco SEGURANÇA acima. */
const HOST_ANTIGO = "fieldo-zelo.netlify.app";
const HOST_NOVO   = "fieldo-zelo.com.br";
/* v12.1 · `<id>--fieldo-zelo.netlify.app` — permalinks de deploy. */
const SUFIXO_PREVIEW = "--fieldo-zelo.netlify.app";

/* ── v10.20b · por que o corpo inteiro está em try/catch ────────────
 *
 * Achado no Netlify Analytics em 01/09: 1 erro em 11 requests do site
 * inteiro na janela, e caiu bem em cima de /robots.txt — 1 de 2 (50%).
 * Não deu pra confirmar a causa direto (esta sessão não tem acesso aos
 * logs do Netlify, só ao Supabase), mas dá pra eliminar o suspeito
 * óbvio: /robots.txt medido fresco, sem cache, respondeu 200 com o
 * conteúdo certo — não é uma queda contínua.
 *
 * O que RESTA suspeito, estruturalmente: esta é a ÚNICA function
 * declarada em "/*" — roda antes de toda e qualquer resposta do site,
 * robots.txt incluído, e é a primeira coisa nova que mudou de verdade
 * (v10.20, esta semana). Antes dela, nada rodava computação nenhuma em
 * cima de um arquivo estático como robots.txt; ele só passava direto
 * pro static routing. Se ALGUMA coisa aqui lançar uma exceção não
 * prevista — um runtime blip do Deno, um req.url que chega deformado
 * por algum proxy/bot no meio do caminho, o que for — o resultado hoje
 * é a Netlify devolver erro pro visitante em vez de servir a página, e
 * isso valeria pra QUALQUER rota do site, não só pra esta.
 *
 * Uma function de redirecionamento não tem por que derrubar a página
 * quando ela mesma falha: o pior caso aceitável aqui é "não redirecionou
 * desta vez", nunca "página fora do ar". Por isso falha ABERTA — cai em
 * context.next() e serve o site normalmente — em vez de deixar a
 * exceção estourar pro runtime da Netlify. O log fica no console.error,
 * pra aparecer nos Function logs se acontecer de novo. */
export default async (req: Request, context: Context) => {
  try {
    const url = new URL(req.url);

    /* Tudo que não for exatamente o host antigo de produção segue o
       fluxo normal: o domínio novo, o www, os deploy previews
       (`<id>--fieldo-zelo.netlify.app`), localhost e 127.0.0.1. */
    /* v12.1 · auditoria 28/10/2026: o permalink de cada deploy
       (`<id>--fieldo-zelo.netlify.app`) é público e foi visto servindo
       200 para visitantes. É uma cópia inteira do site — não pode
       competir com o domínio próprio na busca. Igualdade exata do
       sufixo, pelo mesmo motivo do bloco SEGURANÇA acima. */
    if (url.hostname.endsWith(SUFIXO_PREVIEW) && url.hostname !== HOST_ANTIGO) {
      const r = await context.next();
      const h = new Headers(r.headers);
      h.set("X-Robots-Tag", "noindex");
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
    }

    if (url.hostname !== HOST_ANTIGO) return context.next();

    url.protocol = "https:";
    url.hostname = HOST_NOVO;
    url.port = "";

    /* ── v10.20a · POR QUE NÃO Response.redirect() ──────────────────
     *
     * Esta linha era `Response.redirect(url.toString(), 301)`. Medido em
     * produção depois do deploy, o que chegava ao navegador era:
     *
     *     Status: 302 Found
     *
     * O status 301 não sobreviveu ao runtime da Netlify. E 302 é
     * temporário: não transfere autoridade, e a ferramenta de mudança de
     * endereço do Search Console exige 301. O redirect "funcionava" e não
     * servia para nada — o pior tipo de defeito, porque a barra de
     * endereço troca e parece certo.
     *
     * A resposta montada à mão preserva o status. É o mesmo padrão que o
     * redir301() do perfil-seo.ts já usa neste projeto desde a v10.2.
     *
     * Cache de 1 hora, como lá: alívio de tráfego sem prender o
     * navegador de ninguém a uma decisão que ainda pode ser revista. Um
     * 301 sem Cache-Control é guardado pelo navegador por tempo
     * indeterminado, e aí não há como voltar atrás.
     *
     * ── CONFIRMADO EM PRODUÇÃO, 01/09 ──
     * Medido de novo nesta sessão, em fieldo-zelo.netlify.app/ e
     * fieldo-zelo.netlify.app/robots.txt: as duas ainda saem 302. Ou
     * seja, esta correção (v10.20a) está no repositório mas NUNCA foi
     * publicada — o que está no ar hoje é a versão anterior, com
     * Response.redirect(). Sistêmico: todo o domínio antigo, não só
     * robots.txt. Publicar este arquivo resolve. */
    return new Response(null, {
      status: 301,
      headers: {
        Location: url.toString(),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    /* v10.20b · falha aberta. Ver o bloco acima do export. */
    console.error("[dominio-canonico] falhou, servindo normal:", String(e));
    return context.next();
  }
};
