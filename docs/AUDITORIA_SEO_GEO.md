# Auditoria de SEO e GEO — fieldo-zelo.com.br (21/11/2026)

Feita no site publicado (o HTML que o Googlebot e os robôs de IA recebem), no código do repositório e no
ambiente local. GEO = otimização para mecanismos generativos (AI Overviews do Google, ChatGPT, Copilot,
Perplexity, Claude): ser lido, entendido e citado nas respostas.

## Resumo em uma frase

O SEO técnico está acima da média para um site desse tamanho. O que limita o crescimento não é
código: **só 6 dos 17 perfis públicos podem aparecer no Google**, e existe **uma** página de lista
"profissão em cidade". Sem mais profissionais com serviços registrados, nenhum ajuste técnico muda
o tráfego de forma relevante.

## 1. O aviso do Search Console ("hasMerchantReturnPolicy" em "offers") — corrigido no código

**Onde:** vitrine da locação, `/l/edificar-caraguatatuba` (o "1 item afetado").

**Causa:** a vitrine marcava cada equipamento como `Product` com `Offer` e preço. Para o Google isso
é **listagem de comerciante**, que ele define como página onde o cliente **compra** o produto. Por isso
ele pede política de devolução e frete, que não existem num aluguel. Havia também um risco pior que o
aviso: a diária (R$ 179) podia aparecer na aba Shopping como **preço de venda** da betoneira.

**O que não fiz:** inventar uma política de devolução só para calar o aviso. Seria marcação falsa em
nome da locadora.

**Correção (v12.44, `netlify/edge-functions/vitrine.ts`):** cada equipamento agora é uma `Offer` de
**locação** (`businessFunction: LeaseOut`, o termo do schema.org para alugar), cujo item é um `Service`
("Aluguel de Betoneira 400l · Menegotti"), dentro do catálogo da locadora (`hasOfferCatalog`). Todos os
períodos cadastrados (diária, semana, quinzena, mês) entram como `UnitPriceSpecification`. Conferido
no ambiente local: JSON válido, nenhum `Product` na página.

**Custo da decisão:** a vitrine deixa de ser elegível para snippet de produto (preço em destaque no
resultado). É o preço de não declarar como venda o que é aluguel.

**Depois de publicar:** no Search Console, abra o aviso e clique em **Validar a correção**. O item deve
sair dos relatórios "Listagens do comerciante" e "Snippets do produto" em alguns dias.

## 2. Achados por prioridade

### Alta — negócio, não código

| # | Achado | Evidência | O que fazer |
|---|---|---|---|
| A1 | Poucas páginas indexáveis | Explorar lista 17 perfis; 6 têm `index`, 11 têm `noindex` (regra: 3 serviços registrados, ou biografia e 6+ fotos). Sitemap com 20 URLs no total | **Não baixar a régua**: perfil vazio indexado concorre com os bons e conteúdo raso pode pesar contra o site inteiro no Google. O caminho é ativação: levar os 11 perfis a 3 serviços (lembrete no app, ajuda no primeiro relatório) |
| A2 | A busca mais valiosa não tem lista | `/eletricista-em-caraguatatuba` redireciona para um perfil só; `pedreiro`, `pintor`, `ar-condicionado em Caraguatatuba` dão 404. Só `/empreiteiro-em-caraguatatuba` existe | Mesma alavanca do A1. Cada combinação profissão+cidade com 3 perfis indexáveis vira uma página nova automaticamente |
| A3 | Perfil duplicado | `/p/marcelo-ferreira-rodrigues-eletricista-caraguatatuba` (indexado) e `/p/marcelo-ferreira-eletricista-caraguatatuba` (noindex), os dois no Explorar | Confirmar com ele e unir as contas. O banco já guarda slug antigo e responde 301 |
| A4 | Preço invisível para Google e IA | R$ 35/mês e R$ 348/ano só existem em `/planos.html`, que tem `noindex` **e** `Disallow` no robots.txt. "Quanto custa o Fieldo?" fica sem resposta | Já foi para o `llms.txt` (v12.44). Recomendo também uma frase de preço na pergunta "É grátis mesmo?" da home (texto visível e JSON-LD juntos). É decisão sua expor o preço na home |
| A5 | Fora do Bing | Só há verificação do Google | Cadastrar no **Bing Webmaster Tools** (importa do Search Console em minutos) e ligar IndexNow. O Bing alimenta o Copilot, e há relatos de que o ChatGPT Search usa o índice dele (não confirmado oficialmente em 2026). O Bing tem desde fev/2026 um relatório de citações em IA, a única medição direta de GEO hoje |

### Média — técnico

| # | Achado | Evidência | O que fazer |
|---|---|---|---|
| T1 | Layout da home se mexe (CLS) | 0,127 medido em celular simulado (limite bom: 0,1). Causa: o título do topo muda de 2 para 3 linhas quando a fonte Noto Serif chega e troca a fonte reserva | Hospedar a Noto Serif no próprio site com `preload`, ou reserva com métricas ajustadas (`size-adjust`). Antes, confira o relatório "Core Web Vitals" do Search Console: no Android a fonte do sistema já é a Noto Serif e o efeito real pode ser menor. Não mexi porque envolve a tipografia que você escolheu |
| T2 | Redirecionamento leva o `?slug=` | Produção: `/perfil.html?slug=X` → `/p/X?slug=X`. O código do repositório remove o parâmetro (testado no local: `/p/X`) | Produção deve estar com versão anterior da function `perfil-seo`. Conferir depois de publicar a v12.44. Impacto baixo: o destino declara o canonical limpo |
| T3 | Slugs com erro | "proficional" em 2 perfis; 5 de 17 slugs cortados no meio da palavra (`…-guarul`, `…-porcela`, `…-caraguat`, `…-ar-cond`) | Corrigir o gerador de slug para cortar em palavra inteira. Os existentes podem ser trocados: o 301 do slug antigo já existe |
| T4 | 404 sem marca | Endereço inexistente mostrava "Page not found" do Netlify, em inglês; profissão+cidade inexistente mostrava o texto "Não encontrado" | **Corrigido (v12.44):** `404.html` em português com caminho de volta, usado também pela lista profissão+cidade |
| T5 | `llms.txt` com exemplo quebrado | O exemplo `/eletricista-em-ubatuba` dá 404 | **Corrigido:** exemplo trocado por `/empreiteiro-em-caraguatatuba`, quinzena incluída, seção de planos e preços |
| T6 | Perfil de fora da região | Um perfil de Guarulhos no Explorar, que se apresenta como "Litoral Norte" | Aceitável enquanto há poucos perfis; quando houver volume, filtrar o Explorar por região |

### Baixa — expectativa, não erro

- **FAQ e HowTo não geram mais resultado enriquecido** no Google para sites comerciais (mudança de
  2023: FAQ só para governo e saúde, HowTo removido). A marcação no site não atrapalha e ajuda máquinas
  a entender a página, mas não espere as perguntas aparecerem expandidas no resultado.
- `Organization.sameAs` só tem o Instagram. Se existirem perfil do Fieldo no Google (Perfil da
  Empresa), LinkedIn ou CNPJ, adicione (`sameAs`, `taxID`). Não invente o que não existe.

## 3. O que está bom (não mexer)

- **Tudo renderizado no servidor.** Googlebot, Bingbot, GPTBot, OAI-SearchBot, ClaudeBot,
  PerplexityBot e Google-Extended recebem a mesma página completa (200, 118 KB, com o bloco
  "Em resumo"). Muitos sites perdem as IAs porque o conteúdo só aparece com JavaScript.
- **robots.txt** libera tudo o que é público e bloqueia só telas de trabalho, com o raciocínio certo
  (não bloquear o que tem `noindex`, senão o Google não lê o `noindex`).
- **Canonical, `www` → raiz, HTTPS com HSTS**, um `h1` por página, `lang="pt-BR"`, títulos de 42–62
  caracteres e descrições específicas por página.
- **Dados estruturados ricos e coerentes**: `ProfilePage` + `ProfessionalService` + `AggregateRating`
  nos perfis, `ItemList` nas listas, `Organization` única com `@id` repetido entre páginas.
- **Regra de indexação com critério de qualidade** (3 serviços), sitemap só com o que é indexável e
  `lastmod` real. É a decisão certa, mesmo limitando o volume (ver A1).
- **Velocidade** (celular simulado, 4G lenta, CPU 4× mais lenta): LCP de 1,1 s a 2,2 s nas páginas
  públicas (limite bom 2,5 s), TTFB de 0,3 s a 0,85 s, 156–339 KB por página.
- **`llms.txt` factual**, com o que cada dado do perfil significa e o que o Fieldo não confere.

## 4. GEO — o que realmente pesa

As evidências públicas sobre o que faz uma IA citar um site ainda são fracas: a maior parte vem de
fornecedores de SEO, sem método aberto. O que tem base é o mesmo do SEO: conteúdo legível sem
JavaScript, fatos verificáveis, estrutura de pergunta e resposta, e ser citado por terceiros.

1. **Ser mencionado fora do próprio site.** As IAs citam muito fontes de terceiros. Para o Fieldo:
   jornais e portais do Litoral Norte, associações comerciais, perfis do Fieldo no Google e no
   Instagram que levem ao site. É trabalho de relações públicas, não de código.
2. **Respostas diretas para as perguntas que as pessoas fazem às IAs:** "quanto custa um eletricista
   em Caraguatatuba", "como saber se um pedreiro é confiável". Uma página por pergunta, com dados dos
   próprios serviços registrados (faixas de preço reais, quando houver volume) é conteúdo que só o
   Fieldo tem, e é isso que uma IA cita.
3. **Medir.** Bing Webmaster Tools (citações em IA), visitas vindas de `chatgpt.com`,
   `perplexity.ai` e `copilot.microsoft.com` no analytics, e um teste manual mensal com 10 perguntas
   fixas nas IAs, anotando se o Fieldo aparece.
4. `llms.txt`: mantido e corrigido, mas não há prova de que as IAs o usem. Custo zero; não conte com ele.

## 5. Mudanças desta auditoria (v12.44)

- `netlify/edge-functions/vitrine.ts`: equipamento vira oferta de locação (`Service`), não `Product`.
- `404.html` (novo) e `netlify/edge-functions/lista-local.ts`: página 404 própria.
- `llms.txt`: exemplo corrigido, quinzena, planos e preços.
- `infra/edge-netlify/server.ts`: no ambiente local, `fetch` para o próprio site vai ao gateway
  (imita a Netlify; não muda nada em produção).

Nenhuma migration. Publicar o site normalmente; depois, **Validar a correção** no Search Console.
