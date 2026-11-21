# claude-
Vídeos Claude

## Fieldo

Código do site **Fieldo v12.41** (como entregue no zip) + infraestrutura para rodar tudo em contêineres
+ análise técnica do projeto e do banco de produção.

| Pasta | O que é |
|---|---|
| `site/` | o site/app exatamente como no zip `fieldo-site-v12.41` (nenhum arquivo alterado) |
| `infra/` | `docker compose`: Postgres idêntico a produção, Auth, REST, Storage, gateway, edge functions — ver [`infra/README.md`](infra/README.md) |
| `docs/ANALISE.md` | análise: arquitetura, divergência repositório × produção, segurança, prioridades |
| `docs/DICIONARIO_DE_DADOS.md` | as 65 tabelas, uma por uma: colunas, constraints, RLS, grants, triggers |

Começo rápido:

```bash
cd infra && ./scripts/gerar-env.sh && docker compose up -d
# site http://localhost:8080 · API http://localhost:8000
```
