# Fieldo · Dicionário de dados

Gerado por `infra/scripts/dicionario.py` a partir do banco em contêiner, cujo schema é **idêntico** ao de produção (verificado por impressão digital — ver `docs/ANALISE.md` §2). Grants: S=SELECT I=INSERT U=UPDATE D=DELETE T=TRUNCATE.

## Índice

- **Núcleo: profissional, serviço, orçamento, avaliação**: `professionals`, `professional_slug_antigos`, `reports`, `avaliacoes`, `budgets`, `budget_counters`, `document_hashes`, `obras`, `obra_contratos`, `obra_contrato_assinaturas`, `obra_contrato_eventos`, `empreiteiros`, `empreitadas`, `work_entries`, `notificacoes`
- **Locação de equipamentos**: `locadoras`, `equipamento_categorias`, `equipamentos`, `locacoes`, `locacao_itens`, `locacao_laudos`, `locacao_contratos`, `loc_contrato_modelos`, `loc_contratos`, `loc_contrato_assinaturas`, `loc_contrato_eventos`, `assistant_usage_locadora`
- **Zelo (condomínios) e Gestão**: `condo_sindicos`, `condo_condominios`, `condo_manutencoes_recorrentes`, `condo_servicos_contratados`, `companies`, `company_users`
- **Cobrança e plano**: `assinaturas`, `asaas_eventos`, `license_redemptions`
- **Materiais**: `materiais`, `material_listas`, `material_precos`
- **Studio (vídeo) e mídia**: `studio_videos`, `midia_cotas`, `midia_uso`
- **LGPD e Marco Civil**: `aceites`, `pedidos_titular`, `registros_acesso`
- **Métricas e aquisição**: `impact_events`, `funnel_events`, `analytics_events`, `signup_leads`
- **IA: assistente, MCP, Conselho**: `assistant_usage`, `mcp_api_keys`, `mcp_oauth_rate_limit`, `council_reviews`, `council_opinions`, `council_budget`
- **Engenharia interna (integridade, versões, snapshots, admin)**: `integrity_checks`, `integrity_incidents`, `change_requests`, `change_file_versions`, `change_tests`, `project_snapshots`, `snapshot_files`, `snapshot_changes`, `snapshot_exports`, `admin_auditoria`


## Núcleo: profissional, serviço, orçamento, avaliação

### `professionals`

- Linhas em produção: **27** · RLS: ligada + FORCE · grants de tabela: anon `— (só R/G/M)`, authenticated `DIS`
- **anon lê só estas colunas** (grant por coluna): `id`, `name`, `profissao`, `specialty`, `city`, `slug`, `whatsapp`, `bio`, `logo_url`, `instagram`, `plan`, `is_public`, `created_at`, `updated_at`, `portfolio_publico`, `niche`, `area_atendimento`, `tipo_atendimento`, `cnpj`, `empresa_nome`, `cnpj_situacao`, `cnpj_abertura`, `cnpj_verificado_em`, `atua_desde`, `garantia`, `formas_pagamento`, `atende_urgencia`, `registros`, `outras_profissoes`, `nichos`, `cidades_atendidas`, `cidades`, `aceita_ligacao`
- **authenticated só ATUALIZA estas colunas** (grant por coluna): `name`, `profissao`, `specialty`, `city`, `slug`, `phone`, `whatsapp`, `email`, `bio`, `logo_url`, `instagram`, `pix_key`, `pix_tipo`, `include_pix`, `is_public`, `portfolio_publico`, `portfolio_aceito_em`, `niche`, `area_atendimento`, `tipo_atendimento`, `atua_desde`, `garantia`, `formas_pagamento`, `atende_urgencia`, `registros`, `outras_profissoes`, `cidades_atendidas`, `aceita_ligacao`
- **authenticated só INSERE estas colunas** (grant por coluna): `outras_profissoes`, `cidades_atendidas`, `aceita_ligacao`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não |  |
| `name` | text | sim |  |
| `profissao` | text | sim |  |
| `specialty` | text | sim |  |
| `city` | text | sim |  |
| `slug` | text | sim |  |
| `phone` | text | sim |  |
| `whatsapp` | text | sim |  |
| `email` | text | sim |  |
| `bio` | text | sim |  |
| `logo_url` | text | sim |  |
| `instagram` | text | sim |  |
| `pix_key` | text | sim |  |
| `pix_tipo` | text | sim |  |
| `include_pix` | boolean | não | `true` |
| `plan` | text | não | `'free'::text` |
| `plan_expires_at` | timestamp with time zone | sim |  |
| `is_public` | boolean | não | `false` |
| `created_at` | timestamp with time zone | não | `now()` |
| `updated_at` | timestamp with time zone | não | `now()` |
| `portfolio_publico` | boolean | não | `false` |
| `portfolio_aceito_em` | timestamp with time zone | sim |  |
| `city_slug` | text | sim |  |
| `uf` | character(2) | sim |  |
| `niche` | text | sim |  |
| `origem` | text | sim |  |
| `area_atendimento` | text | sim |  |
| `tipo_atendimento` | text | não | `'ambos'::text` |
| `cnpj` | text | sim |  |
| `empresa_nome` | text | sim |  |
| `cnpj_situacao` | text | sim |  |
| `cnpj_abertura` | date | sim |  |
| `cnpj_verificado_em` | timestamp with time zone | sim |  |
| `atua_desde` | smallint | sim |  |
| `garantia` | text | sim |  |
| `formas_pagamento` | text[] | sim |  |
| `atende_urgencia` | boolean | não | `false` |
| `registros` | text | sim |  |
| `outras_profissoes` | jsonb | não | `'[]'::jsonb` |
| `nichos` | text[] | não | `'{}'::text[]` |
| `cidades_atendidas` | text[] | não | `'{}'::text[]` |
| `cidades` | text[] | não | `'{}'::text[]` |
| `aceita_ligacao` | boolean | não | `false` |

<details><summary>Constraints (12)</summary>

- CHECK `prof_atua_desde_faixa`: `CHECK (((atua_desde IS NULL) OR ((atua_desde >= 1950) AND (atua_desde <= 2100))))`
- CHECK `prof_cnpj_formato`: `CHECK (((cnpj IS NULL) OR (cnpj ~ '^[0-9]{14}$'::text)))`
- CHECK `prof_garantia_tam`: `CHECK (((garantia IS NULL) OR (char_length(garantia) <= 60)))`
- CHECK `prof_pagamentos_validos`: `CHECK (((formas_pagamento IS NULL) OR (formas_pagamento <@ ARRAY['pix'::text, 'dinheiro'::text, 'cartao_credito'::text, 'cartao_debito'::text, 'boleto'::text, 'transferencia'::text])))`
- CHECK `prof_registros_tam`: `CHECK (((registros IS NULL) OR (char_length(registros) <= 200)))`
- CHECK `professionals_origem_tamanho`: `CHECK (((origem IS NULL) OR (char_length(origem) <= 120)))`
- CHECK `professionals_outras_profissoes_check`: `CHECK (((jsonb_typeof(outras_profissoes) = 'array'::text) AND (jsonb_array_length(outras_profissoes) <= 3)))`
- CHECK `professionals_plan_check`: `CHECK ((plan = ANY (ARRAY['free'::text, 'pro'::text])))`
- CHECK `professionals_tipo_atendimento_check`: `CHECK ((tipo_atendimento = ANY (ARRAY['residencial'::text, 'comercial'::text, 'ambos'::text])))`
- FK `professionals_id_fkey`: `FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE`
- PK `professionals_pkey`: `PRIMARY KEY (id)`
- UNIQUE `professionals_slug_key`: `UNIQUE (slug)`

</details>

**Policies RLS**

- `prof_insert` — INSERT para authenticated · CHECK `(id = ( SELECT auth.uid() AS uid))`
- `prof_select_own` — SELECT para authenticated · USING `(id = ( SELECT auth.uid() AS uid))`
- `prof_select_publico` — SELECT para anon · USING `(is_public OR (EXISTS ( SELECT 1 FROM reports r WHERE ((r.professional_id = professionals.id) AND r.is_public))))`
- `prof_update` — UPDATE para authenticated · USING `(id = ( SELECT auth.uid() AS uid))`

<details><summary>Triggers (9)</summary>

- `trg_aceite_portfolio` — `trg_aceite_portfolio BEFORE UPDATE` → `registrar_aceite_portfolio()`
- `trg_bloquear_plano` — `trg_bloquear_plano BEFORE UPDATE` → `bloquear_alteracao_plano()`
- `trg_prof_cidade` — `trg_prof_cidade BEFORE INSERT OR UPDATE OF city` → `trg_cidade()`
- `trg_prof_cidades` — `trg_prof_cidades BEFORE INSERT OR UPDATE OF city, cidades_atendidas` → `trg_prof_cidades()`
- `trg_prof_nichos` — `trg_prof_nichos BEFORE INSERT OR UPDATE OF niche, outras_profissoes` → `trg_prof_nichos()`
- `trg_prof_slug` — `trg_prof_slug BEFORE INSERT OR UPDATE OF name, profissao, city` → `trg_professionals_slug()`
- `trg_prof_slug_antigo` — `trg_prof_slug_antigo BEFORE UPDATE OF slug` → `trg_guardar_slug_antigo()`
- `trg_prof_updated` — `trg_prof_updated BEFORE UPDATE` → `set_updated_at()`
- `trg_sanear_insert_prof` — `trg_sanear_insert_prof BEFORE INSERT` → `sanear_insert_professional()`

</details>

<details><summary>Índices extras (8)</summary>

- `CREATE INDEX idx_prof_is_public ON public.professionals USING btree (is_public) WHERE is_public`
- `CREATE INDEX idx_professionals_origem ON public.professionals USING btree (origem) WHERE (origem IS NOT NULL)`
- `CREATE UNIQUE INDEX professionals_cnpj_uk ON public.professionals USING btree (cnpj) WHERE (cnpj IS NOT NULL)`
- `CREATE INDEX professionals_nichos_gin ON public.professionals USING gin (nichos)`
- `CREATE INDEX professionals_cidades_gin ON public.professionals USING gin (cidades)`
- `CREATE INDEX idx_prof_cidade ON public.professionals USING btree (city_slug, uf) WHERE (city_slug IS NOT NULL)`
- `CREATE INDEX idx_prof_city_slug_publico ON public.professionals USING btree (city_slug) WHERE (is_public = true)`
- `CREATE INDEX idx_prof_slug ON public.professionals USING btree (slug) WHERE (slug IS NOT NULL)`

</details>

### `professional_slug_antigos`

- Linhas em produção: **8** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `slug` | text | não |  |
| `professional_id` | uuid | não |  |
| `trocado_em` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (2)</summary>

- FK `professional_slug_antigos_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `professional_slug_antigos_pkey`: `PRIMARY KEY (slug)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

### `reports`

- Linhas em produção: **69** · RLS: ligada + FORCE · grants de tabela: anon `— (só R/G/M)`, authenticated `DISU`
- **anon lê só estas colunas** (grant por coluna): `id`, `professional_id`, `category_key`, `category_label`, `niche`, `service_date`, `photos`, `is_public`, `rating`, `rating_comment`, `rating_used`, `created_at`, `updated_at`, `portfolio_ok`, `titulo_publico`, `tipo`
- **authenticated só ATUALIZA estas colunas** (grant por coluna): `arquivado_em`, `tipo`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `professional_id` | uuid | não |  |
| `client_name` | text | não |  |
| `category_key` | text | sim |  |
| `category_label` | text | sim |  |
| `niche` | text | sim |  |
| `service_date` | date | sim |  |
| `service_location` | text | sim |  |
| `service_description` | text | sim |  |
| `photos` | jsonb | não | `'[]'::jsonb` |
| `is_public` | boolean | não | `true` |
| `rating` | smallint | sim |  |
| `rating_comment` | text | sim |  |
| `rating_used` | boolean | não | `false` |
| `rating_token` | text | não | `encode(gen_random_bytes(12), 'hex'::text)` |
| `linked_budget_id` | uuid | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `updated_at` | timestamp with time zone | não | `now()` |
| `valor` | numeric(12,2) | sim |  |
| `payment_status` | text | não | `'nao_cobrado'::text` |
| `paid_at` | timestamp with time zone | sim |  |
| `client_paid_claim_at` | timestamp with time zone | sim |  |
| `portfolio_ok` | boolean | não | `true` |
| `arquivado_em` | timestamp with time zone | sim |  |
| `cliente_curto` | text | sim |  |
| `obra_id` | uuid | sim |  |
| `titulo_publico` | text | sim |  |
| `tipo` | text | não | `'servico'::text` |

<details><summary>Constraints (14)</summary>

- CHECK `chk_comentario_exige_nota`: `CHECK (((rating_comment IS NULL) OR (rating IS NOT NULL)))`
- CHECK `chk_nota_implica_usado`: `CHECK (((rating IS NULL) OR (rating_used = true)))`
- CHECK `chk_pago_tem_data`: `CHECK ((((payment_status = 'pago'::text) AND (paid_at IS NOT NULL)) OR ((payment_status <> 'pago'::text) AND (paid_at IS NULL))))`
- CHECK `chk_valor_implica_cobranca`: `CHECK (((valor IS NULL) OR (payment_status <> 'nao_cobrado'::text)))`
- CHECK `reports_payment_status_check`: `CHECK ((payment_status = ANY (ARRAY['nao_cobrado'::text, 'pendente'::text, 'pago'::text])))`
- CHECK `reports_rating_check`: `CHECK (((rating >= 1) AND (rating <= 5)))`
- CHECK `reports_tipo_check`: `CHECK ((tipo = ANY (ARRAY['servico'::text, 'portfolio'::text])))`
- CHECK `reports_valor_check`: `CHECK ((valor >= (0)::numeric))`
- FK `fk_rep_linked_budget`: `FOREIGN KEY (linked_budget_id, professional_id) REFERENCES budgets(id, professional_id) ON DELETE SET NULL (linked_budget_id)`
- FK `reports_obra_id_fkey`: `FOREIGN KEY (obra_id) REFERENCES obras(id) ON DELETE SET NULL`
- FK `reports_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `reports_pkey`: `PRIMARY KEY (id)`
- UNIQUE `reports_rating_token_key`: `UNIQUE (rating_token)`
- UNIQUE `uq_rep_id_prof`: `UNIQUE (id, professional_id)`

</details>

**Policies RLS**

- `rep_delete` — DELETE para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`
- `rep_insert` — INSERT para authenticated · CHECK `(professional_id = ( SELECT auth.uid() AS uid))`
- `rep_select_own` — SELECT para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`
- `rep_select_publico` — SELECT para anon · USING `is_public`
- `rep_update` — UPDATE para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`

<details><summary>Triggers (7)</summary>

- `reports_obra_dono` — `reports_obra_dono BEFORE INSERT OR UPDATE OF obra_id, professional_id` → `reports_obra_dono()`
- `trg_ativar_perfil` — `trg_ativar_perfil AFTER INSERT OR UPDATE OF is_public` → `ativar_perfil_publico()`
- `trg_limite_reports_gratis` — `trg_limite_reports_gratis BEFORE INSERT` → `limitar_reports_plano_gratis()`
- `trg_protege_reports` — `trg_protege_reports AFTER DELETE` → `impedir_delete_total()`
- `trg_rep_cliente_curto` — `trg_rep_cliente_curto BEFORE INSERT OR UPDATE OF client_name` → `trg_reports_cliente_curto()`
- `trg_rep_titulo_publico` — `trg_rep_titulo_publico BEFORE INSERT OR UPDATE OF service_description` → `trg_reports_titulo_publico()`
- `trg_rep_updated` — `trg_rep_updated BEFORE UPDATE` → `set_updated_at()`

</details>

<details><summary>Índices extras (9)</summary>

- `CREATE INDEX idx_rep_prof ON public.reports USING btree (professional_id, created_at DESC)`
- `CREATE INDEX idx_rep_portfolio ON public.reports USING btree (professional_id, created_at DESC) WHERE (is_public AND portfolio_ok)`
- `CREATE INDEX idx_rep_ativos ON public.reports USING btree (professional_id, created_at DESC) WHERE (arquivado_em IS NULL)`
- `CREATE INDEX idx_rep_linked_budget_prof ON public.reports USING btree (linked_budget_id, professional_id)`
- `CREATE INDEX idx_rep_token ON public.reports USING btree (rating_token)`
- `CREATE INDEX idx_rep_pagamento ON public.reports USING btree (professional_id, payment_status, created_at DESC) WHERE (payment_status <> 'nao_cobrado'::text)`
- `CREATE INDEX idx_rep_linked ON public.reports USING btree (linked_budget_id) WHERE (linked_budget_id IS NOT NULL)`
- `CREATE INDEX reports_obra_idx ON public.reports USING btree (obra_id) WHERE (obra_id IS NOT NULL)`
- `CREATE INDEX idx_reports_prof_publico ON public.reports USING btree (professional_id) WHERE (is_public = true)`

</details>

### `avaliacoes`

- Linhas em produção: **12** · RLS: ligada + FORCE · grants de tabela: anon `—`, authenticated `DIS`
- **anon lê só estas colunas** (grant por coluna): `id`, `professional_id`, `report_id`, `nota`, `comentario`, `created_at`, `resposta`, `respondido_em`, `nome_avaliador_curto`
- **authenticated só ATUALIZA estas colunas** (grant por coluna): `resposta`, `respondido_em`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `professional_id` | uuid | não |  |
| `report_id` | uuid | não |  |
| `nota` | smallint | não |  |
| `comentario` | text | sim |  |
| `nome_avaliador` | text | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `resposta` | text | sim |  |
| `respondido_em` | timestamp with time zone | sim |  |
| `nome_avaliador_curto` | text | sim |  |

<details><summary>Constraints (6)</summary>

- CHECK `avaliacoes_nota_check`: `CHECK (((nota >= 1) AND (nota <= 5)))`
- CHECK `chk_resposta_tamanho`: `CHECK (((resposta IS NULL) OR (char_length(resposta) <= 600)))`
- FK `avaliacoes_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- FK `fk_aval_report`: `FOREIGN KEY (report_id, professional_id) REFERENCES reports(id, professional_id) ON DELETE CASCADE`
- PK `avaliacoes_pkey`: `PRIMARY KEY (id)`
- UNIQUE `avaliacoes_report_id_key`: `UNIQUE (report_id)`

</details>

**Policies RLS**

- `aval_responder` — UPDATE para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`
- `aval_select_own` — SELECT para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`
- `aval_select_publico` — SELECT para anon · USING `(EXISTS ( SELECT 1 FROM reports r WHERE ((r.id = avaliacoes.report_id) AND r.is_public AND (r.tipo = 'servico'::text))))`

<details><summary>Triggers (3)</summary>

- `trg_aval_nome_curto` — `trg_aval_nome_curto BEFORE INSERT OR UPDATE OF nome_avaliador` → `trg_avaliacoes_nome_curto()`
- `trg_protege_avaliacoes` — `trg_protege_avaliacoes AFTER DELETE` → `impedir_delete_total()`
- `trg_resposta_aval` — `trg_resposta_aval BEFORE UPDATE` → `marcar_resposta_avaliacao()`

</details>

<details><summary>Índices extras (2)</summary>

- `CREATE INDEX idx_aval_prof ON public.avaliacoes USING btree (professional_id, created_at DESC)`
- `CREATE INDEX idx_aval_report_prof ON public.avaliacoes USING btree (report_id, professional_id)`

</details>

### `budgets`

- Linhas em produção: **32** · RLS: ligada + FORCE · grants de tabela: anon `—`, authenticated `DISU`
- **authenticated só ATUALIZA estas colunas** (grant por coluna): `arquivado_em`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `professional_id` | uuid | não |  |
| `number` | text | sim |  |
| `titulo` | text | sim |  |
| `client_name` | text | não |  |
| `client_phone` | text | sim |  |
| `local` | text | sim |  |
| `descricao` | text | sim |  |
| `items` | jsonb | não | `'[]'::jsonb` |
| `subtotal` | numeric(12,2) | não | `0` |
| `desconto` | numeric(12,2) | não | `0` |
| `total` | numeric(12,2) | não | `0` |
| `prazo` | text | sim |  |
| `validade` | text | sim |  |
| `pagamento` | text | sim |  |
| `garantia` | text | sim |  |
| `observacoes` | text | sim |  |
| `emissao` | date | sim |  |
| `status` | text | não | `'pendente'::text` |
| `linked_report_id` | uuid | sim |  |
| `is_public` | boolean | não | `true` |
| `created_at` | timestamp with time zone | não | `now()` |
| `updated_at` | timestamp with time zone | não | `now()` |
| `approval_token` | text | não | `encode(gen_random_bytes(12), 'hex'::text)` |
| `approved_at` | timestamp with time zone | sim |  |
| `approval_note` | text | sim |  |
| `client_signature` | text | sim |  |
| `arquivado_em` | timestamp with time zone | sim |  |
| `mcp_idempotency_key` | text | sim |  |
| `origem` | text | sim |  |

<details><summary>Constraints (11)</summary>

- CHECK `budgets_desconto_check`: `CHECK ((desconto >= (0)::numeric))`
- CHECK `budgets_origem_check`: `CHECK (((origem IS NULL) OR (origem = ANY (ARRAY['fieldo'::text, 'indicacao'::text, 'redes'::text, 'ja_cliente'::text, 'outro'::text]))))`
- CHECK `budgets_status_check`: `CHECK ((status = ANY (ARRAY['pendente'::text, 'aprovado'::text, 'recusado'::text, 'concluido'::text])))`
- CHECK `budgets_subtotal_check`: `CHECK ((subtotal >= (0)::numeric))`
- CHECK `budgets_total_check`: `CHECK ((total >= (0)::numeric))`
- CHECK `chk_decisao_tem_data`: `CHECK (((status <> ALL (ARRAY['aprovado'::text, 'recusado'::text])) OR (approved_at IS NOT NULL)))`
- FK `budgets_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- FK `fk_bud_linked_report`: `FOREIGN KEY (linked_report_id, professional_id) REFERENCES reports(id, professional_id) ON DELETE SET NULL (linked_report_id)`
- PK `budgets_pkey`: `PRIMARY KEY (id)`
- UNIQUE `budgets_approval_token_key`: `UNIQUE (approval_token)`
- UNIQUE `uq_bud_id_prof`: `UNIQUE (id, professional_id)`

</details>

**Policies RLS**

- `bud_delete` — DELETE para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`
- `bud_insert` — INSERT para authenticated · CHECK `(professional_id = ( SELECT auth.uid() AS uid))`
- `bud_select_own` — SELECT para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`
- `bud_update` — UPDATE para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`

<details><summary>Triggers (2)</summary>

- `trg_bud_updated` — `trg_bud_updated BEFORE UPDATE` → `set_updated_at()`
- `trg_protege_budgets` — `trg_protege_budgets AFTER DELETE` → `impedir_delete_total()`

</details>

<details><summary>Índices extras (6)</summary>

- `CREATE INDEX idx_bud_ativos ON public.budgets USING btree (professional_id, created_at DESC) WHERE (arquivado_em IS NULL)`
- `CREATE INDEX idx_bud_linked ON public.budgets USING btree (linked_report_id) WHERE (linked_report_id IS NOT NULL)`
- `CREATE UNIQUE INDEX budgets_mcp_idempotency_key_uk ON public.budgets USING btree (professional_id, mcp_idempotency_key) WHERE (mcp_idempotency_key IS NOT NULL)`
- `CREATE INDEX idx_bud_prof ON public.budgets USING btree (professional_id, created_at DESC)`
- `CREATE INDEX idx_bud_approval ON public.budgets USING btree (approval_token)`
- `CREATE INDEX idx_bud_linked_report_prof ON public.budgets USING btree (linked_report_id, professional_id)`

</details>

### `budget_counters`

- Linhas em produção: **3** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`
- Comentário no banco: _RFC-001 M5: contador atômico do número do orçamento, por profissional e ano. Nunca ler com count(*); usar _budget_next_number()._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `professional_id` | uuid | não |  |
| `ano` | smallint | não |  |
| `ultimo` | integer | não | `0` |
| `updated_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (2)</summary>

- FK `budget_counters_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `budget_counters_pkey`: `PRIMARY KEY (professional_id, ano)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

### `document_hashes`

- Linhas em produção: **77** · RLS: ligada + FORCE · grants de tabela: anon `—`, authenticated `DISU`
- **anon lê só estas colunas** (grant por coluna): `id`, `professional_id`, `tipo`, `created_at`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `professional_id` | uuid | sim |  |
| `hash` | text | não |  |
| `tipo` | text | não |  |
| `ref_id` | uuid | sim |  |
| `conteudo_resumo` | jsonb | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `locadora_id` | uuid | sim |  |

<details><summary>Constraints (6)</summary>

- CHECK `document_hashes_dono_ok`: `CHECK ((num_nonnulls(professional_id, locadora_id) = 1))`
- CHECK `document_hashes_tipo_check`: `CHECK ((tipo = ANY (ARRAY['servico'::text, 'orcamento'::text, 'contrato'::text, 'relatorio'::text, 'laudo'::text, 'contrato_locacao'::text, 'aceite_locacao'::text])))`
- FK `document_hashes_locadora_id_fkey`: `FOREIGN KEY (locadora_id) REFERENCES locadoras(id) ON DELETE CASCADE`
- FK `document_hashes_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `document_hashes_pkey`: `PRIMARY KEY (id)`
- UNIQUE `document_hashes_hash_key`: `UNIQUE (hash)`

</details>

**Policies RLS**

- `hash_all_own` — ALL para authenticated · USING `(COALESCE(professional_id, locadora_id) = ( SELECT auth.uid() AS uid))`
- `hash_select` — SELECT para anon · USING `true`

<details><summary>Triggers (1)</summary>

- `trg_selo_contrato_locacao` — `trg_selo_contrato_locacao BEFORE INSERT OR DELETE OR UPDATE` → `trg_selo_contrato_locacao()`

</details>

<details><summary>Índices extras (3)</summary>

- `CREATE INDEX idx_hash_prof ON public.document_hashes USING btree (professional_id, created_at DESC)`
- `CREATE INDEX idx_hash_locadora ON public.document_hashes USING btree (locadora_id) WHERE (locadora_id IS NOT NULL)`
- `CREATE INDEX idx_hash_ref ON public.document_hashes USING btree (ref_id) WHERE (ref_id IS NOT NULL)`

</details>

### `obras`

- Linhas em produção: **3** · RLS: ligada · grants de tabela: anon `—`, authenticated `DISU`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `professional_id` | uuid | não | `auth.uid()` |
| `cliente` | text | não |  |
| `titulo` | text | sim |  |
| `cidade` | text | sim |  |
| `valor_total` | numeric(12,2) | não |  |
| `status` | text | não | `'andamento'::text` |
| `concluida_em` | timestamp with time zone | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `updated_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (7)</summary>

- CHECK `obras_cidade_check`: `CHECK (((cidade IS NULL) OR (char_length(cidade) <= 80)))`
- CHECK `obras_cliente_check`: `CHECK (((char_length(btrim(cliente)) >= 1) AND (char_length(btrim(cliente)) <= 120)))`
- CHECK `obras_status_check`: `CHECK ((status = ANY (ARRAY['andamento'::text, 'concluida'::text])))`
- CHECK `obras_titulo_check`: `CHECK (((titulo IS NULL) OR (char_length(titulo) <= 120)))`
- CHECK `obras_valor_total_check`: `CHECK (((valor_total > (0)::numeric) AND (valor_total < (100000000)::numeric)))`
- FK `obras_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `obras_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `obras_delete_own` — DELETE para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`
- `obras_insert_own` — INSERT para authenticated · CHECK `(professional_id = ( SELECT auth.uid() AS uid))`
- `obras_select_own` — SELECT para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`
- `obras_update_own` — UPDATE para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`

<details><summary>Triggers (1)</summary>

- `obras_touch` — `obras_touch BEFORE UPDATE` → `obras_touch()`

</details>

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX obras_prof_idx ON public.obras USING btree (professional_id, status, created_at DESC)`

</details>

### `obra_contratos`

- Linhas em produção: **1** · RLS: ligada · grants de tabela: anon `—`, authenticated `S`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `professional_id` | uuid | não |  |
| `obra_id` | uuid | não |  |
| `grupo_id` | uuid | não |  |
| `ano` | integer | não |  |
| `seq` | integer | não |  |
| `numero` | text | não |  |
| `versao` | integer | não | `1` |
| `status` | text | não | `'rascunho'::text` |
| `dados` | jsonb | não |  |
| `documento_texto` | text | sim |  |
| `documento_hash` | text | sim |  |
| `token_hash` | text | sim |  |
| `token_expira_em` | timestamp with time zone | sim |  |
| `revogado_em` | timestamp with time zone | sim |  |
| `substituido_por` | uuid | sim |  |
| `enviado_em` | timestamp with time zone | sim |  |
| `concluido_em` | timestamp with time zone | sim |  |
| `pdf_path` | text | sim |  |
| `pdf_hash` | text | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `updated_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (10)</summary>

- CHECK `obra_contratos_congelado_ck`: `CHECK (((status = 'rascunho'::text) OR ((documento_texto IS NOT NULL) AND (documento_hash IS NOT NULL))))`
- CHECK `obra_contratos_dados_obj`: `CHECK ((jsonb_typeof(dados) = 'object'::text))`
- CHECK `obra_contratos_status_ck`: `CHECK ((status = ANY (ARRAY['rascunho'::text, 'aguardando_cliente'::text, 'assinado'::text, 'recusado'::text, 'cancelado'::text, 'substituido'::text])))`
- CHECK `obra_contratos_texto_max`: `CHECK (((documento_texto IS NULL) OR (char_length(documento_texto) <= 200000)))`
- CHECK `obra_contratos_versao_ck`: `CHECK ((versao >= 1))`
- FK `obra_contratos_obra_id_fkey`: `FOREIGN KEY (obra_id) REFERENCES obras(id) ON DELETE RESTRICT`
- FK `obra_contratos_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- FK `obra_contratos_substituido_por_fkey`: `FOREIGN KEY (substituido_por) REFERENCES obra_contratos(id) DEFERRABLE INITIALLY DEFERRED`
- PK `obra_contratos_pkey`: `PRIMARY KEY (id)`
- UNIQUE `obra_contratos_numero_uk`: `UNIQUE (professional_id, ano, seq, versao)`

</details>

**Policies RLS**

- `obra_contratos_select_own` — SELECT para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`

<details><summary>Triggers (1)</summary>

- `obra_contratos_guard` — `obra_contratos_guard BEFORE UPDATE` → `_oc_guard()`

</details>

<details><summary>Índices extras (8)</summary>

- `CREATE UNIQUE INDEX obra_contratos_um_assinado_por_obra ON public.obra_contratos USING btree (obra_id) WHERE (status = 'assinado'::text)`
- `CREATE INDEX obra_contratos_prof_idx ON public.obra_contratos USING btree (professional_id, updated_at DESC)`
- `CREATE UNIQUE INDEX obra_contratos_um_pendente_por_obra ON public.obra_contratos USING btree (obra_id) WHERE (status = 'aguardando_cliente'::text)`
- `CREATE UNIQUE INDEX obra_contratos_um_rascunho_por_grupo ON public.obra_contratos USING btree (grupo_id) WHERE (status = 'rascunho'::text)`
- `CREATE INDEX obra_contratos_pdf_idx ON public.obra_contratos USING btree (pdf_hash) WHERE (pdf_hash IS NOT NULL)`
- `CREATE UNIQUE INDEX obra_contratos_token_hash_uk ON public.obra_contratos USING btree (token_hash) WHERE (token_hash IS NOT NULL)`
- `CREATE INDEX obra_contratos_obra_idx ON public.obra_contratos USING btree (obra_id, versao DESC)`
- `CREATE INDEX obra_contratos_hash_idx ON public.obra_contratos USING btree (documento_hash) WHERE (documento_hash IS NOT NULL)`

</details>

### `obra_contrato_assinaturas`

- Linhas em produção: **0** · RLS: ligada · grants de tabela: anon `—`, authenticated `S`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `contrato_id` | uuid | não |  |
| `professional_id` | uuid | não |  |
| `parte` | text | não |  |
| `nome` | text | não |  |
| `documento` | text | não |  |
| `metodo` | text | não | `'aceite_eletronico_simples'::text` |
| `aceite_versao` | text | não |  |
| `aceite_texto` | text | não |  |
| `documento_hash` | text | não |  |
| `traco_png` | text | sim |  |
| `ip` | text | sim |  |
| `user_agent` | text | sim |  |
| `assinado_em` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (7)</summary>

- CHECK `obra_assinatura_traco_fmt`: `CHECK (((traco_png IS NULL) OR (traco_png ~~ 'data:image/png;base64,%'::text)))`
- CHECK `obra_assinatura_traco_max`: `CHECK (((traco_png IS NULL) OR (char_length(traco_png) <= 120000)))`
- CHECK `obra_contrato_assinaturas_parte_check`: `CHECK ((parte = ANY (ARRAY['contratada'::text, 'contratante'::text])))`
- FK `obra_contrato_assinaturas_contrato_id_fkey`: `FOREIGN KEY (contrato_id) REFERENCES obra_contratos(id) ON DELETE CASCADE`
- FK `obra_contrato_assinaturas_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `obra_contrato_assinaturas_pkey`: `PRIMARY KEY (id)`
- UNIQUE `obra_assinatura_uma_por_parte`: `UNIQUE (contrato_id, parte)`

</details>

**Policies RLS**

- `obra_assinaturas_select_own` — SELECT para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`

<details><summary>Triggers (1)</summary>

- `obra_assinaturas_no_update` — `obra_assinaturas_no_update BEFORE UPDATE` → `_loc_somente_insercao()`

</details>

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX obra_assinaturas_prof_idx ON public.obra_contrato_assinaturas USING btree (professional_id)`

</details>

### `obra_contrato_eventos`

- Linhas em produção: **1** · RLS: ligada · grants de tabela: anon `—`, authenticated `S`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | bigint | não | `identity` |
| `contrato_id` | uuid | não |  |
| `professional_id` | uuid | não |  |
| `tipo` | text | não |  |
| `ator` | text | não |  |
| `detalhe` | jsonb | não | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (4)</summary>

- CHECK `obra_contrato_eventos_ator_check`: `CHECK ((ator = ANY (ARRAY['contratada'::text, 'contratante'::text, 'sistema'::text])))`
- FK `obra_contrato_eventos_contrato_id_fkey`: `FOREIGN KEY (contrato_id) REFERENCES obra_contratos(id) ON DELETE CASCADE`
- FK `obra_contrato_eventos_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `obra_contrato_eventos_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `obra_eventos_select_own` — SELECT para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`

<details><summary>Triggers (1)</summary>

- `obra_eventos_no_update` — `obra_eventos_no_update BEFORE UPDATE` → `_loc_somente_insercao()`

</details>

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX obra_eventos_contrato_idx ON public.obra_contrato_eventos USING btree (contrato_id, created_at)`

</details>

### `empreiteiros`

- Linhas em produção: **0** · RLS: ligada + FORCE · grants de tabela: anon `— (só R/G/M)`, authenticated `DISU`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `professional_id` | uuid | não |  |
| `nome` | text | não |  |
| `telefone` | text | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (3)</summary>

- FK `empreiteiros_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `empreiteiros_pkey`: `PRIMARY KEY (id)`
- UNIQUE `uq_emp_id_prof`: `UNIQUE (id, professional_id)`

</details>

**Policies RLS**

- `emp_delete` — DELETE para authenticated · USING `((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro))`
- `emp_insert` — INSERT para authenticated · CHECK `((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro))`
- `emp_select` — SELECT para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`
- `emp_update` — UPDATE para authenticated · USING `((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro))` · CHECK `(professional_id = ( SELECT auth.uid() AS uid))`

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX idx_emp_prof ON public.empreiteiros USING btree (professional_id, nome)`

</details>

### `empreitadas`

- Linhas em produção: **0** · RLS: ligada + FORCE · grants de tabela: anon `— (só R/G/M)`, authenticated `DISU`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `professional_id` | uuid | não |  |
| `empreiteiro_id` | uuid | sim |  |
| `descricao` | text | não |  |
| `valor_total` | numeric(12,2) | sim | `0` |
| `status` | text | não | `'ativa'::text` |
| `created_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (6)</summary>

- CHECK `empreitadas_status_check`: `CHECK ((status = ANY (ARRAY['ativa'::text, 'concluida'::text, 'cancelada'::text])))`
- CHECK `empreitadas_valor_total_check`: `CHECK ((valor_total >= (0)::numeric))`
- FK `empreitadas_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- FK `fk_obra_empreiteiro`: `FOREIGN KEY (empreiteiro_id, professional_id) REFERENCES empreiteiros(id, professional_id) ON DELETE SET NULL (empreiteiro_id)`
- PK `empreitadas_pkey`: `PRIMARY KEY (id)`
- UNIQUE `uq_obra_id_prof`: `UNIQUE (id, professional_id)`

</details>

**Policies RLS**

- `obra_delete` — DELETE para authenticated · USING `((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro))`
- `obra_insert` — INSERT para authenticated · CHECK `((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro))`
- `obra_select` — SELECT para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`
- `obra_update` — UPDATE para authenticated · USING `((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro))` · CHECK `(professional_id = ( SELECT auth.uid() AS uid))`

<details><summary>Índices extras (3)</summary>

- `CREATE INDEX idx_obra_prof ON public.empreitadas USING btree (professional_id, created_at DESC)`
- `CREATE INDEX idx_obra_empreiteiro ON public.empreitadas USING btree (empreiteiro_id) WHERE (empreiteiro_id IS NOT NULL)`
- `CREATE INDEX idx_obra_empreiteiro_prof ON public.empreitadas USING btree (empreiteiro_id, professional_id)`

</details>

### `work_entries`

- Linhas em produção: **0** · RLS: ligada + FORCE · grants de tabela: anon `— (só R/G/M)`, authenticated `DISU`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `professional_id` | uuid | não |  |
| `empreitada_id` | uuid | sim |  |
| `empreiteiro_id` | uuid | sim |  |
| `descricao` | text | sim |  |
| `periodo_tipo` | text | sim |  |
| `periodo_numero` | smallint | sim |  |
| `periodo_ano` | smallint | sim |  |
| `valor_executado` | numeric(12,2) | sim |  |
| `valor_total_diaria` | numeric(12,2) | sim |  |
| `status` | text | não | `'pendente'::text` |
| `created_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (11)</summary>

- CHECK `chk_periodo_ano`: `CHECK (((periodo_ano IS NULL) OR ((periodo_ano >= 2020) AND (periodo_ano <= 2100))))`
- CHECK `chk_periodo_completo`: `CHECK (((periodo_numero IS NULL) OR (periodo_tipo IS NOT NULL)))`
- CHECK `chk_periodo_numero`: `CHECK (((periodo_numero IS NULL) OR ((periodo_numero >= 1) AND (periodo_numero <= CASE periodo_tipo WHEN 'dia'::text THEN 31 WHEN 'semana'::text THEN 53 WHEN 'quinzena'::text THEN 24 WHEN 'mes'::text THEN 12 ELSE 366 END))))`
- CHECK `work_entries_periodo_tipo_check`: `CHECK ((periodo_tipo = ANY (ARRAY['dia'::text, 'semana'::text, 'quinzena'::text, 'mes'::text])))`
- CHECK `work_entries_status_check`: `CHECK ((status = ANY (ARRAY['pendente'::text, 'confirmado'::text, 'pago'::text])))`
- CHECK `work_entries_valor_executado_check`: `CHECK ((valor_executado >= (0)::numeric))`
- CHECK `work_entries_valor_total_diaria_check`: `CHECK ((valor_total_diaria >= (0)::numeric))`
- FK `fk_we_empreitada`: `FOREIGN KEY (empreitada_id, professional_id) REFERENCES empreitadas(id, professional_id) ON DELETE CASCADE`
- FK `fk_we_empreiteiro`: `FOREIGN KEY (empreiteiro_id, professional_id) REFERENCES empreiteiros(id, professional_id) ON DELETE SET NULL (empreiteiro_id)`
- FK `work_entries_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `work_entries_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `we_delete` — DELETE para authenticated · USING `((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro))`
- `we_insert` — INSERT para authenticated · CHECK `((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro))`
- `we_select` — SELECT para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`
- `we_update` — UPDATE para authenticated · USING `((professional_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_pro(( SELECT auth.uid() AS uid)) AS is_pro))` · CHECK `(professional_id = ( SELECT auth.uid() AS uid))`

<details><summary>Índices extras (5)</summary>

- `CREATE INDEX idx_we_obra ON public.work_entries USING btree (empreitada_id)`
- `CREATE INDEX idx_we_empreitada_prof ON public.work_entries USING btree (empreitada_id, professional_id)`
- `CREATE INDEX idx_we_empreiteiro ON public.work_entries USING btree (empreiteiro_id) WHERE (empreiteiro_id IS NOT NULL)`
- `CREATE INDEX idx_we_empreiteiro_prof ON public.work_entries USING btree (empreiteiro_id, professional_id)`
- `CREATE INDEX idx_we_prof ON public.work_entries USING btree (professional_id, created_at DESC)`

</details>

### `notificacoes`

- Linhas em produção: **2** · RLS: ligada · grants de tabela: anon `—`, authenticated `S`
- **authenticated só ATUALIZA estas colunas** (grant por coluna): `lida_em`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `professional_id` | uuid | não |  |
| `tipo` | text | não |  |
| `titulo` | text | não |  |
| `mensagem` | text | não |  |
| `link` | text | sim |  |
| `chave` | text | não |  |
| `criada_em` | timestamp with time zone | não | `now()` |
| `lida_em` | timestamp with time zone | sim |  |

<details><summary>Constraints (4)</summary>

- CHECK `notificacoes_tipo_check`: `CHECK ((tipo = ANY (ARRAY['pro_vencendo'::text, 'pro_encerrado'::text, 'sistema'::text, 'studio_resultado'::text])))`
- FK `notificacoes_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `notificacoes_pkey`: `PRIMARY KEY (id)`
- UNIQUE `notificacoes_chave_key`: `UNIQUE (chave)`

</details>

**Policies RLS**

- `notificacoes_marcar_lida` — UPDATE para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`
- `notificacoes_select_own` — SELECT para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX notificacoes_prof_idx ON public.notificacoes USING btree (professional_id, criada_em DESC)`

</details>


## Locação de equipamentos

### `locadoras`

- Linhas em produção: **2** · RLS: ligada + FORCE · grants de tabela: anon `—`, authenticated `DS`
- **anon lê só estas colunas** (grant por coluna): `id`, `nome`, `slug`, `city`, `city_slug`, `uf`, `endereco`, `whatsapp`, `bio`, `logo_url`, `instagram`, `horario`, `entrega`, `raio_entrega_km`, `is_public`, `created_at`, `updated_at`
- **authenticated só ATUALIZA estas colunas** (grant por coluna): `nome`, `razao_social`, `cnpj`, `slug`, `city`, `city_slug`, `uf`, `endereco`, `whatsapp`, `phone`, `email`, `bio`, `logo_url`, `instagram`, `pix_key`, `pix_tipo`, `horario`, `entrega`, `raio_entrega_km`, `is_public`, `updated_at`, `responsavel`
- **authenticated só INSERE estas colunas** (grant por coluna): `id`, `nome`, `razao_social`, `cnpj`, `slug`, `city`, `city_slug`, `uf`, `endereco`, `whatsapp`, `phone`, `email`, `bio`, `logo_url`, `instagram`, `pix_key`, `pix_tipo`, `horario`, `entrega`, `raio_entrega_km`, `is_public`, `created_at`, `updated_at`, `responsavel`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não |  |
| `nome` | text | não |  |
| `razao_social` | text | sim |  |
| `cnpj` | text | sim |  |
| `slug` | text | sim |  |
| `city` | text | sim |  |
| `city_slug` | text | sim |  |
| `uf` | character(2) | sim |  |
| `endereco` | text | sim |  |
| `whatsapp` | text | sim |  |
| `phone` | text | sim |  |
| `email` | text | sim |  |
| `bio` | text | sim |  |
| `logo_url` | text | sim |  |
| `instagram` | text | sim |  |
| `pix_key` | text | sim |  |
| `pix_tipo` | text | sim |  |
| `horario` | jsonb | não | `'{}'::jsonb` |
| `entrega` | boolean | não | `false` |
| `raio_entrega_km` | smallint | sim |  |
| `plan` | text | não | `'free'::text` |
| `plan_expires_at` | timestamp with time zone | sim |  |
| `is_public` | boolean | não | `false` |
| `created_at` | timestamp with time zone | não | `now()` |
| `updated_at` | timestamp with time zone | não | `now()` |
| `responsavel` | text | sim |  |

<details><summary>Constraints (5)</summary>

- CHECK `locadoras_plan_check`: `CHECK ((plan = ANY (ARRAY['free'::text, 'pro'::text])))`
- CHECK `locadoras_responsavel_check`: `CHECK (((responsavel IS NULL) OR (char_length(responsavel) <= 120)))`
- FK `locadoras_id_fkey`: `FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE`
- PK `locadoras_pkey`: `PRIMARY KEY (id)`
- UNIQUE `locadoras_slug_key`: `UNIQUE (slug)`

</details>

**Policies RLS**

- `locadora_insert_self` — INSERT para authenticated · CHECK `(id = ( SELECT auth.uid() AS uid))`
- `locadora_select_own` — SELECT para authenticated · USING `(id = ( SELECT auth.uid() AS uid))`
- `locadora_select_public` — SELECT para anon · USING `is_public`
- `locadora_update_own` — UPDATE para authenticated · USING `(id = ( SELECT auth.uid() AS uid))`

<details><summary>Triggers (2)</summary>

- `trg_locadora` — `trg_locadora BEFORE INSERT OR UPDATE` → `trg_locadoras()`
- `trg_locadora_cidade` — `trg_locadora_cidade BEFORE INSERT OR UPDATE OF city` → `trg_cidade()`

</details>

<details><summary>Índices extras (2)</summary>

- `CREATE INDEX idx_locadora_cidade ON public.locadoras USING btree (city_slug, uf) WHERE (city_slug IS NOT NULL)`
- `CREATE INDEX idx_locadora_pub ON public.locadoras USING btree (is_public) WHERE is_public`

</details>

### `equipamento_categorias`

- Linhas em produção: **10** · RLS: ligada + FORCE · grants de tabela: anon `S`, authenticated `DISU`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `slug` | text | não |  |
| `nome` | text | não |  |
| `nome_plural` | text | sim |  |
| `emoji` | text | sim |  |
| `descricao` | text | sim |  |
| `sinonimos` | text[] | não | `'{}'::text[]` |
| `aprovada` | boolean | não | `false` |
| `ordem` | smallint | não | `100` |
| `created_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (2)</summary>

- PK `equipamento_categorias_pkey`: `PRIMARY KEY (id)`
- UNIQUE `equipamento_categorias_slug_key`: `UNIQUE (slug)`

</details>

**Policies RLS**

- `cat_select_public` — SELECT para anon, authenticated · USING `aprovada`

### `equipamentos`

- Linhas em produção: **4** · RLS: ligada + FORCE · grants de tabela: anon `—`, authenticated `DISU`
- **anon lê só estas colunas** (grant por coluna): `id`, `locadora_id`, `categoria_id`, `nome`, `marca`, `modelo`, `descricao`, `specs`, `fotos`, `preco_dia`, `preco_semana`, `preco_mes`, `caucao`, `quantidade`, `slug`, `ativo`, `is_public`, `created_at`, `updated_at`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `locadora_id` | uuid | não |  |
| `categoria_id` | uuid | não |  |
| `nome` | text | não |  |
| `marca` | text | sim |  |
| `modelo` | text | sim |  |
| `descricao` | text | sim |  |
| `specs` | jsonb | não | `'{}'::jsonb` |
| `fotos` | jsonb | não | `'[]'::jsonb` |
| `preco_dia` | numeric(10,2) | sim |  |
| `preco_semana` | numeric(10,2) | sim |  |
| `preco_mes` | numeric(10,2) | sim |  |
| `caucao` | numeric(10,2) | sim |  |
| `quantidade` | smallint | não | `1` |
| `slug` | text | sim |  |
| `ativo` | boolean | não | `true` |
| `is_public` | boolean | não | `true` |
| `created_at` | timestamp with time zone | não | `now()` |
| `updated_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (9)</summary>

- CHECK `equipamentos_caucao_check`: `CHECK ((caucao >= (0)::numeric))`
- CHECK `equipamentos_preco_dia_check`: `CHECK ((preco_dia >= (0)::numeric))`
- CHECK `equipamentos_preco_mes_check`: `CHECK ((preco_mes >= (0)::numeric))`
- CHECK `equipamentos_preco_semana_check`: `CHECK ((preco_semana >= (0)::numeric))`
- CHECK `equipamentos_quantidade_check`: `CHECK ((quantidade >= 0))`
- FK `equipamentos_categoria_id_fkey`: `FOREIGN KEY (categoria_id) REFERENCES equipamento_categorias(id)`
- FK `equipamentos_locadora_id_fkey`: `FOREIGN KEY (locadora_id) REFERENCES locadoras(id) ON DELETE CASCADE`
- PK `equipamentos_pkey`: `PRIMARY KEY (id)`
- UNIQUE `equipamentos_slug_key`: `UNIQUE (slug)`

</details>

**Policies RLS**

- `equip_delete_own` — DELETE para authenticated · USING `(locadora_id = ( SELECT auth.uid() AS uid))`
- `equip_insert_own` — INSERT para authenticated · CHECK `(locadora_id = ( SELECT auth.uid() AS uid))`
- `equip_select_own` — SELECT para authenticated · USING `(locadora_id = ( SELECT auth.uid() AS uid))`
- `equip_select_public` — SELECT para anon, authenticated · USING `(is_public AND ativo AND (EXISTS ( SELECT 1 FROM locadoras l WHERE ((l.id = equipamentos.locadora_id) AND l.is_public))))`
- `equip_update_own` — UPDATE para authenticated · USING `(locadora_id = ( SELECT auth.uid() AS uid))`

<details><summary>Triggers (2)</summary>

- `trg_equip` — `trg_equip BEFORE INSERT OR UPDATE` → `trg_equipamentos()`
- `trg_equip_pub` — `trg_equip_pub AFTER INSERT OR DELETE OR UPDATE` → `trg_equip_publica()`

</details>

<details><summary>Índices extras (3)</summary>

- `CREATE INDEX idx_equip_locadora ON public.equipamentos USING btree (locadora_id)`
- `CREATE INDEX idx_equip_pub ON public.equipamentos USING btree (is_public, ativo) WHERE (is_public AND ativo)`
- `CREATE INDEX idx_equip_cat ON public.equipamentos USING btree (categoria_id)`

</details>

### `locacoes`

- Linhas em produção: **2** · RLS: ligada + FORCE · grants de tabela: anon `—`, authenticated `DISU`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `locadora_id` | uuid | não |  |
| `client_name` | text | não |  |
| `client_phone` | text | sim |  |
| `client_email` | text | sim |  |
| `client_doc` | text | sim |  |
| `data_saida` | date | não |  |
| `data_prevista_devolucao` | date | não |  |
| `data_devolucao` | date | sim |  |
| `status` | text | não | `'reservada'::text` |
| `valor_total` | numeric(10,2) | sim |  |
| `caucao_valor` | numeric(10,2) | sim |  |
| `caucao_status` | text | não | `'pendente'::text` |
| `entrega_endereco` | text | sim |  |
| `observacoes` | text | sim |  |
| `is_public` | boolean | não | `false` |
| `rating` | smallint | sim |  |
| `rating_comment` | text | sim |  |
| `rating_used` | boolean | não | `false` |
| `rating_token` | text | não | `encode(gen_random_bytes(12), 'hex'::text)` |
| `consulta_token` | text | não | `encode(gen_random_bytes(12), 'hex'::text)` |
| `created_at` | timestamp with time zone | não | `now()` |
| `updated_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (11)</summary>

- CHECK `locacao_datas_ok`: `CHECK ((data_prevista_devolucao >= data_saida))`
- CHECK `locacao_devolucao_ok`: `CHECK (((data_devolucao IS NULL) OR (data_devolucao >= data_saida)))`
- CHECK `locacoes_caucao_status_check`: `CHECK ((caucao_status = ANY (ARRAY['pendente'::text, 'retida'::text, 'devolvida'::text, 'abatida'::text])))`
- CHECK `locacoes_caucao_valor_check`: `CHECK ((caucao_valor >= (0)::numeric))`
- CHECK `locacoes_rating_check`: `CHECK (((rating >= 1) AND (rating <= 5)))`
- CHECK `locacoes_status_check`: `CHECK ((status = ANY (ARRAY['reservada'::text, 'em_andamento'::text, 'atrasada'::text, 'devolvida'::text, 'cancelada'::text])))`
- CHECK `locacoes_valor_total_check`: `CHECK ((valor_total >= (0)::numeric))`
- FK `locacoes_locadora_id_fkey`: `FOREIGN KEY (locadora_id) REFERENCES locadoras(id) ON DELETE CASCADE`
- PK `locacoes_pkey`: `PRIMARY KEY (id)`
- UNIQUE `locacoes_consulta_token_key`: `UNIQUE (consulta_token)`
- UNIQUE `locacoes_rating_token_key`: `UNIQUE (rating_token)`

</details>

**Policies RLS**

- `loc_delete_own` — DELETE para authenticated · USING `(locadora_id = ( SELECT auth.uid() AS uid))`
- `loc_insert_own` — INSERT para authenticated · CHECK `(locadora_id = ( SELECT auth.uid() AS uid))`
- `loc_select_own` — SELECT para authenticated · USING `(locadora_id = ( SELECT auth.uid() AS uid))`
- `loc_update_own` — UPDATE para authenticated · USING `(locadora_id = ( SELECT auth.uid() AS uid))`

<details><summary>Triggers (1)</summary>

- `trg_loc` — `trg_loc BEFORE INSERT OR UPDATE` → `trg_locacoes()`

</details>

<details><summary>Índices extras (5)</summary>

- `CREATE INDEX idx_loc_janela ON public.locacoes USING btree (data_saida, data_prevista_devolucao)`
- `CREATE INDEX idx_loc_status ON public.locacoes USING btree (status)`
- `CREATE INDEX idx_loc_rating_token ON public.locacoes USING btree (rating_token)`
- `CREATE INDEX idx_loc_locadora ON public.locacoes USING btree (locadora_id)`
- `CREATE INDEX idx_loc_consulta_token ON public.locacoes USING btree (consulta_token)`

</details>

### `locacao_itens`

- Linhas em produção: **2** · RLS: ligada + FORCE · grants de tabela: anon `—`, authenticated `DISU`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `locacao_id` | uuid | não |  |
| `equipamento_id` | uuid | não |  |
| `unidade_id` | uuid | sim |  |
| `quantidade` | smallint | não | `1` |
| `preco_dia_aplicado` | numeric(10,2) | sim |  |
| `subtotal` | numeric(10,2) | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (6)</summary>

- CHECK `locacao_itens_preco_dia_aplicado_check`: `CHECK ((preco_dia_aplicado >= (0)::numeric))`
- CHECK `locacao_itens_quantidade_check`: `CHECK ((quantidade > 0))`
- CHECK `locacao_itens_subtotal_check`: `CHECK ((subtotal >= (0)::numeric))`
- FK `locacao_itens_equipamento_id_fkey`: `FOREIGN KEY (equipamento_id) REFERENCES equipamentos(id)`
- FK `locacao_itens_locacao_id_fkey`: `FOREIGN KEY (locacao_id) REFERENCES locacoes(id) ON DELETE CASCADE`
- PK `locacao_itens_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `item_all_own` — ALL para authenticated · USING `(EXISTS ( SELECT 1 FROM locacoes l WHERE ((l.id = locacao_itens.locacao_id) AND (l.locadora_id = ( SELECT auth.uid() AS uid)))))`

<details><summary>Índices extras (2)</summary>

- `CREATE INDEX idx_item_loc ON public.locacao_itens USING btree (locacao_id)`
- `CREATE INDEX idx_item_equip ON public.locacao_itens USING btree (equipamento_id)`

</details>

### `locacao_laudos`

- Linhas em produção: **0** · RLS: ligada + FORCE · grants de tabela: anon `—`, authenticated `DISU`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `locacao_item_id` | uuid | não |  |
| `tipo` | text | não |  |
| `fotos` | jsonb | não | `'[]'::jsonb` |
| `observacoes` | text | sim |  |
| `avarias` | text | sim |  |
| `hash_id` | uuid | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (4)</summary>

- CHECK `locacao_laudos_tipo_check`: `CHECK ((tipo = ANY (ARRAY['saida'::text, 'devolucao'::text])))`
- FK `locacao_laudos_hash_id_fkey`: `FOREIGN KEY (hash_id) REFERENCES document_hashes(id)`
- FK `locacao_laudos_locacao_item_id_fkey`: `FOREIGN KEY (locacao_item_id) REFERENCES locacao_itens(id) ON DELETE CASCADE`
- PK `locacao_laudos_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `laudo_all_own` — ALL para authenticated · USING `(EXISTS ( SELECT 1 FROM (locacao_itens i JOIN locacoes l ON ((l.id = i.locacao_id))) WHERE ((i.id = locacao_laudos.locacao_item_id) AND (l.locadora_id = ( SELECT auth.uid() AS uid)))))`

<details><summary>Índices extras (3)</summary>

- `CREATE UNIQUE INDEX idx_laudo_unico ON public.locacao_laudos USING btree (locacao_item_id, tipo)`
- `CREATE INDEX idx_laudo_hash ON public.locacao_laudos USING btree (hash_id)`
- `CREATE INDEX idx_laudo_item ON public.locacao_laudos USING btree (locacao_item_id)`

</details>

### `locacao_contratos`

- Linhas em produção: **0** · RLS: ligada · grants de tabela: anon `—`, authenticated `S`
- Comentário no banco: _Contratos de locação (v2.0). Conteúdo congelado em texto + SHA-256 no momento da emissão; aceite do cliente com segundo SHA-256. Imutável: só as RPCs emitir/aceitar/cancelar escrevem, e o trigger recusa qualquer alteração fora das transições emitido→aceito|cancelado|substituido e aceito→substituido._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não |  |
| `locadora_id` | uuid | não |  |
| `locacao_id` | uuid | não |  |
| `ano` | smallint | não |  |
| `seq` | integer | não |  |
| `numero` | text | não |  |
| `versao` | smallint | não |  |
| `token` | text | não |  |
| `conteudo` | text | não |  |
| `hash` | text | não |  |
| `hash_id` | uuid | não |  |
| `resumo_economico` | jsonb | não | `'{}'::jsonb` |
| `status` | text | não | `'emitido'::text` |
| `emitido_em` | timestamp with time zone | não |  |
| `aceito_em` | timestamp with time zone | sim |  |
| `aceite_nome` | text | sim |  |
| `aceite_documento` | text | sim |  |
| `aceite_ip` | text | sim |  |
| `aceite_user_agent` | text | sim |  |
| `aceite_registro` | text | sim |  |
| `aceite_hash` | text | sim |  |
| `aceite_hash_id` | uuid | sim |  |
| `cancelado_em` | timestamp with time zone | sim |  |
| `cancelamento_motivo` | text | sim |  |
| `substituido_por` | uuid | sim |  |
| `substituido_em` | timestamp with time zone | sim |  |

<details><summary>Constraints (19)</summary>

- CHECK `locacao_contratos_aceite_ok`: `CHECK ((((aceito_em IS NULL) = (aceite_hash IS NULL)) AND ((aceito_em IS NULL) = (aceite_registro IS NULL)) AND ((status <> 'aceito'::text) OR (aceito_em IS NOT NULL))))`
- CHECK `locacao_contratos_cancel_ok`: `CHECK (((status = 'cancelado'::text) = (cancelado_em IS NOT NULL)))`
- CHECK `locacao_contratos_hash_fmt`: `CHECK ((hash ~ '^[0-9a-f]{64}$'::text))`
- CHECK `locacao_contratos_status_check`: `CHECK ((status = ANY (ARRAY['emitido'::text, 'aceito'::text, 'cancelado'::text, 'substituido'::text])))`
- CHECK `locacao_contratos_subst_ok`: `CHECK (((status = 'substituido'::text) = (substituido_por IS NOT NULL)))`
- CHECK `locacao_contratos_tamanho`: `CHECK ((length(conteudo) <= 400000))`
- FK `locacao_contratos_aceite_hash_id_fkey`: `FOREIGN KEY (aceite_hash_id) REFERENCES document_hashes(id) ON DELETE RESTRICT`
- FK `locacao_contratos_hash_id_fkey`: `FOREIGN KEY (hash_id) REFERENCES document_hashes(id) ON DELETE RESTRICT`
- FK `locacao_contratos_locacao_id_fkey`: `FOREIGN KEY (locacao_id) REFERENCES locacoes(id) ON DELETE RESTRICT`
- FK `locacao_contratos_locadora_id_fkey`: `FOREIGN KEY (locadora_id) REFERENCES locadoras(id) ON DELETE RESTRICT`
- FK `locacao_contratos_substituido_por_fkey`: `FOREIGN KEY (substituido_por) REFERENCES locacao_contratos(id) ON DELETE RESTRICT`
- PK `locacao_contratos_pkey`: `PRIMARY KEY (id)`
- UNIQUE `locacao_contratos_aceite_hash_id_key`: `UNIQUE (aceite_hash_id)`
- UNIQUE `locacao_contratos_aceite_hash_key`: `UNIQUE (aceite_hash)`
- UNIQUE `locacao_contratos_hash_id_key`: `UNIQUE (hash_id)`
- UNIQUE `locacao_contratos_hash_key`: `UNIQUE (hash)`
- UNIQUE `locacao_contratos_numero_uq`: `UNIQUE (locadora_id, ano, seq)`
- UNIQUE `locacao_contratos_token_key`: `UNIQUE (token)`
- UNIQUE `locacao_contratos_versao_uq`: `UNIQUE (locacao_id, versao)`

</details>

**Policies RLS**

- `contrato_select_own` — SELECT para authenticated · USING `(locadora_id = ( SELECT auth.uid() AS uid))`

<details><summary>Triggers (1)</summary>

- `trg_locacao_contratos_imutavel` — `trg_locacao_contratos_imutavel BEFORE DELETE OR UPDATE` → `trg_locacao_contratos_imutavel()`

</details>

<details><summary>Índices extras (2)</summary>

- `CREATE INDEX locacao_contratos_substituido_idx ON public.locacao_contratos USING btree (substituido_por)`
- `CREATE INDEX locacao_contratos_locacao_idx ON public.locacao_contratos USING btree (locacao_id)`

</details>

### `loc_contrato_modelos`

- Linhas em produção: **1** · RLS: ligada · grants de tabela: anon `—`, authenticated `S`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `locadora_id` | uuid | não |  |
| `clausulas` | jsonb | não | `'[]'::jsonb` |
| `condicoes` | jsonb | não | `'{}'::jsonb` |
| `updated_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (4)</summary>

- CHECK `loc_modelo_clausulas_array`: `CHECK ((jsonb_typeof(clausulas) = 'array'::text))`
- CHECK `loc_modelo_condicoes_obj`: `CHECK ((jsonb_typeof(condicoes) = 'object'::text))`
- FK `loc_contrato_modelos_locadora_id_fkey`: `FOREIGN KEY (locadora_id) REFERENCES locadoras(id) ON DELETE CASCADE`
- PK `loc_contrato_modelos_pkey`: `PRIMARY KEY (locadora_id)`

</details>

**Policies RLS**

- `loc_modelos_select_own` — SELECT para authenticated · USING `(locadora_id = auth.uid())`

### `loc_contratos`

- Linhas em produção: **2** · RLS: ligada · grants de tabela: anon `—`, authenticated `S`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `locadora_id` | uuid | não |  |
| `locacao_id` | uuid | não |  |
| `grupo_id` | uuid | não |  |
| `ano` | integer | não |  |
| `seq` | integer | não |  |
| `numero` | text | não |  |
| `versao` | integer | não | `1` |
| `status` | text | não | `'rascunho'::text` |
| `dados` | jsonb | não |  |
| `clausulas` | jsonb | não | `'[]'::jsonb` |
| `origem_hash` | text | sim |  |
| `documento_texto` | text | sim |  |
| `documento_hash` | text | sim |  |
| `token_hash` | text | sim |  |
| `token_expira_em` | timestamp with time zone | sim |  |
| `revogado_em` | timestamp with time zone | sim |  |
| `substituido_por` | uuid | sim |  |
| `enviado_em` | timestamp with time zone | sim |  |
| `concluido_em` | timestamp with time zone | sim |  |
| `pdf_path` | text | sim |  |
| `pdf_hash` | text | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `updated_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (11)</summary>

- CHECK `loc_contratos_clausulas_array`: `CHECK ((jsonb_typeof(clausulas) = 'array'::text))`
- CHECK `loc_contratos_congelado_ck`: `CHECK (((status = 'rascunho'::text) OR ((documento_texto IS NOT NULL) AND (documento_hash IS NOT NULL))))`
- CHECK `loc_contratos_dados_obj`: `CHECK ((jsonb_typeof(dados) = 'object'::text))`
- CHECK `loc_contratos_status_ck`: `CHECK ((status = ANY (ARRAY['rascunho'::text, 'aguardando_cliente'::text, 'aguardando_locadora'::text, 'assinado'::text, 'recusado'::text, 'cancelado'::text, 'substituido'::text])))`
- CHECK `loc_contratos_texto_max`: `CHECK (((documento_texto IS NULL) OR (char_length(documento_texto) <= 300000)))`
- CHECK `loc_contratos_versao_ck`: `CHECK ((versao >= 1))`
- FK `loc_contratos_locacao_id_fkey`: `FOREIGN KEY (locacao_id) REFERENCES locacoes(id) ON DELETE RESTRICT`
- FK `loc_contratos_locadora_id_fkey`: `FOREIGN KEY (locadora_id) REFERENCES locadoras(id) ON DELETE CASCADE`
- FK `loc_contratos_substituido_por_fkey`: `FOREIGN KEY (substituido_por) REFERENCES loc_contratos(id) DEFERRABLE INITIALLY DEFERRED`
- PK `loc_contratos_pkey`: `PRIMARY KEY (id)`
- UNIQUE `loc_contratos_numero_uk`: `UNIQUE (locadora_id, ano, seq, versao)`

</details>

**Policies RLS**

- `loc_contratos_select_own` — SELECT para authenticated · USING `(locadora_id = auth.uid())`

<details><summary>Triggers (1)</summary>

- `loc_contratos_guard` — `loc_contratos_guard BEFORE UPDATE` → `_loc_contratos_guard()`

</details>

<details><summary>Índices extras (7)</summary>

- `CREATE INDEX loc_contratos_locadora_idx ON public.loc_contratos USING btree (locadora_id, updated_at DESC)`
- `CREATE UNIQUE INDEX loc_contratos_um_pendente_por_locacao ON public.loc_contratos USING btree (locacao_id) WHERE (status = ANY (ARRAY['aguardando_cliente'::text, 'aguardando_locadora'::text]))`
- `CREATE UNIQUE INDEX loc_contratos_token_hash_uk ON public.loc_contratos USING btree (token_hash) WHERE (token_hash IS NOT NULL)`
- `CREATE UNIQUE INDEX loc_contratos_um_assinado_por_locacao ON public.loc_contratos USING btree (locacao_id) WHERE (status = 'assinado'::text)`
- `CREATE INDEX loc_contratos_locacao_idx ON public.loc_contratos USING btree (locacao_id)`
- `CREATE INDEX loc_contratos_grupo_idx ON public.loc_contratos USING btree (grupo_id, versao)`
- `CREATE UNIQUE INDEX loc_contratos_um_rascunho_por_grupo ON public.loc_contratos USING btree (grupo_id) WHERE (status = 'rascunho'::text)`

</details>

### `loc_contrato_assinaturas`

- Linhas em produção: **4** · RLS: ligada · grants de tabela: anon `—`, authenticated `S`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `contrato_id` | uuid | não |  |
| `locadora_id` | uuid | não |  |
| `parte` | text | não |  |
| `nome` | text | não |  |
| `documento` | text | não |  |
| `metodo` | text | não | `'aceite_eletronico_simples'::text` |
| `aceite_versao` | text | não |  |
| `aceite_texto` | text | não |  |
| `documento_hash` | text | não |  |
| `traco_png` | text | sim |  |
| `ip` | text | sim |  |
| `user_agent` | text | sim |  |
| `assinado_em` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (7)</summary>

- CHECK `loc_assinatura_traco_fmt`: `CHECK (((traco_png IS NULL) OR (traco_png ~~ 'data:image/png;base64,%'::text)))`
- CHECK `loc_assinatura_traco_max`: `CHECK (((traco_png IS NULL) OR (char_length(traco_png) <= 120000)))`
- CHECK `loc_contrato_assinaturas_parte_check`: `CHECK ((parte = ANY (ARRAY['locadora'::text, 'locatario'::text])))`
- FK `loc_contrato_assinaturas_contrato_id_fkey`: `FOREIGN KEY (contrato_id) REFERENCES loc_contratos(id) ON DELETE CASCADE`
- FK `loc_contrato_assinaturas_locadora_id_fkey`: `FOREIGN KEY (locadora_id) REFERENCES locadoras(id) ON DELETE CASCADE`
- PK `loc_contrato_assinaturas_pkey`: `PRIMARY KEY (id)`
- UNIQUE `loc_assinatura_uma_por_parte`: `UNIQUE (contrato_id, parte)`

</details>

**Policies RLS**

- `loc_assinaturas_select_own` — SELECT para authenticated · USING `(locadora_id = auth.uid())`

<details><summary>Triggers (1)</summary>

- `loc_assinaturas_no_update` — `loc_assinaturas_no_update BEFORE UPDATE` → `_loc_somente_insercao()`

</details>

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX loc_assinaturas_locadora_idx ON public.loc_contrato_assinaturas USING btree (locadora_id)`

</details>

### `loc_contrato_eventos`

- Linhas em produção: **28** · RLS: ligada · grants de tabela: anon `—`, authenticated `S`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | bigint | não | `identity` |
| `contrato_id` | uuid | não |  |
| `locadora_id` | uuid | não |  |
| `tipo` | text | não |  |
| `ator` | text | não |  |
| `detalhe` | jsonb | não | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (4)</summary>

- CHECK `loc_contrato_eventos_ator_check`: `CHECK ((ator = ANY (ARRAY['locadora'::text, 'locatario'::text, 'sistema'::text])))`
- FK `loc_contrato_eventos_contrato_id_fkey`: `FOREIGN KEY (contrato_id) REFERENCES loc_contratos(id) ON DELETE CASCADE`
- FK `loc_contrato_eventos_locadora_id_fkey`: `FOREIGN KEY (locadora_id) REFERENCES locadoras(id) ON DELETE CASCADE`
- PK `loc_contrato_eventos_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `loc_eventos_select_own` — SELECT para authenticated · USING `(locadora_id = auth.uid())`

<details><summary>Triggers (1)</summary>

- `loc_eventos_no_update` — `loc_eventos_no_update BEFORE UPDATE` → `_loc_somente_insercao()`

</details>

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX loc_eventos_contrato_idx ON public.loc_contrato_eventos USING btree (contrato_id, created_at)`

</details>

### `assistant_usage_locadora`

- Linhas em produção: **0** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `locadora_id` | uuid | não |  |
| `month_start` | date | não | `(date_trunc('month'::text, now()))::date` |
| `message_count` | integer | não | `0` |

<details><summary>Constraints (3)</summary>

- CHECK `assistant_usage_locadora_message_count_check`: `CHECK ((message_count >= 0))`
- FK `assistant_usage_locadora_locadora_id_fkey`: `FOREIGN KEY (locadora_id) REFERENCES locadoras(id) ON DELETE CASCADE`
- PK `assistant_usage_locadora_pkey`: `PRIMARY KEY (locadora_id)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).


## Zelo (condomínios) e Gestão

### `condo_sindicos`

- Linhas em produção: **3** · RLS: ligada · grants de tabela: anon `— (só R/G/M)`, authenticated `DISU`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `name` | text | não |  |
| `whatsapp` | text | sim |  |
| `email` | text | sim |  |
| `plan` | text | não | `'free'::text` |
| `plan_expires_at` | timestamp with time zone | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `updated_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (1)</summary>

- PK `condo_sindicos_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `sindico_all_own` — ALL para public · USING `(id = ( SELECT auth.uid() AS uid))`

### `condo_condominios`

- Linhas em produção: **3** · RLS: ligada · grants de tabela: anon `— (só R/G/M)`, authenticated `DISU`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `sindico_id` | uuid | não |  |
| `nome` | text | não |  |
| `endereco` | text | sim |  |
| `city` | text | sim |  |
| `city_slug` | text | sim |  |
| `num_unidades` | integer | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `updated_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (2)</summary>

- FK `condo_condominios_sindico_id_fkey`: `FOREIGN KEY (sindico_id) REFERENCES condo_sindicos(id) ON DELETE CASCADE`
- PK `condo_condominios_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `condominio_all_own` — ALL para public · USING `(sindico_id = ( SELECT auth.uid() AS uid))`

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX idx_condo_condo_sindico ON public.condo_condominios USING btree (sindico_id, created_at DESC)`

</details>

### `condo_manutencoes_recorrentes`

- Linhas em produção: **0** · RLS: ligada · grants de tabela: anon `— (só R/G/M)`, authenticated `DISU`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `condominio_id` | uuid | não |  |
| `tipo` | text | não |  |
| `ultima_execucao` | date | sim |  |
| `proxima_execucao` | date | não |  |
| `frequencia_meses` | integer | não |  |
| `observacoes` | text | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `updated_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (2)</summary>

- FK `condo_manutencoes_recorrentes_condominio_id_fkey`: `FOREIGN KEY (condominio_id) REFERENCES condo_condominios(id) ON DELETE CASCADE`
- PK `condo_manutencoes_recorrentes_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `manutencao_all_own` — ALL para public · USING `(EXISTS ( SELECT 1 FROM condo_condominios c WHERE ((c.id = condo_manutencoes_recorrentes.condominio_id) AND (c.sindico_id = ( SELECT auth.uid() AS uid)))))`

<details><summary>Índices extras (2)</summary>

- `CREATE INDEX idx_condo_manut_proxima ON public.condo_manutencoes_recorrentes USING btree (proxima_execucao)`
- `CREATE INDEX idx_condo_manut_condominio ON public.condo_manutencoes_recorrentes USING btree (condominio_id, proxima_execucao)`

</details>

### `condo_servicos_contratados`

- Linhas em produção: **1** · RLS: ligada · grants de tabela: anon `— (só R/G/M)`, authenticated `DISU`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `condominio_id` | uuid | não |  |
| `report_id` | uuid | sim |  |
| `manutencao_id` | uuid | sim |  |
| `descricao` | text | sim |  |
| `valor` | numeric | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `updated_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (4)</summary>

- FK `condo_servicos_contratados_condominio_id_fkey`: `FOREIGN KEY (condominio_id) REFERENCES condo_condominios(id) ON DELETE CASCADE`
- FK `condo_servicos_contratados_manutencao_id_fkey`: `FOREIGN KEY (manutencao_id) REFERENCES condo_manutencoes_recorrentes(id) ON DELETE SET NULL`
- FK `condo_servicos_contratados_report_id_fkey`: `FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL`
- PK `condo_servicos_contratados_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `servico_all_own` — ALL para public · USING `(EXISTS ( SELECT 1 FROM condo_condominios c WHERE ((c.id = condo_servicos_contratados.condominio_id) AND (c.sindico_id = ( SELECT auth.uid() AS uid)))))`

<details><summary>Índices extras (3)</summary>

- `CREATE INDEX idx_condo_serv_condominio ON public.condo_servicos_contratados USING btree (condominio_id, created_at DESC)`
- `CREATE INDEX idx_condo_serv_manutencao ON public.condo_servicos_contratados USING btree (manutencao_id)`
- `CREATE INDEX idx_condo_serv_report ON public.condo_servicos_contratados USING btree (report_id) WHERE (report_id IS NOT NULL)`

</details>

### `gestao.companies`

- Linhas em produção: **n/d** · RLS: ligada + FORCE · grants de tabela: anon `—`, authenticated `S`
- Comentário no banco: _Empresa cliente do portal (condomínio, administradora, imobiliária)._
- **authenticated só ATUALIZA estas colunas** (grant por coluna): `name`, `type`, `doc`, `city`, `uf`, `phone`, `email`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `name` | text | não |  |
| `type` | text | não | `'condominio'::text` |
| `doc` | text | sim |  |
| `doc_digits` | text | sim | `gerada: regexp_replace(COALESCE(doc, ''::text), '[^0-9]'::text, '':…` |
| `city` | text | sim |  |
| `uf` | text | sim |  |
| `phone` | text | sim |  |
| `email` | text | sim |  |
| `is_active` | boolean | não | `true` |
| `created_by` | uuid | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `updated_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (7)</summary>

- CHECK `companies_doc_chk`: `CHECK (((doc_digits = ''::text) OR (char_length(doc_digits) = ANY (ARRAY[11, 14]))))`
- CHECK `companies_email_chk`: `CHECK (((email IS NULL) OR (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text)))`
- CHECK `companies_name_chk`: `CHECK (((char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 120)))`
- CHECK `companies_type_chk`: `CHECK ((type = ANY (ARRAY['condominio'::text, 'administradora'::text, 'imobiliaria'::text, 'outro'::text])))`
- CHECK `companies_uf_chk`: `CHECK (((uf IS NULL) OR (uf ~ '^[A-Z]{2}$'::text)))`
- FK `companies_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- PK `companies_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `comp_select` — SELECT para authenticated · USING `(id IN ( SELECT private.gestao_company_ids() AS gestao_company_ids))`
- `comp_update` — UPDATE para authenticated · USING `private.gestao_is_admin(id)`

<details><summary>Triggers (1)</summary>

- `trg_gestao_companies_updated` — `trg_gestao_companies_updated BEFORE UPDATE` → `set_updated_at()`

</details>

<details><summary>Índices extras (2)</summary>

- `CREATE INDEX idx_companies_created_by ON gestao.companies USING btree (created_by)`
- `CREATE UNIQUE INDEX companies_doc_uidx ON gestao.companies USING btree (doc_digits) WHERE (doc_digits <> ''::text)`

</details>

### `gestao.company_users`

- Linhas em produção: **n/d** · RLS: ligada + FORCE · grants de tabela: anon `—`, authenticated `S`
- Comentário no banco: _Vínculo usuário↔empresa + papel. NÃO contém credenciais (ver ADR-02)._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `company_id` | uuid | não |  |
| `user_id` | uuid | não |  |
| `role` | text | não | `'member'::text` |
| `full_name` | text | sim |  |
| `is_active` | boolean | não | `true` |
| `invited_by` | uuid | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `updated_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (7)</summary>

- CHECK `company_users_name_chk`: `CHECK (((full_name IS NULL) OR ((char_length(btrim(full_name)) >= 2) AND (char_length(btrim(full_name)) <= 120))))`
- CHECK `company_users_role_chk`: `CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))`
- FK `company_users_company_id_fkey`: `FOREIGN KEY (company_id) REFERENCES gestao.companies(id) ON DELETE CASCADE`
- FK `company_users_invited_by_fkey`: `FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- FK `company_users_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- PK `company_users_pkey`: `PRIMARY KEY (id)`
- UNIQUE `company_users_uniq`: `UNIQUE (company_id, user_id)`

</details>

**Policies RLS**

- `cu_select` — SELECT para authenticated · USING `(company_id IN ( SELECT private.gestao_company_ids() AS gestao_company_ids))`

<details><summary>Triggers (2)</summary>

- `trg_gestao_company_users_updated` — `trg_gestao_company_users_updated BEFORE UPDATE` → `set_updated_at()`
- `trg_gestao_ultimo_owner` — `trg_gestao_ultimo_owner BEFORE DELETE OR UPDATE` → `gestao.tg_protege_ultimo_owner()`

</details>

<details><summary>Índices extras (2)</summary>

- `CREATE INDEX idx_company_users_invited_by ON gestao.company_users USING btree (invited_by)`
- `CREATE INDEX company_users_user_idx ON gestao.company_users USING btree (user_id) WHERE is_active`

</details>


## Cobrança e plano

### `assinaturas`

- Linhas em produção: **3** · RLS: ligada · grants de tabela: anon `—`, authenticated `S`
- Comentário no banco: _Vinculo professional <-> assinatura Asaas. Escrita SO pela Edge Function (service_role); o dono apenas le._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `professional_id` | uuid | não |  |
| `asaas_customer_id` | text | não |  |
| `asaas_subscription_id` | text | sim |  |
| `status` | text | não | `'pendente'::text` |
| `ciclo` | text | não | `'MONTHLY'::text` |
| `valor` | numeric(10,2) | não |  |
| `proxima_cobranca` | date | sim |  |
| `invoice_url` | text | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `updated_at` | timestamp with time zone | não | `now()` |
| `ambiente` | text | sim |  |

<details><summary>Constraints (6)</summary>

- CHECK `assinaturas_ambiente_check`: `CHECK (((ambiente IS NULL) OR (ambiente = ANY (ARRAY['sandbox'::text, 'producao'::text]))))`
- CHECK `assinaturas_ciclo_check`: `CHECK ((ciclo = ANY (ARRAY['MONTHLY'::text, 'YEARLY'::text])))`
- CHECK `assinaturas_status_check`: `CHECK ((status = ANY (ARRAY['pendente'::text, 'ativa'::text, 'atrasada'::text, 'cancelada'::text])))`
- CHECK `assinaturas_valor_check`: `CHECK ((valor > (0)::numeric))`
- FK `assinaturas_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `assinaturas_pkey`: `PRIMARY KEY (professional_id)`

</details>

**Policies RLS**

- `assinatura_select_own` — SELECT para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`

<details><summary>Triggers (1)</summary>

- `trg_assinaturas_updated` — `trg_assinaturas_updated BEFORE UPDATE` → `set_updated_at()`

</details>

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX idx_assinaturas_subscription ON public.assinaturas USING btree (asaas_subscription_id)`

</details>

### `asaas_eventos`

- Linhas em produção: **51** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`
- Comentário no banco: _Eventos ja processados do Asaas. Idempotencia — o Asaas entrega at-least-once._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `event_id` | text | não |  |
| `event_type` | text | sim |  |
| `recebido_em` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (1)</summary>

- PK `asaas_eventos_pkey`: `PRIMARY KEY (event_id)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

### `license_redemptions`

- Linhas em produção: **2** · RLS: ligada + FORCE · grants de tabela: anon `— (só R/G/M)`, authenticated `DISU`
- Comentário no banco: _Resgate de licenças. RLS ligada SEM policy de propósito: invisível para anon e authenticated; apenas a Edge Function (service_role) acessa._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `token_hash` | text | não |  |
| `professional_id` | uuid | não |  |
| `expires_at` | timestamp with time zone | não |  |
| `nome_referencia` | text | sim |  |
| `redeemed_at` | timestamp with time zone | não | `now()` |
| `reactivations` | integer | não | `0` |
| `last_seen_at` | timestamp with time zone | não | `now()` |
| `reseller_ref` | text | sim |  |

<details><summary>Constraints (2)</summary>

- FK `license_redemptions_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `license_redemptions_pkey`: `PRIMARY KEY (token_hash)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX idx_redemp_prof ON public.license_redemptions USING btree (professional_id)`

</details>


## Materiais

### `materiais`

- Linhas em produção: **76** · RLS: ligada · grants de tabela: anon `S`, authenticated `S`
- Comentário no banco: _Catalogo curado de materiais. Leitura publica; escrita so por service_role._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `slug` | text | não |  |
| `nome` | text | não |  |
| `nome_curto` | text | sim |  |
| `categoria` | text | não |  |
| `nicho` | text | não | `'eletrica'::text` |
| `unidade` | text | não | `'un'::text` |
| `sinonimos` | text[] | não | `'{}'::text[]` |
| `atributos` | jsonb | não | `'{}'::jsonb` |
| `preco_referencia` | numeric(10,2) | sim |  |
| `preco_ref_fonte` | text | sim |  |
| `preco_ref_data` | date | sim |  |
| `aprovada` | boolean | não | `true` |
| `ordem` | smallint | não | `0` |
| `created_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (3)</summary>

- CHECK `materiais_preco_referencia_check`: `CHECK (((preco_referencia IS NULL) OR (preco_referencia > (0)::numeric)))`
- PK `materiais_pkey`: `PRIMARY KEY (id)`
- UNIQUE `materiais_slug_key`: `UNIQUE (slug)`

</details>

**Policies RLS**

- `mat_select` — SELECT para anon, authenticated · USING `aprovada`

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX idx_materiais_categoria ON public.materiais USING btree (nicho, categoria, ordem)`

</details>

### `material_listas`

- Linhas em produção: **0** · RLS: ligada · grants de tabela: anon `—`, authenticated `DISU`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `professional_id` | uuid | não |  |
| `titulo` | text | não |  |
| `local` | text | sim |  |
| `budget_id` | uuid | sim |  |
| `status` | text | não | `'rascunho'::text` |
| `observacoes` | text | sim |  |
| `itens` | jsonb | não | `'[]'::jsonb` |
| `estimada_em` | timestamp with time zone | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `updated_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (6)</summary>

- CHECK `material_listas_itens_check`: `CHECK ((jsonb_typeof(itens) = 'array'::text))`
- CHECK `material_listas_status_check`: `CHECK ((status = ANY (ARRAY['rascunho'::text, 'enviada'::text, 'cotada'::text, 'comprada'::text])))`
- FK `fk_lista_budget`: `FOREIGN KEY (budget_id, professional_id) REFERENCES budgets(id, professional_id) ON DELETE SET NULL (budget_id)`
- FK `material_listas_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `material_listas_pkey`: `PRIMARY KEY (id)`
- UNIQUE `uq_lista_prof`: `UNIQUE (id, professional_id)`

</details>

**Policies RLS**

- `lista_own` — ALL para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`

<details><summary>Triggers (1)</summary>

- `trg_material_listas_updated` — `trg_material_listas_updated BEFORE UPDATE` → `set_updated_at()`

</details>

<details><summary>Índices extras (2)</summary>

- `CREATE INDEX idx_listas_prof ON public.material_listas USING btree (professional_id, created_at DESC)`
- `CREATE INDEX idx_lista_budget_prof ON public.material_listas USING btree (budget_id, professional_id)`

</details>

### `material_precos`

- Linhas em produção: **0** · RLS: ligada · grants de tabela: anon `—`, authenticated `DISU`
- Comentário no banco: _Historico de preco POR PROFISSIONAL. E daqui que sai a estimativa. data vem do cliente: current_date no Postgres e UTC e erraria o dia no Brasil._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `professional_id` | uuid | não |  |
| `material_id` | uuid | não |  |
| `loja` | text | sim |  |
| `preco_unit` | numeric(10,2) | não |  |
| `data` | date | não |  |
| `lista_id` | uuid | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (5)</summary>

- CHECK `material_precos_preco_unit_check`: `CHECK ((preco_unit > (0)::numeric))`
- FK `fk_preco_lista`: `FOREIGN KEY (lista_id, professional_id) REFERENCES material_listas(id, professional_id) ON DELETE SET NULL (lista_id)`
- FK `material_precos_material_id_fkey`: `FOREIGN KEY (material_id) REFERENCES materiais(id)`
- FK `material_precos_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `material_precos_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `preco_own` — ALL para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`

<details><summary>Índices extras (3)</summary>

- `CREATE INDEX idx_preco_material ON public.material_precos USING btree (material_id)`
- `CREATE INDEX idx_preco_lista_prof ON public.material_precos USING btree (lista_id, professional_id)`
- `CREATE INDEX idx_precos_estimativa ON public.material_precos USING btree (professional_id, material_id, data DESC)`

</details>


## Studio (vídeo) e mídia

### `studio_videos`

- Linhas em produção: **6** · RLS: ligada · grants de tabela: anon `—`, authenticated `DS`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `professional_id` | uuid | não |  |
| `report_id` | uuid | não |  |
| `codigo` | text | não |  |
| `modelo` | text | não |  |
| `trilha` | text | não |  |
| `roteiro` | jsonb | não |  |
| `marca` | boolean | não | `true` |
| `formato` | text | sim |  |
| `duracao_ms` | integer | sim |  |
| `gerado_em` | timestamp with time zone | sim |  |
| `exportacoes` | integer | não | `0` |
| `compartilhado_em` | timestamp with time zone | sim |  |
| `aviso_1d_em` | timestamp with time zone | sim |  |
| `aviso_7d_em` | timestamp with time zone | sim |  |
| `criado_em` | timestamp with time zone | não | `now()` |
| `atualizado_em` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (9)</summary>

- CHECK `studio_videos_codigo_check`: `CHECK ((codigo ~ '^[a-z0-9]{10}$'::text))`
- CHECK `studio_videos_duracao_ms_check`: `CHECK (((duracao_ms >= 1000) AND (duracao_ms <= 120000)))`
- CHECK `studio_videos_formato_check`: `CHECK ((formato = ANY (ARRAY['mp4'::text, 'webm'::text, 'carrossel'::text])))`
- CHECK `studio_videos_modelo_check`: `CHECK ((modelo = ANY (ARRAY['classico'::text, 'impacto'::text, 'editorial'::text])))`
- CHECK `studio_videos_trilha_check`: `CHECK ((trilha = ANY (ARRAY['leve'::text, 'ritmo'::text, 'calma'::text, 'nenhuma'::text])))`
- FK `studio_videos_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- FK `studio_videos_report_id_fkey`: `FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE`
- PK `studio_videos_pkey`: `PRIMARY KEY (id)`
- UNIQUE `studio_videos_codigo_key`: `UNIQUE (codigo)`

</details>

**Policies RLS**

- `studio_videos_delete_own` — DELETE para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`
- `studio_videos_select_own` — SELECT para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`

<details><summary>Índices extras (2)</summary>

- `CREATE INDEX studio_videos_prof_idx ON public.studio_videos USING btree (professional_id, criado_em DESC)`
- `CREATE INDEX studio_videos_avisos_idx ON public.studio_videos USING btree (gerado_em) WHERE (gerado_em IS NOT NULL)`

</details>

### `midia_cotas`

- Linhas em produção: **2** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `plano` | text | não |  |
| `modulo` | text | não |  |
| `limite_mes` | integer | sim |  |

<details><summary>Constraints (4)</summary>

- CHECK `midia_cotas_limite_mes_check`: `CHECK (((limite_mes IS NULL) OR (limite_mes >= 0)))`
- CHECK `midia_cotas_modulo_check`: `CHECK ((modulo ~ '^[a-z_]{3,40}$'::text))`
- CHECK `midia_cotas_plano_check`: `CHECK ((plano = ANY (ARRAY['free'::text, 'pro'::text])))`
- PK `midia_cotas_pkey`: `PRIMARY KEY (plano, modulo)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

### `midia_uso`

- Linhas em produção: **6** · RLS: ligada · grants de tabela: anon `—`, authenticated `S`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | bigint | não | `identity` |
| `professional_id` | uuid | não |  |
| `modulo` | text | não |  |
| `unidades` | integer | não |  |
| `custo_centavos` | integer | não | `0` |
| `ref` | text | sim |  |
| `criado_em` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (4)</summary>

- CHECK `midia_uso_custo_centavos_check`: `CHECK ((custo_centavos >= 0))`
- CHECK `midia_uso_unidades_check`: `CHECK ((unidades > 0))`
- FK `midia_uso_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `midia_uso_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `midia_uso_select_own` — SELECT para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX midia_uso_prof_idx ON public.midia_uso USING btree (professional_id, modulo, criado_em DESC)`

</details>


## LGPD e Marco Civil

### `aceites`

- Linhas em produção: **8** · RLS: ligada · grants de tabela: anon `—`, authenticated `S`
- Comentário no banco: _v12.36 · LGPD. Registro de aceite de Termos, Política e (se um dia existir) marketing. Só INSERT pela função registrar_aceite. O dono lê os próprios._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `user_id` | uuid | não |  |
| `documento` | text | não |  |
| `versao` | text | não |  |
| `aceito` | boolean | não | `true` |
| `origem` | text | sim |  |
| `ip` | text | sim |  |
| `user_agent` | text | sim |  |
| `criado_em` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (6)</summary>

- CHECK `aceites_documento_check`: `CHECK ((documento = ANY (ARRAY['termos'::text, 'privacidade'::text, 'marketing'::text])))`
- CHECK `aceites_ip_check`: `CHECK (((ip IS NULL) OR (char_length(ip) <= 64)))`
- CHECK `aceites_origem_check`: `CHECK (((origem IS NULL) OR (char_length(origem) <= 60)))`
- CHECK `aceites_user_agent_check`: `CHECK (((user_agent IS NULL) OR (char_length(user_agent) <= 300)))`
- CHECK `aceites_versao_check`: `CHECK (((char_length(versao) >= 1) AND (char_length(versao) <= 20)))`
- PK `aceites_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `aceites_select_own` — SELECT para authenticated · USING `(user_id = ( SELECT auth.uid() AS uid))`

<details><summary>Triggers (1)</summary>

- `trg_aceites_imutavel` — `trg_aceites_imutavel BEFORE DELETE OR UPDATE` → `private.aceites_imutavel()`

</details>

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX idx_aceites_user ON public.aceites USING btree (user_id, documento, criado_em DESC)`

</details>

### `pedidos_titular`

- Linhas em produção: **1** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`
- Comentário no banco: _v12.36 · LGPD art. 18 (acesso, correção, exclusão etc., resposta em 15 dias) e CDC art. 49 (tipo arrependimento: reembolso integral pedido em até 7 dias da contratação). Quem responde é o administrador, pelo SQL Editor ou por um painel com service role._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `numero` | bigint | não | `identity` |
| `user_id` | uuid | sim |  |
| `tipo` | text | não |  |
| `contato` | text | sim |  |
| `detalhe` | text | sim |  |
| `status` | text | não | `'aberto'::text` |
| `ip` | text | sim |  |
| `criado_em` | timestamp with time zone | não | `now()` |
| `prazo_resposta` | timestamp with time zone | não | `(now() + '15 days'::interval)` |
| `respondido_em` | timestamp with time zone | sim |  |
| `resposta` | text | sim |  |

<details><summary>Constraints (6)</summary>

- CHECK `pedidos_titular_contato_check`: `CHECK (((contato IS NULL) OR (char_length(contato) <= 160)))`
- CHECK `pedidos_titular_detalhe_check`: `CHECK (((detalhe IS NULL) OR (char_length(detalhe) <= 2000)))`
- CHECK `pedidos_titular_ip_check`: `CHECK (((ip IS NULL) OR (char_length(ip) <= 64)))`
- CHECK `pedidos_titular_status_check`: `CHECK ((status = ANY (ARRAY['aberto'::text, 'em_andamento'::text, 'concluido'::text, 'recusado'::text])))`
- CHECK `pedidos_titular_tipo_check`: `CHECK ((tipo = ANY (ARRAY['acesso'::text, 'correcao'::text, 'exclusao'::text, 'portabilidade'::text, 'revogacao'::text, 'oposicao'::text, 'informacao'::text, 'arrependimento'::text, 'outro'::text])))`
- PK `pedidos_titular_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `pedidos_select_own` — SELECT para authenticated · USING `(user_id = ( SELECT auth.uid() AS uid))`

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX idx_pedidos_abertos ON public.pedidos_titular USING btree (status, prazo_resposta) WHERE (status = ANY (ARRAY['aberto'::text, 'em_andamento'::text]))`

</details>

### `registros_acesso`

- Linhas em produção: **49** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`
- Comentário no banco: _v12.36 · Marco Civil da Internet, art. 15. Conta, data/hora e IP de uso do app. Guardado por 6 meses. Só a função registrar_acesso escreve; ninguém lê pela API._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | bigint | não | `identity` |
| `user_id` | uuid | não |  |
| `ip` | text | sim |  |
| `ocorrido_em` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (2)</summary>

- CHECK `registros_acesso_ip_check`: `CHECK (((ip IS NULL) OR (char_length(ip) <= 64)))`
- PK `registros_acesso_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

<details><summary>Índices extras (2)</summary>

- `CREATE INDEX idx_reg_acesso_user ON public.registros_acesso USING btree (user_id, ocorrido_em DESC)`
- `CREATE INDEX idx_reg_acesso_data ON public.registros_acesso USING btree (ocorrido_em)`

</details>


## Métricas e aquisição

### `impact_events`

- Linhas em produção: **515** · RLS: ligada · grants de tabela: anon `—`, authenticated `S`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `professional_id` | uuid | não |  |
| `event_type` | text | não |  |
| `source` | text | não | `'organico'::text` |
| `report_id` | uuid | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (4)</summary>

- CHECK `impact_events_event_type_check`: `CHECK ((event_type = ANY (ARRAY['card_generated'::text, 'view'::text, 'whatsapp_click'::text, 'call_click'::text])))`
- FK `impact_events_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- FK `impact_events_report_id_fkey`: `FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL`
- PK `impact_events_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `impact_events_select_owner` — SELECT para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`

<details><summary>Índices extras (3)</summary>

- `CREATE INDEX impact_events_prof_idx ON public.impact_events USING btree (professional_id, created_at DESC)`
- `CREATE INDEX impact_events_prof_source_idx ON public.impact_events USING btree (professional_id, source, event_type)`
- `CREATE INDEX idx_impact_events_report ON public.impact_events USING btree (report_id)`

</details>

### `funnel_events`

- Linhas em produção: **101** · RLS: ligada · grants de tabela: anon `I`, authenticated `I`
- Comentário no banco: _Funil do cadastro (v10.6). Sem PII. form_visto = abriu o formulario; form_enviado = apertou criar perfil. Comparar com professionals criados no mesmo periodo da a taxa de conclusao._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `step` | text | não |  |
| `niche` | text | sim |  |
| `origem` | text | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (3)</summary>

- CHECK `funnel_events_origem_check`: `CHECK (((origem IS NULL) OR (char_length(origem) <= 120)))`
- CHECK `funnel_events_step_check`: `CHECK ((step = ANY (ARRAY['form_visto'::text, 'form_enviado'::text, 'cadastro_concluido'::text])))`
- PK `funnel_events_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `funnel_insert_publico` — INSERT para anon, authenticated · CHECK `true`

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX funnel_events_step_data ON public.funnel_events USING btree (step, created_at DESC)`

</details>

### `analytics_events`

- Linhas em produção: **6268** · RLS: ligada · grants de tabela: anon `I`, authenticated `I`
- Comentário no banco: _Funil de aquisicao site-wide. Insert-only para anon/authenticated; leitura so via Edge Function admin-analytics (service role)._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `event_name` | text | não |  |
| `anonymous_id` | text | sim |  |
| `session_id` | text | sim |  |
| `user_id` | uuid | sim |  |
| `pathname` | text | sim |  |
| `referrer` | text | sim |  |
| `origem` | text | sim |  |
| `device` | text | sim |  |
| `props` | jsonb | não | `'{}'::jsonb` |
| `created_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (8)</summary>

- CHECK `analytics_events_anonymous_id_check`: `CHECK ((char_length(anonymous_id) <= 100))`
- CHECK `analytics_events_device_check`: `CHECK (((device = ANY (ARRAY['mobile'::text, 'tablet'::text, 'desktop'::text])) OR (device IS NULL)))`
- CHECK `analytics_events_event_name_check`: `CHECK (((char_length(event_name) >= 1) AND (char_length(event_name) <= 60)))`
- CHECK `analytics_events_origem_check`: `CHECK ((char_length(origem) <= 120))`
- CHECK `analytics_events_pathname_check`: `CHECK ((char_length(pathname) <= 300))`
- CHECK `analytics_events_referrer_check`: `CHECK ((char_length(referrer) <= 300))`
- CHECK `analytics_events_session_id_check`: `CHECK ((char_length(session_id) <= 100))`
- PK `analytics_events_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS**

- `analytics_insert_publico` — INSERT para anon, authenticated · CHECK `true`

<details><summary>Índices extras (5)</summary>

- `CREATE INDEX analytics_events_anon_idx ON public.analytics_events USING btree (anonymous_id)`
- `CREATE INDEX analytics_events_pathname_idx ON public.analytics_events USING btree (pathname)`
- `CREATE INDEX analytics_events_event_created_idx ON public.analytics_events USING btree (event_name, created_at DESC)`
- `CREATE INDEX analytics_events_session_idx ON public.analytics_events USING btree (session_id)`
- `CREATE INDEX analytics_events_created_idx ON public.analytics_events USING btree (created_at DESC)`

</details>

### `signup_leads`

- Linhas em produção: **11** · RLS: ligada · grants de tabela: anon `D`, authenticated `D`
- Comentário no banco: _Captura de lead durante o cadastro (v7.6) — e-mail de quem começou mas pode não ter terminado. Sem policy de SELECT pública: só leitura via SQL editor / service role._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `email` | text | não |  |
| `niche` | text | sim |  |
| `city` | text | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `origem` | text | sim |  |

<details><summary>Constraints (2)</summary>

- CHECK `signup_leads_origem_tamanho`: `CHECK (((origem IS NULL) OR (char_length(origem) <= 120)))`
- PK `signup_leads_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).


## IA: assistente, MCP, Conselho

### `assistant_usage`

- Linhas em produção: **8** · RLS: ligada · grants de tabela: anon `— (só R/G/M)`, authenticated `DISU`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `professional_id` | uuid | não |  |
| `month_start` | date | não | `(date_trunc('month'::text, now()))::date` |
| `message_count` | integer | não | `0` |

<details><summary>Constraints (2)</summary>

- FK `assistant_usage_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `assistant_usage_pkey`: `PRIMARY KEY (professional_id)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

### `mcp_api_keys`

- Linhas em produção: **5** · RLS: ligada · grants de tabela: anon `— (só R/G/M)`, authenticated `DISU`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `professional_id` | uuid | não |  |
| `name` | text | não | `'Chave MCP'::text` |
| `key_hash` | text | não |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `last_used_at` | timestamp with time zone | sim |  |
| `revoked_at` | timestamp with time zone | sim |  |
| `rl_window_start` | timestamp with time zone | sim |  |
| `rl_count` | integer | não | `0` |

<details><summary>Constraints (3)</summary>

- FK `mcp_api_keys_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `mcp_api_keys_pkey`: `PRIMARY KEY (id)`
- UNIQUE `mcp_api_keys_key_hash_key`: `UNIQUE (key_hash)`

</details>

**Policies RLS**

- `mcp_keys_delete_own` — DELETE para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`
- `mcp_keys_select_own` — SELECT para authenticated · USING `(professional_id = ( SELECT auth.uid() AS uid))`

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX idx_mcp_keys_prof ON public.mcp_api_keys USING btree (professional_id)`

</details>

### `mcp_oauth_rate_limit`

- Linhas em produção: **6** · RLS: ligada · grants de tabela: anon `— (só R/G/M)`, authenticated `DISU`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `professional_id` | uuid | não |  |
| `rl_window_start` | timestamp with time zone | sim |  |
| `rl_count` | integer | não | `0` |

<details><summary>Constraints (2)</summary>

- FK `mcp_oauth_rate_limit_professional_id_fkey`: `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- PK `mcp_oauth_rate_limit_pkey`: `PRIMARY KEY (professional_id)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

### `council_reviews`

- Linhas em produção: **41** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `incident_id` | uuid | sim |  |
| `change_id` | text | sim |  |
| `requested_at` | timestamp with time zone | não | `now()` |
| `finished_at` | timestamp with time zone | sim |  |
| `model` | text | não |  |
| `input_digest` | text | não |  |
| `input_payload` | jsonb | não |  |
| `raw_response` | text | sim |  |
| `status` | text | não | `'pendente'::text` |
| `error` | text | sim |  |
| `tokens_in` | integer | sim |  |
| `tokens_out` | integer | sim |  |
| `is_escalation` | boolean | não | `false` |

<details><summary>Constraints (5)</summary>

- CHECK `council_reviews_alvo_unico`: `CHECK ((NOT ((incident_id IS NOT NULL) AND (change_id IS NOT NULL))))`
- CHECK `council_reviews_status_check`: `CHECK ((status = ANY (ARRAY['pendente'::text, 'concluida'::text, 'falhou'::text, 'recusada'::text])))`
- FK `council_reviews_change_id_fkey`: `FOREIGN KEY (change_id) REFERENCES change_requests(change_id) ON DELETE CASCADE`
- FK `council_reviews_incident_id_fkey`: `FOREIGN KEY (incident_id) REFERENCES integrity_incidents(id) ON DELETE CASCADE`
- PK `council_reviews_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

<details><summary>Índices extras (3)</summary>

- `CREATE INDEX council_reviews_requested_idx ON public.council_reviews USING btree (requested_at DESC)`
- `CREATE INDEX council_reviews_incident_idx ON public.council_reviews USING btree (incident_id)`
- `CREATE INDEX idx_council_reviews_change ON public.council_reviews USING btree (change_id)`

</details>

### `council_opinions`

- Linhas em produção: **18** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `review_id` | uuid | não |  |
| `specialist` | text | não |  |
| `severity` | text | não |  |
| `summary` | text | não |  |
| `reasoning` | text | sim |  |
| `recommended_action` | text | sim |  |
| `confidence` | text | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (5)</summary>

- CHECK `council_opinions_confidence_check`: `CHECK ((confidence = ANY (ARRAY['baixa'::text, 'media'::text, 'alta'::text])))`
- CHECK `council_opinions_severity_check`: `CHECK ((severity = ANY (ARRAY['info'::text, 'atencao'::text, 'grave'::text])))`
- CHECK `council_opinions_specialist_check`: `CHECK ((specialist = ANY (ARRAY['seo'::text, 'seguranca'::text, 'produto'::text, 'arquitetura'::text])))`
- FK `council_opinions_review_id_fkey`: `FOREIGN KEY (review_id) REFERENCES council_reviews(id) ON DELETE CASCADE`
- PK `council_opinions_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX council_opinions_review_idx ON public.council_opinions USING btree (review_id)`

</details>

### `council_budget`

- Linhas em produção: **2** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `month_start` | date | não |  |
| `calls_used` | integer | não | `0` |
| `calls_limit` | integer | não | `50` |

<details><summary>Constraints (1)</summary>

- PK `council_budget_pkey`: `PRIMARY KEY (month_start)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).


## Engenharia interna (integridade, versões, snapshots, admin)

### `integrity_checks`

- Linhas em produção: **6576** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`
- Comentário no banco: _Fase 1 do Integrity Agent: uma linha por URL por execução. Só a Edge Function integrity-check (via service_role) lê/escreve aqui._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `run_id` | uuid | não |  |
| `url` | text | não |  |
| `checked_at` | timestamp with time zone | não | `now()` |
| `http_status` | integer | sim |  |
| `html_bytes` | integer | sim |  |
| `title` | text | sim |  |
| `meta_description` | text | sim |  |
| `h1` | text | sim |  |
| `canonical` | text | sim |  |
| `json_ld_valid` | boolean | sim |  |
| `run_ok` | boolean | não | `true` |
| `error` | text | sim |  |
| `is_baseline` | boolean | não | `false` |
| `is_regression` | boolean | não | `false` |
| `evidence` | jsonb | sim |  |

<details><summary>Constraints (1)</summary>

- PK `integrity_checks_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

<details><summary>Índices extras (3)</summary>

- `CREATE INDEX integrity_checks_run_id_idx ON public.integrity_checks USING btree (run_id)`
- `CREATE INDEX integrity_checks_url_checked_at_idx ON public.integrity_checks USING btree (url, checked_at DESC)`
- `CREATE INDEX integrity_checks_baseline_idx ON public.integrity_checks USING btree (url) WHERE is_baseline`

</details>

### `integrity_incidents`

- Linhas em produção: **33** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`
- Comentário no banco: _Fase 1 do Integrity Agent: um incidente por regressão detectada. Revisão humana marca reviewed=true._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `check_id` | uuid | sim |  |
| `url` | text | não |  |
| `opened_at` | timestamp with time zone | não | `now()` |
| `severity` | text | não | `'regressao'::text` |
| `summary` | text | não |  |
| `evidence` | jsonb | sim |  |
| `reviewed` | boolean | não | `false` |
| `reviewed_at` | timestamp with time zone | sim |  |
| `reviewed_by` | text | sim |  |

<details><summary>Constraints (2)</summary>

- FK `integrity_incidents_check_id_fkey`: `FOREIGN KEY (check_id) REFERENCES integrity_checks(id) ON DELETE SET NULL`
- PK `integrity_incidents_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

<details><summary>Índices extras (3)</summary>

- `CREATE INDEX integrity_incidents_open_idx ON public.integrity_incidents USING btree (reviewed) WHERE (reviewed = false)`
- `CREATE INDEX integrity_incidents_opened_at_idx ON public.integrity_incidents USING btree (opened_at DESC)`
- `CREATE INDEX idx_integrity_incidents_check ON public.integrity_incidents USING btree (check_id)`

</details>

### `change_requests`

- Linhas em produção: **6** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`
- Comentário no banco: _Fase 2 (Version Manager): uma linha por Change ID. approved_by/approved_at só são preenchidos por ação humana explícita — nunca automaticamente._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `change_id` | text | não | `next_change_id()` |
| `opened_at` | timestamp with time zone | não | `now()` |
| `reason` | text | não |  |
| `author` | text | não | `'Engineering Agent (Claude)'::text` |
| `files` | text[] | não | `'{}'::text[]` |
| `status` | text | não | `'draft'::text` |
| `approved_by` | text | sim |  |
| `approved_at` | timestamp with time zone | sim |  |
| `deploy_id` | text | sim |  |
| `post_deploy_status` | text | sim |  |
| `post_deploy_checked_at` | timestamp with time zone | sim |  |

<details><summary>Constraints (2)</summary>

- CHECK `change_requests_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'testando'::text, 'passou'::text, 'falhou'::text, 'aguardando_aprovacao'::text, 'aprovado'::text, 'rejeitado'::text, 'implantado'::text, 'validado_pos_deploy'::text])))`
- PK `change_requests_pkey`: `PRIMARY KEY (change_id)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX change_requests_status_idx ON public.change_requests USING btree (status)`

</details>

### `change_file_versions`

- Linhas em produção: **28** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`
- Comentário no banco: _Fase 2: uma linha por arquivo dentro de um Change ID. hash_before é sempre calculado a partir do arquivo AO VIVO em produção, nunca de cópia local._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `change_id` | text | não |  |
| `file_path` | text | não |  |
| `storage_path_before` | text | sim |  |
| `storage_path_after` | text | sim |  |
| `bytes_before` | integer | sim |  |
| `bytes_after` | integer | sim |  |
| `hash_before` | text | sim |  |
| `hash_after` | text | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (2)</summary>

- FK `change_file_versions_change_id_fkey`: `FOREIGN KEY (change_id) REFERENCES change_requests(change_id) ON DELETE CASCADE`
- PK `change_file_versions_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX change_file_versions_change_id_idx ON public.change_file_versions USING btree (change_id)`

</details>

### `change_tests`

- Linhas em produção: **2** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`
- Comentário no banco: _Fase 2: resultado do Verification Agent por Change ID. Determinístico, sem IA na decisão PASS/FAIL._

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `change_id` | text | não |  |
| `run_at` | timestamp with time zone | não | `now()` |
| `environment` | text | não | `'isolado-local'::text` |
| `checks` | jsonb | sim |  |
| `result` | text | não |  |
| `reasons` | text[] | não | `'{}'::text[]` |

<details><summary>Constraints (3)</summary>

- CHECK `change_tests_result_check`: `CHECK ((result = ANY (ARRAY['PASS'::text, 'FAIL'::text])))`
- FK `change_tests_change_id_fkey`: `FOREIGN KEY (change_id) REFERENCES change_requests(change_id) ON DELETE CASCADE`
- PK `change_tests_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX change_tests_change_id_idx ON public.change_tests USING btree (change_id)`

</details>

### `project_snapshots`

- Linhas em produção: **1** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `snapshot_id` | text | não |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `finished_at` | timestamp with time zone | sim |  |
| `origem` | text | não |  |
| `status` | text | não | `'coletando'::text` |
| `hash_geral` | text | sim |  |
| `total_arquivos` | integer | não | `0` |
| `total_bytes` | bigint | não | `0` |
| `lacunas` | jsonb | não | `'[]'::jsonb` |
| `erro` | text | sim |  |
| `notas` | text | sim |  |

<details><summary>Constraints (2)</summary>

- CHECK `project_snapshots_status_check`: `CHECK ((status = ANY (ARRAY['coletando'::text, 'completo'::text, 'parcial'::text, 'falhou'::text])))`
- PK `project_snapshots_pkey`: `PRIMARY KEY (snapshot_id)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX project_snapshots_created_idx ON public.project_snapshots USING btree (created_at DESC)`

</details>

### `snapshot_files`

- Linhas em produção: **179** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `snapshot_id` | text | não |  |
| `caminho` | text | não |  |
| `origem` | text | não |  |
| `fonte_detalhe` | text | sim |  |
| `bytes` | integer | sim |  |
| `hash` | text | sim |  |
| `storage_path` | text | sim |  |
| `content_type` | text | sim |  |
| `ok` | boolean | não | `true` |
| `erro` | text | sim |  |
| `created_at` | timestamp with time zone | não | `now()` |

<details><summary>Constraints (3)</summary>

- FK `snapshot_files_snapshot_id_fkey`: `FOREIGN KEY (snapshot_id) REFERENCES project_snapshots(snapshot_id) ON DELETE CASCADE`
- PK `snapshot_files_pkey`: `PRIMARY KEY (id)`
- UNIQUE `snapshot_files_snapshot_id_caminho_key`: `UNIQUE (snapshot_id, caminho)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX snapshot_files_snapshot_idx ON public.snapshot_files USING btree (snapshot_id)`

</details>

### `snapshot_changes`

- Linhas em produção: **0** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `snapshot_id` | text | não |  |
| `change_id` | text | não |  |

<details><summary>Constraints (3)</summary>

- FK `snapshot_changes_change_id_fkey`: `FOREIGN KEY (change_id) REFERENCES change_requests(change_id) ON DELETE CASCADE`
- FK `snapshot_changes_snapshot_id_fkey`: `FOREIGN KEY (snapshot_id) REFERENCES project_snapshots(snapshot_id) ON DELETE CASCADE`
- PK `snapshot_changes_pkey`: `PRIMARY KEY (snapshot_id, change_id)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX idx_snapshot_changes_change ON public.snapshot_changes USING btree (change_id)`

</details>

### `snapshot_exports`

- Linhas em produção: **3** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `snapshot_id` | text | não |  |
| `created_at` | timestamp with time zone | não | `now()` |
| `finished_at` | timestamp with time zone | sim |  |
| `formato` | text | não | `'zip'::text` |
| `storage_path` | text | sim |  |
| `hash_original` | text | sim |  |
| `bytes_original` | bigint | sim |  |
| `hash_recuperado` | text | sim |  |
| `bytes_recuperado` | bigint | sim |  |
| `arquivos_conferidos` | integer | não | `0` |
| `arquivos_divergentes` | integer | não | `0` |
| `status` | text | não | `'gerando'::text` |
| `erro` | text | sim |  |

<details><summary>Constraints (3)</summary>

- CHECK `snapshot_exports_status_check`: `CHECK ((status = ANY (ARRAY['gerando'::text, 'verified'::text, 'failed'::text])))`
- FK `snapshot_exports_snapshot_id_fkey`: `FOREIGN KEY (snapshot_id) REFERENCES project_snapshots(snapshot_id) ON DELETE CASCADE`
- PK `snapshot_exports_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX snapshot_exports_snapshot_idx ON public.snapshot_exports USING btree (snapshot_id, created_at DESC)`

</details>

### `admin_auditoria`

- Linhas em produção: **1** · RLS: ligada · grants de tabela: anon `—`, authenticated `—`

| coluna | tipo | nulo | default |
|---|---|---|---|
| `id` | bigint | não | `identity` |
| `quando` | timestamp with time zone | não | `now()` |
| `acao` | text | não |  |
| `alvo` | uuid | não |  |
| `tabela` | text | sim |  |
| `antes` | jsonb | sim |  |
| `depois` | jsonb | sim |  |

<details><summary>Constraints (2)</summary>

- CHECK `admin_auditoria_acao_check`: `CHECK ((acao = ANY (ARRAY['editar'::text, 'login'::text, 'excluir'::text])))`
- PK `admin_auditoria_pkey`: `PRIMARY KEY (id)`

</details>

**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).

<details><summary>Triggers (1)</summary>

- `admin_auditoria_imutavel` — `admin_auditoria_imutavel BEFORE DELETE OR UPDATE` → `_admin_auditoria_so_insercao()`

</details>

<details><summary>Índices extras (1)</summary>

- `CREATE INDEX admin_auditoria_alvo_idx ON public.admin_auditoria USING btree (alvo, quando DESC)`

</details>

