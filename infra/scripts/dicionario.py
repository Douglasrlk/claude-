#!/usr/bin/env python3
"""Gera docs/DICIONARIO_DE_DADOS.md a partir do banco local (réplica do schema de produção).

Uso:  cd infra && python3 scripts/dicionario.py > ../docs/DICIONARIO_DE_DADOS.md
Requer o compose de pé (serviço db) e infra/.env.
"""
import json, os, subprocess, sys

INFRA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Contagem de linhas em produção (list_tables do Supabase, 21/11/2026).
LINHAS_PROD = {
 'professionals':27,'reports':69,'budgets':32,'avaliacoes':12,'document_hashes':77,'empreiteiros':0,'empreitadas':0,
 'work_entries':0,'license_redemptions':2,'locadoras':2,'equipamento_categorias':10,'equipamentos':4,'locacoes':2,
 'locacao_itens':2,'locacao_laudos':0,'signup_leads':11,'condo_sindicos':3,'condo_condominios':3,
 'condo_manutencoes_recorrentes':0,'condo_servicos_contratados':1,'impact_events':515,'assinaturas':3,
 'asaas_eventos':51,'materiais':76,'material_listas':0,'material_precos':0,'funnel_events':101,
 'analytics_events':6268,'mcp_api_keys':5,'mcp_oauth_rate_limit':6,'assistant_usage':8,'integrity_checks':6576,
 'integrity_incidents':33,'change_requests':6,'change_file_versions':28,'change_tests':2,'council_reviews':41,
 'council_opinions':18,'council_budget':2,'project_snapshots':1,'snapshot_files':179,'snapshot_changes':0,
 'snapshot_exports':3,'budget_counters':3,'locacao_contratos':0,'loc_contrato_modelos':1,'loc_contratos':2,
 'loc_contrato_assinaturas':4,'loc_contrato_eventos':28,'obras':3,'professional_slug_antigos':8,
 'assistant_usage_locadora':0,'aceites':8,'pedidos_titular':1,'registros_acesso':49,'notificacoes':2,
 'obra_contratos':1,'obra_contrato_assinaturas':0,'obra_contrato_eventos':1,'admin_auditoria':1,'midia_cotas':2,
 'midia_uso':6,'studio_videos':6,
}

# Agrupamento por domínio, para o leitor não cair numa lista alfabética de 65 tabelas.
DOMINIOS = [
 ('Núcleo: profissional, serviço, orçamento, avaliação', ['professionals','professional_slug_antigos','reports','avaliacoes','budgets','budget_counters','document_hashes','obras','obra_contratos','obra_contrato_assinaturas','obra_contrato_eventos','empreiteiros','empreitadas','work_entries','notificacoes']),
 ('Locação de equipamentos', ['locadoras','equipamento_categorias','equipamentos','locacoes','locacao_itens','locacao_laudos','locacao_contratos','loc_contrato_modelos','loc_contratos','loc_contrato_assinaturas','loc_contrato_eventos','assistant_usage_locadora']),
 ('Zelo (condomínios) e Gestão', ['condo_sindicos','condo_condominios','condo_manutencoes_recorrentes','condo_servicos_contratados','companies','company_users']),
 ('Cobrança e plano', ['assinaturas','asaas_eventos','license_redemptions']),
 ('Materiais', ['materiais','material_listas','material_precos']),
 ('Studio (vídeo) e mídia', ['studio_videos','midia_cotas','midia_uso']),
 ('LGPD e Marco Civil', ['aceites','pedidos_titular','registros_acesso']),
 ('Métricas e aquisição', ['impact_events','funnel_events','analytics_events','signup_leads']),
 ('IA: assistente, MCP, Conselho', ['assistant_usage','mcp_api_keys','mcp_oauth_rate_limit','council_reviews','council_opinions','council_budget']),
 ('Engenharia interna (integridade, versões, snapshots, admin)', ['integrity_checks','integrity_incidents','change_requests','change_file_versions','change_tests','project_snapshots','snapshot_files','snapshot_changes','snapshot_exports','admin_auditoria']),
]

SQL = r"""
with t as (
  select c.oid, n.nspname s, c.relname n, c.relrowsecurity rls, c.relforcerowsecurity frls,
         obj_description(c.oid,'pg_class') comentario
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','gestao') and c.relkind='r')
select json_agg(json_build_object(
  'schema', t.s, 'tabela', t.n, 'rls', t.rls, 'force_rls', t.frls, 'comentario', t.comentario,
  'colunas', (select json_agg(json_build_object('nome',a.attname,'tipo',format_type(a.atttypid,a.atttypmod),
        'nulo', not a.attnotnull, 'default', pg_get_expr(d.adbin,d.adrelid),
        'identity', a.attidentity, 'gerada', a.attgenerated,
        'anon', (select string_agg(distinct x.privilege_type,',') from aclexplode(a.attacl) x where x.grantee='anon'::regrole),
        'auth', (select string_agg(distinct x.privilege_type,',') from aclexplode(a.attacl) x where x.grantee='authenticated'::regrole)) order by a.attnum)
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
     where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped),
  'constraints', (select json_agg(json_build_object('nome',k.conname,'tipo',k.contype,'def',pg_get_constraintdef(k.oid)) order by k.contype, k.conname)
      from pg_constraint k where k.conrelid=t.oid),
  'indices', (select json_agg(pg_get_indexdef(i.indexrelid) order by 1) from pg_index i
      where i.indrelid=t.oid and not exists (select 1 from pg_constraint k where k.conindid=i.indexrelid)),
  'policies', (select json_agg(json_build_object('nome',policyname,'cmd',cmd,'roles',roles,'using',qual,'check',with_check) order by policyname)
      from pg_policies p where p.schemaname=t.s and p.tablename=t.n),
  'grants', (select json_object_agg(r, privs) from (
      select r.rolname r, string_agg(x.privilege_type, ',' order by x.privilege_type) privs
        from aclexplode(coalesce((select relacl from pg_class where oid=t.oid), '{}')) x join pg_roles r on r.oid=x.grantee
       where r.rolname in ('anon','authenticated') group by r.rolname) g),
  'triggers', (select json_agg(pg_get_triggerdef(tg.oid) order by tg.tgname) from pg_trigger tg where tg.tgrelid=t.oid and not tg.tgisinternal)
) order by t.s, t.n) from t;
"""

def consultar():
    env = dict(os.environ)
    for linha in open(os.path.join(INFRA, '.env')):
        if '=' in linha and not linha.startswith('#'):
            k, v = linha.strip().split('=', 1); env[k] = v
    r = subprocess.run(['docker','compose','exec','-T','-e',f"PGPASSWORD={env['POSTGRES_PASSWORD']}",'db',
                        'psql','-h','localhost','-U','postgres','-d','postgres','-At','-c',SQL],
                       cwd=INFRA, capture_output=True, text=True, check=True)
    return json.loads(r.stdout)

PRIV_CURTA = {'SELECT':'S','INSERT':'I','UPDATE':'U','DELETE':'D','TRUNCATE':'T','REFERENCES':'R','TRIGGER':'G','MAINTAIN':'M'}
def privs(s):
    if not s: return '—'
    úteis = [p for p in s.split(',') if p in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE')]
    return ''.join(PRIV_CURTA[p] for p in úteis) or '— (só R/G/M)'

def md(t):
    o = []
    nome = f"{t['schema']}.{t['tabela']}" if t['schema'] != 'public' else t['tabela']
    o.append(f"### `{nome}`\n")
    linhas = LINHAS_PROD.get(t['tabela'])
    rls = ('ligada' + (' + FORCE' if t['force_rls'] else '')) if t['rls'] else '**DESLIGADA**'
    g = t['grants'] or {}
    o.append(f"- Linhas em produção: **{linhas if linhas is not None else 'n/d'}** · RLS: {rls} · "
             f"grants de tabela: anon `{privs(g.get('anon'))}`, authenticated `{privs(g.get('authenticated'))}`")
    if t['comentario']:
        o.append(f"- Comentário no banco: _{' '.join(t['comentario'].split())}_")
    anon_cols = [c['nome'] for c in t['colunas'] if c.get('anon')]
    if anon_cols:
        o.append(f"- **anon lê só estas colunas** (grant por coluna): {', '.join('`'+c+'`' for c in anon_cols)}")
    for priv, rot in (('UPDATE', 'authenticated só ATUALIZA'), ('INSERT', 'authenticated só INSERE')):
        cols = [c['nome'] for c in t['colunas'] if c.get('auth') and priv in c['auth']]
        if cols:
            o.append(f"- **{rot} estas colunas** (grant por coluna): {', '.join('`'+c+'`' for c in cols)}")
    o.append('')
    o.append('| coluna | tipo | nulo | default |')
    o.append('|---|---|---|---|')
    for c in t['colunas']:
        d = c['default'] or ''
        if c['identity']: d = 'identity'
        if c['gerada']: d = f"gerada: {d}"
        d = d.replace('|', '\\|')
        if len(d) > 70: d = d[:67] + '…'
        o.append(f"| `{c['nome']}` | {c['tipo']} | {'sim' if c['nulo'] else 'não'} | {('`'+d+'`') if d else ''} |")
    o.append('')
    cons = t['constraints'] or []
    if cons:
        o.append('<details><summary>Constraints (' + str(len(cons)) + ')</summary>\n')
        for k in cons:
            tipo = {'p':'PK','u':'UNIQUE','c':'CHECK','f':'FK','x':'EXCLUDE'}.get(k['tipo'], k['tipo'])
            o.append(f"- {tipo} `{k['nome']}`: `{' '.join(k['def'].split())}`")
        o.append('\n</details>\n')
    pols = t['policies'] or []
    if pols:
        o.append('**Policies RLS**\n')
        for p in pols:
            roles = ', '.join(p['roles'])
            u = ' '.join((p['using'] or '').split()); w = ' '.join((p['check'] or '').split())
            txt = f"- `{p['nome']}` — {p['cmd']} para {roles}"
            if u: txt += f" · USING `{u}`"
            if w and w != u: txt += f" · CHECK `{w}`"
            o.append(txt)
        o.append('')
    elif t['rls']:
        o.append('**Policies RLS:** nenhuma — invisível pela API para anon/authenticated (acesso só por função `SECURITY DEFINER` ou service role).\n')
    trg = t['triggers'] or []
    if trg:
        o.append('<details><summary>Triggers (' + str(len(trg)) + ')</summary>\n')
        for x in trg:
            o.append(f"- `{' '.join(x.split(' ON ')[0].split()[2:3])}` — `{x.split(' ON ',1)[0].replace('CREATE TRIGGER ','')}` → `{x.split('EXECUTE FUNCTION ')[-1]}`")
        o.append('\n</details>\n')
    idx = t['indices'] or []
    if idx:
        o.append('<details><summary>Índices extras (' + str(len(idx)) + ')</summary>\n')
        for x in idx: o.append(f"- `{x}`")
        o.append('\n</details>\n')
    return '\n'.join(o)

def main():
    tabelas = {t['tabela']: t for t in consultar()}
    print('# Fieldo · Dicionário de dados\n')
    print('Gerado por `infra/scripts/dicionario.py` a partir do banco em contêiner, cujo schema é **idêntico** '
          'ao de produção (verificado por impressão digital — ver `docs/ANALISE.md` §2). '
          'Grants: S=SELECT I=INSERT U=UPDATE D=DELETE T=TRUNCATE.\n')
    vistos = set()
    print('## Índice\n')
    for titulo, nomes in DOMINIOS:
        print(f"- **{titulo}**: " + ', '.join(f"`{n}`" for n in nomes if n in tabelas))
    print()
    for titulo, nomes in DOMINIOS:
        print(f"\n## {titulo}\n")
        for n in nomes:
            if n in tabelas:
                print(md(tabelas[n])); vistos.add(n)
    resto = [n for n in tabelas if n not in vistos]
    if resto:
        print('\n## Outras\n')
        for n in resto: print(md(tabelas[n]))

if __name__ == '__main__':
    main()
