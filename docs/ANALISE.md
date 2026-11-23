# Fieldo v12.41 · Análise técnica

Data: 21/11/2026. Base: o zip `fieldo-site-v12.41` (191 arquivos, ~65 mil linhas) **e** o banco de
produção (projeto Supabase `jrsctnncoljdcvdofxsg`, Postgres 17.6), lido somente com consultas de
catálogo. Nenhuma escrita foi feita em produção. Nenhum dado pessoal de produção foi copiado.

Dicionário completo, tabela por tabela: [`DICIONARIO_DE_DADOS.md`](DICIONARIO_DE_DADOS.md).
Como subir tudo em contêiner: [`../infra/README.md`](../infra/README.md).

---

## 0. Veredito direto

1. **O zip não é o sistema.** Ele não recria o banco nem a metade das funções de servidor.
   As migrations do zip começam em 19/10/2026 e fazem `references public.locadoras` sem nunca
   criá-la; 28 tabelas base (`professionals`, `reports`, `budgets`…) não estão em lugar nenhum
   do zip. Produção tem **146** migrations registradas; o zip tem **26** arquivos. Produção tem
   **23** Edge Functions; o zip tem **7** — faltam justamente **cobrança** (`assinatura`,
   `assinatura-cancelar`, `asaas-webhook`), **licença** (`license`, `license-issue`) e `mcp`.
   Se o projeto Supabase sumir amanhã, **não dá para reconstruir o Fieldo a partir do que você tem.**
2. **O banco, em si, é bem feito.** RLS em 100% das tabelas, grants por coluna para o `anon`,
   trigger que impede o usuário de se dar plano Pro, contratos imutáveis por trigger, tokens só como
   hash. Testei os caminhos de ataque óbvios (ver §4.1) e o banco segurou todos.
3. **O risco está no processo, não no SQL:** mudanças aplicadas pelo SQL Editor sem registro
   (11 dos 26 arquivos do zip não aparecem no histórico de produção), arquivos com ordem que
   quebra quando reaplicados, código de pagamento fora de controle de versão, documentação interna
   desatualizada (o cabeçalho do `db.js` ainda descreve a v4.3 e um sistema de licença que não
   existe mais).
4. **Agora existe uma réplica reproduzível:** a baseline em `infra/db/init/` recria o schema de
   produção **idêntico** (verificado por impressão digital, §2), e o `docker compose` sobe banco,
   Auth, REST, Storage, gateway e as Edge Functions de SEO localmente.

---

## 1. O que é o sistema

| Camada | Onde roda | O que tem |
|---|---|---|
| Site/app (HTML + JS puro, sem build) | Netlify, `fieldo-zelo.com.br` | 52 páginas; `db.js` com 6.753 linhas/320 KB carregado em 28 delas |
| SEO server-side | Netlify Edge Functions (Deno) | 9 functions: perfil, explorar, lista "profissão-em-cidade", vitrine de locadora, região, sitemap |
| Banco + Auth + Storage | Supabase (us-east-2) | 63 tabelas em `public`, 2 em `gestao`, 169 funções, 81 policies, 6 buckets, 5 jobs `pg_cron` |
| Lógica de servidor | Supabase Edge Functions | 23 publicadas (7 no zip) |
| Integrações | Asaas (cobrança), Anthropic (assistente e "Conselho"), BrasilAPI (CNPJ) | |

Produtos dentro do mesmo código: **Fieldo** (profissional autônomo: relatório de serviço, orçamento,
avaliação, perfil público, contrato de obra, Studio de vídeo), **Locação** (locadoras de equipamento,
contrato digital assinado), **Zelo** (síndico/condomínio) e um portal **Gestão** (2 tabelas, 0 uso visível).

Identidade: todo usuário nasce **anônimo** (`/auth/v1/signup` sem e-mail) e depois recebe um
"código de recuperação" de 16 caracteres que vira e-mail sintético + senha. Login por e-mail e senha
existe desde a v12.12. Produção: 64 usuários em `auth.users` (16 ainda anônimos), 27 profissionais,
2 locadoras.

---

## 2. Banco: produção × repositório

### 2.1 A baseline em contêiner é idêntica a produção

Extraí o DDL do catálogo de produção (tabelas, constraints, funções, views, triggers, policies,
grants de tabela/coluna/função, comentários) para `infra/db/init/` e apliquei num `supabase/postgres`
**17.6.1.104** (a mesma versão de produção). Depois comparei md5 de cada categoria nos dois lados
(`infra/db/verify/*.sql`):

| Categoria | Qtd. | Produção = contêiner? |
|---|---|---|
| Tabelas (colunas, tipos, nulidade, defaults) | 65 | ✅ idêntico |
| Views | 7 | ✅ |
| Funções (corpo completo) | 169 | ✅ |
| Constraints | 325 | ✅ |
| Índices | 225 | ✅ |
| Triggers | 42 | ✅ |
| Policies RLS | 81 | ✅ |
| Grants de tabela / função / coluna (anon, authenticated, service_role, PUBLIC) | 885 / 350 / 217 | ✅ |

Única adaptação: o default `change_requests.change_id = next_change_id()` é aplicado depois das
funções (`41_defaults_tardios.sql`), porque a ordem de criação original não existe mais.

### 2.2 As migrations do zip, reaplicadas sobre a réplica

Cada arquivo de `supabase/migrations/` rodou numa transação com rollback sobre a réplica:

| Resultado | Arquivos | O que significa |
|---|---|---|
| Aplica e deixa o banco **idêntico** a produção | 18 | coerentes e idempotentes |
| Aplica mas **regride** funções | `loc_contratos_01/02`, `verificar_contrato_locacao`, `cadastro_fluxo`, `obras` | versões antigas, corrigidas depois por outros arquivos ou por diferença só de espaço em branco (produção guarda os corpos reindentados) |
| **Regressão real** | `2026-11-18_verificar_pdf.sql` | ver abaixo |
| **Falha** (`cannot drop columns from view`) | `2026-10-29_perfil_credibilidade.sql`, `2026-10-31_outras_profissoes.sql` | recriam `professional_stats` com menos colunas do que a view atual — não são reexecutáveis |

**Bug de ordem — concreto.** `2026-11-18_obra_contratos.sql` redefine `verificar_pdf` para aceitar
também contratos de obra. `2026-11-18_verificar_pdf.sql` define a versão antiga, só de locação. Em
ordem alfabética (que é como `supabase db push`, um `for f in *.sql` ou qualquer pessoa roda),
`verificar_pdf` vem **depois** e desfaz a de obra. Em produção funcionou porque a ordem foi forçada à
mão em `admin-migracoes/lista.ts` (`ordem: 6` e `7`). Um ambiente novo montado pelos arquivos sairia
com a verificação de PDF de contrato de obra quebrada, sem erro nenhum.

### 2.3 Histórico de migrations não confiável

- 11 dos 26 arquivos do zip **não aparecem** em `supabase_migrations.schema_migrations` de
  produção, mas os objetos deles existem (`obras`, `aceites`, `pedidos_titular`…). Foram aplicados
  pelo SQL Editor. O histórico de produção, portanto, não descreve produção.
- 120 migrations de produção (`v5_001_schema_core`, `mcp_*`, `integrity_agent_*`…) não têm arquivo
  no zip.
- Os nomes `2026-11-18_x.sql` não seguem o formato da CLI do Supabase (`YYYYMMDDHHMMSS_x.sql`);
  a CLI não os reconhece.
- Não há `supabase/config.toml`: o `verify_jwt` de cada função existe só no painel.

**A baseline gerada aqui deveria virar a migration zero do repositório** e, daqui em diante, nada
entra em produção sem arquivo.

---

## 3. Tabela por tabela (resumo)

Detalhe completo (colunas, tipos, constraints, policies, grants por coluna, triggers, índices) em
[`DICIONARIO_DE_DADOS.md`](DICIONARIO_DE_DADOS.md). Linhas = produção em 21/11/2026.

| Domínio | Tabelas (linhas) | Observação |
|---|---|---|
| Núcleo | `professionals` (27), `reports` (69), `budgets` (32), `avaliacoes` (12), `document_hashes` (77), `obras` (3), `obra_contratos` (1), `notificacoes` (2), `professional_slug_antigos` (8), `budget_counters` (3) | `anon` lê só colunas liberadas uma a uma; `plan` não é gravável pelo usuário |
| Legado sem uso | `empreiteiros` (0), `empreitadas` (0), `work_entries` (0), `locacao_contratos` (0, substituída por `loc_contratos`), `locacao_laudos` (0) | candidatas a remoção |
| Locação | `locadoras` (2), `equipamentos` (4), `locacoes` (2), `loc_contratos` (2), `loc_contrato_assinaturas` (4), `loc_contrato_eventos` (28) | contrato congelado por trigger, assinatura só-inserção |
| Zelo/Gestão | `condo_*` (3, 3, 0, 1), `gestao.companies`, `gestao.company_users` | policies `TO public`; Gestão sem uso no front |
| Cobrança | `assinaturas` (3), `asaas_eventos` (51), `license_redemptions` (2) | escrita só por service role; código das functions **fora do zip** |
| LGPD | `aceites` (8), `pedidos_titular` (1), `registros_acesso` (49) | retenção diária via `pg_cron` |
| Métricas | `analytics_events` (6.268), `impact_events` (515), `funnel_events` (101), `signup_leads` (11) | inserção pública — ver §4.2 |
| IA / interna | `council_*`, `integrity_*` (6.576 linhas), `change_*`, `snapshot_*`, `mcp_api_keys` (5) | engenharia interna dividindo o mesmo banco do produto |

`integrity_checks` + `analytics_events` somam ~12.800 das ~14.000 linhas do banco: hoje o banco
guarda mais telemetria do que negócio.

---

## 4. Segurança

### 4.1 O que testei e segurou (na réplica, pelo gateway, como um atacante faria)

| Tentativa | Resultado |
|---|---|
| `anon` lê `phone`/`email` de `professionals` | `permission denied` (grant por coluna) |
| Usuário anônimo cria perfil com `id` de outro | bloqueado pela RLS |
| Usuário se dá `plan = 'pro'` por UPDATE | `permission denied` (coluna fora do grant) |
| Usuário nasce Pro no INSERT (`plan`, `plan_expires_at`, `is_public`) | trigger `sanear_insert_professional` zera |
| Locadora nasce Pro | coluna `plan` fora do grant de INSERT |
| Upload em pasta de outro usuário no Storage | 403 da policy |
| `submit_rating` com token inválido | `nao_encontrado`, sem vazamento |
| Funções que leem o Vault (`get_council_key` etc.) | só `service_role` executa |

O desenho do banco é o ponto forte do projeto. Isso precisa ser dito porque é verdade.

### 4.2 Problemas, do mais grave ao menor

1. **Código de cobrança e licença fora de controle de versão.** `asaas-webhook`, `assinatura`,
   `license`, `license-issue`, `mcp` existem só em produção. Não dá para revisar, testar nem
   restaurar. Antes de qualquer outra coisa: baixar e versionar.
2. **Inserção pública sem limite de tamanho.** Testado: um `POST /rest/v1/analytics_events` anônimo
   com `props` de **500 KB** foi aceito (201). Sem rate limit, um laço simples enche o disco do
   plano do Supabase. Correção: `check (pg_column_size(props) <= 4096)` e limite equivalente em
   `funnel_events`/`signup_leads`; ou trocar o INSERT direto por função com limite por IP.
3. **"verify_jwt = true" não protege nada aqui.** Login anônimo está ligado (é o fluxo do app), então
   qualquer pessoa obtém um JWT válido com papel `authenticated` em uma chamada. O comentário da
   `send-otp` em produção diz o contrário ("nem chamada anônima chega até este código") — esse
   modelo mental errado é perigoso para as próximas functions. Toda function com `verify_jwt=true`
   precisa checar dono/papel por conta própria. O mesmo vale para as 65 funções `SECURITY DEFINER`
   executáveis por `authenticated`: "authenticated" aqui significa "qualquer um".
4. **Sessão e senha no `localStorage`, sem CSP.** O `db.js` guarda `access_token` + `refresh_token`
   em `localStorage` (`fieldo_auth`) e o código de recuperação — que **é a senha** da conta — em
   texto puro (`fieldo_recovery_code`). Há 326 usos de `innerHTML` no front e nenhum
   `Content-Security-Policy` no `netlify.toml`. Os escapes que vi estão corretos, mas um único XSS
   leva a conta de forma permanente (o código continua valendo mesmo após o refresh token ser
   revogado). Prioridade: CSP restritiva e parar de guardar o código depois de exibido.
5. **Uma chave de administrador para tudo.** `FIELDO_ADMIN_KEY` (header `x-admin-key`) dá:
   excluir conta, editar qualquer campo, trocar e-mail de login e aplicar migrations no banco.
   Sem segundo fator, sem identidade de quem agiu, só 700 ms de atraso contra força bruta, e as
   páginas `admin-*.html` (exceto `admin.html`) são servidas publicamente. A auditoria em
   `admin_auditoria` registra o quê, não quem.
6. **Métricas envenenáveis.** `log_impact_event` é executável por `anon` e conta por profissional,
   com teto de 60/h por tipo. Um script consegue tanto inflar as métricas de alguém quanto
   saturar o teto e apagar os eventos reais daquela hora.
7. **`professional_stats` é `SECURITY DEFINER`** (único ERROR do advisor do Supabase). Hoje filtra
   `is_public` e só expõe colunas que o `anon` já lê, então não vaza nada — mas qualquer coluna
   nova adicionada à view vira pública ignorando a RLS. Trocar para `security_invoker`.
8. **IP do Marco Civil.** `private.ip_da_requisicao()` usa `cf-connecting-ip`, depois `x-real-ip`,
   depois o primeiro valor de `X-Forwarded-For`. **Não tenho certeza** de quais desses o gateway
   do Supabase sobrescreve; se algum passar intacto do cliente, o IP registrado é forjável. Vale um
   teste em produção enviando esses headers.
9. Menores: `auth_leaked_password_protection` desligado no Auth; `admin.html` bloqueado mas as
   outras `admin-*.html` não; `anon` com `INSERT/UPDATE/DELETE` em views não-atualizáveis
   (inofensivo, mas é ruído que esconde grant de verdade).

---

## 5. Código e processo

- **Sem testes, sem `package.json`, sem CI no zip.** Comentários citam "teste local com Node +
  Postgres" e uma pasta `_removidos/` — nenhum dos dois está aqui.
- **Documentação que mente.** O cabeçalho do `db.js` diz "v4.3", "License → HMAC verify offline" e
  "Supabase Auth removido"; o código atual faz o oposto nos três pontos. Os comentários "por quê" no
  meio do código são excelentes; o índice no topo é perigoso porque é a primeira coisa que alguém lê.
- **`db.js` monolítico** (320 KB, ~30 módulos num IIFE) carregado em 28 páginas, sem build nem
  minificação. Funciona, mas cada mudança toca o arquivo de que tudo depende.
- **URL e anon key do Supabase fixas em 22 lugares** (front + 6 edge functions). Trocar de projeto
  ou ter staging exige busca e troca manual. No ambiente local resolvi sem tocar no código
  (o gateway reescreve na resposta), mas o certo é um ponto único de configuração.
- **Código morto**: `services/` (TypeScript não referenciado), `vercel.json` (o deploy é Netlify),
  `sw.js` é um "kill switch" desde a v5.9 (o app não é offline, apesar do manifest de PWA),
  tabelas legadas da §3, `send-otp`/`verify-otp`/`setup-webhook` neutralizadas mas publicadas.
- **Engenharia interna no banco do produto**: Integrity Agent, Version Manager, Conselho de IA e
  snapshots somam 10 tabelas, 6 functions e 2 jobs de cron. Para 27 profissionais cadastrados, é
  mais infraestrutura de observação do que produto observado. Não é bug — é onde o tempo está indo.

---

## 6. Contêineres

`infra/docker-compose.yml` sobe, com versões fixadas:

| Serviço | Imagem | Papel |
|---|---|---|
| `db` | `supabase/postgres:17.6.1.104` | mesma versão de produção + baseline idêntica |
| `auth` | `supabase/gotrue:v2.177.0` | login anônimo e e-mail/senha |
| `rest` | `postgrest/postgrest:v12.2.12` | `/rest/v1` |
| `storage` | `supabase/storage-api:v1.25.7` | buckets e policies de produção, backend em arquivo |
| `db-post` | (one-shot) | buckets, grants/policies de storage, dados **fictícios** de demonstração |
| `edge-netlify` | `denoland/deno:alpine-2.1.4` | as 8 Netlify Edge Functions **sem alterar o código** |
| `gateway` | `nginx:1.27-alpine` | `:8000` API no formato Supabase · `:8080` site com as regras do `netlify.toml` |
| `functions` (perfil opcional) | `supabase/edge-runtime:v1.67.4` | as 7 Supabase Edge Functions do zip |

**Verificado aqui:** subida limpa do zero; os testes da §4.1; `/`, `/explorar`, `/p/<slug>`,
`/litoral-norte`, `/sitemap.xml` renderizados no servidor com dados locais; rotas bloqueadas (`/admin.html`,
`/supabase/*`) dão 404 como na Netlify; nenhuma referência a produção sai no HTML/JS servido.

**Não verificado aqui:** o perfil `functions` subiu, mas o runtime não baixou o pacote npm
`postgres` porque este sandbox não dá saída de rede direta a contêineres. Numa máquina comum isso
não acontece — mas eu não vi funcionar, então trate como não testado. O deploy de produção continua
sendo Netlify + Supabase; o compose é para desenvolvimento, homologação e recuperação de desastre,
não substitui produção.

---

## 7. O que fazer, em ordem

1. Baixar e versionar as 16 Edge Functions que só existem em produção (cobrança primeiro).
2. Adotar `infra/db/init/` como baseline oficial; renomear as migrations para o formato da CLI;
   corrigir a ordem `verificar_pdf`/`obra_contratos`; marcar como históricas as duas que não
   reaplicam. Daqui em diante: nada no SQL Editor sem arquivo.
3. Limitar tamanho em `analytics_events.props` e afins; rate limit nas RPCs públicas.
4. CSP no `netlify.toml`; não persistir o código de recuperação.
5. Revisar toda function `verify_jwt=true` e todo `SECURITY DEFINER` com a premissa correta:
   "authenticated" = qualquer pessoa.
6. Admin: identidade por pessoa (usuário + papel no banco) em vez de uma chave compartilhada.
7. Atualizar o cabeçalho do `db.js`; apagar código e tabelas mortas.
