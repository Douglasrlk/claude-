# services/ — Fase 1 do MCP (leia isto primeiro)

Esta pasta é nova. Ela não existia antes e **nenhum arquivo do site foi
alterado** para criá-la — nem `db.js`, nem nenhuma página `.html`. Se
você apagar essa pasta inteira agora, o site continua funcionando
exatamente igual.

## Atualização da Fase 2 (leia antes de abrir os arquivos)

Os arquivos abaixo foram escritos na Fase 1, pensados para o MCP
autenticar chamando o banco com o JWT do próprio profissional. Ao
implementar a Fase 2 de verdade, encontrei um problema sério nesse plano
original: o mecanismo pensado pra isso reaproveitava a mesma "gaveta" de
e-mail/senha que o código de recuperação de conta já usa — e isso
quebraria a recuperação de quem já tem um código gerado. Corrigi isso
mudando o desenho: em vez de um JWT, a chave do MCP agora é resolvida
inteira dentro de funções do próprio banco (Postgres), sem nunca tocar
no mecanismo de login do profissional. Essa correção está documentada
com detalhes no topo de `supabase/migrations/2026-09-09_mcp_api_keys.sql`
e em `MCP-fieldo-auditoria.md`.

Por causa disso, o Edge Function que realmente está no ar
(`supabase/functions/mcp/`) **não chama nenhum arquivo desta pasta** —
ele fala direto com as funções do banco. Os arquivos abaixo continuam
aqui como registro do raciocínio da Fase 1 (nada é apagado neste
projeto, só substituído com explicação), marcados com um aviso no topo
de cada um.

## O que tem aqui

- **`supabaseRest.ts`** — a parte que sabe "conversar" com o banco de
  dados (Supabase). Ainda válido como referência, não superado.
- **`reportService.ts`** ⚠️ superado — ver aviso no topo do arquivo.
- **`profileService.ts`** — ainda não usado por nenhuma tool (a tool que
  precisaria dele só chega na Fase 4).
- **`usageService.ts`** ⚠️ superado — ver aviso no topo do arquivo.
- **`validation/reportSchema.ts`** — a validação de entrada (nome do
  cliente preenchido, valor não negativo, data no formato certo) — essa
  ideia continua válida; a validação equivalente da Fase 2 está escrita
  direto na função SQL `mcp_create_service_report`.

## Onde está o código que realmente está funcionando agora

- `supabase/migrations/2026-09-09_mcp_api_keys.sql` — a tabela de chaves
  e as funções do banco (o "cérebro" de quem pode fazer o quê).
- `supabase/functions/mcp/` — o servidor MCP em si (já publicado no
  Supabase), que só traduz pedidos da IA para essas funções do banco.

## Por que isso existe

É o plano de transformar o Fieldo num "MCP Server" — uma forma de uma
inteligência artificial (tipo o Claude) conseguir criar/ler relatórios
de serviço em nome de um profissional, sem precisar abrir o app. O
documento completo, com todos os riscos e decisões, está em
`MCP-fieldo-auditoria.md`.

## O que ainda falta

Um jeito do profissional gerar a própria chave pela tela do app — isso é
a Fase 3 (botão em Configurações), que só acontece depois de você
aprovar de novo.
