# Fieldo em contêineres

Ambiente local completo: banco idêntico ao de produção (schema e permissões), Auth, REST, Storage,
gateway no formato do Supabase, o site com as regras do `netlify.toml` e as Netlify Edge Functions
de SEO rodando em Deno — sem alterar uma linha de `site/`.

## Subir

```bash
cd infra
./scripts/gerar-env.sh        # cria .env com segredos aleatórios (só local)
docker compose up -d
```

- Site: http://localhost:8080
- API (formato Supabase): http://localhost:8000 (`/rest/v1`, `/auth/v1`, `/storage/v1`, `/functions/v1`)
- Postgres: `localhost:54322` (usuário `postgres`, senha no `.env`)

Contas de demonstração (fictícias), senha `fieldo-demo-123`: `ana.pintora@demo.local`,
`bruno.eletricista@demo.local`, `locadora@demo.local`. Para subir sem elas: `FIELDO_SEED_DEMO=0`.

Supabase Edge Functions do zip (assistente, admin-*, conta-acesso, verificar-cnpj, council):

```bash
docker compose --profile functions up -d
```

## Como o site fala com o banco local sem mudar o código

O código tem a URL e a anon key de produção fixas. O gateway (porta 8080) troca essas strings
na resposta (`sub_filter`) pelas locais, e o executor das edge functions intercepta `fetch` para o
Supabase de produção e manda para o gateway. **Nada sai para produção.**

## Estrutura

```
db/init/        baseline extraída do catálogo de produção (aplicada uma vez, na criação do volume)
db/post/        storage (buckets, grants, policies) e dados de demonstração — roda após Auth/Storage
db/verify/      impressões digitais de estrutura e permissões (rodar aqui e em produção e comparar)
db/zz-fieldo.sh hook de init da imagem supabase/postgres
edge-netlify/   executor Deno das Netlify Edge Functions
functions-main/ roteador do supabase/edge-runtime (SEM verify_jwt — só local)
gateway/        nginx: API + site + regras do netlify.toml
scripts/        gerar-env.sh, dicionario.py (gera docs/DICIONARIO_DE_DADOS.md)
```

## Conferir que a réplica continua igual a produção

```bash
docker compose exec -T db psql -U postgres -At -f /dev/stdin < db/verify/estrutura.sql
docker compose exec -T db psql -U postgres -At -f /dev/stdin < db/verify/permissoes.sql
```

Rode os mesmos SQL no SQL Editor de produção; os md5 precisam bater. Se não baterem, alguém mudou
produção sem arquivo — regenere a baseline e descubra o quê.

## Recomeçar do zero

```bash
docker compose down -v && docker compose up -d
```

## Limites conhecidos

- Sem e-mail (autoconfirmação ligada), sem `pg_cron` agendado, sem Asaas e sem as 16 Edge Functions
  que só existem em produção (ver `docs/ANALISE.md` §0).
- `functions-main` não verifica JWT. Não exponha este ambiente na internet.
