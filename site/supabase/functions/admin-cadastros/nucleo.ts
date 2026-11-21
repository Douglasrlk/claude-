// Fieldo · admin-cadastros · nucleo.ts (v12.40)
//
// Pedido do dono (18/11): "autonomia total aos cadastros" — além de excluir,
// editar tudo. Mesmo portão de sempre: verify_jwt = false e header
// x-admin-key comparado em tempo constante com FIELDO_ADMIN_KEY.
//
// Ações (POST, JSON):
//   listar      { busca? }                       contas, com o que cada uma tem
//   inventario  { id }                           o que será apagado de UMA conta
//   excluir     { id, confirmacao }              apaga (confirmação "EXCLUIR " + 8 do id)
//   detalhe     { id }                           ficha completa + campos editáveis
//   salvar      { id, tabela, alteracoes }       edita professionals ou locadoras
//   conta       { id, email?, phone?, bloquear? } login: e-mail, telefone, bloqueio
//
// Edição sem buraco:
//   · Os campos editáveis vêm do PRÓPRIO banco (information_schema), não da
//     página. Coluna que não existe ou é calculada (id, created_at,
//     updated_at, city_slug) é recusada.
//   · Cada valor é convertido pelo TIPO da coluna no Postgres (texto, número,
//     data, booleano, lista de texto, JSON). Tipo desconhecido = só leitura.
//   · Uma transação por gravação, sem JWT na sessão (sessão de
//     administrador: o gatilho que protege o plano libera, como libera para
//     o webhook de pagamento). Os demais gatilhos rodam normalmente (slug
//     antigo guardado, cidade normalizada, updated_at).
//   · AUDITORIA: toda edição, mudança de login e exclusão grava antes/depois
//     em public.admin_auditoria (migration 2026-11-18_admin_auditoria.sql).
//     Sem a tabela, a ação funciona e a resposta avisa.
//
// Sem Deno aqui: index.ts entrega conexão e chamadas à API de Auth, para o
// mesmo código rodar no teste local com Node + Postgres.

export type Tx = { unsafe: (q: string, p?: unknown[]) => Promise<Record<string, unknown>[]> };
export type Sql = Tx & { begin: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T> };
export type AuthAdmin = (id: string, corpo: Record<string, unknown>) => Promise<{ ok: boolean; status: number; corpo: unknown }>;
export type Ctx = { adminKey?: string; sql?: Sql; authAdmin?: AuthAdmin; apagarArquivos?: (id: string) => Promise<{ apagados: number; falhas: number }>; esperar?: (ms: number) => Promise<void> };

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-admin-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const TABELAS = ['professionals', 'locadoras'] as const;
type Tabela = typeof TABELAS[number];
/* calculados pelo banco: aparecem, mas não se editam */
const SO_LEITURA = new Set(['id', 'created_at', 'updated_at', 'city_slug']);
/* tipo da coluna → expressão de conversão do parâmetro ($n) */
function conversao(tipo: string, n: number): string | null {
  if (tipo === 'text' || /^character( varying)?(\(\d+\))?$/.test(tipo)) return `$${n}::text::${tipo}`;
  if (['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision', 'date', 'timestamp with time zone', 'timestamp without time zone', 'uuid'].includes(tipo) || /^numeric\(\d+,\d+\)$/.test(tipo)) return `$${n}::text::${tipo}`;
  if (tipo === 'boolean') return `$${n}::text::boolean`;
  /* ::text antes de ::jsonb: o driver serializa de novo parâmetro tipado como json */
  if (tipo === 'text[]') return `array(select jsonb_array_elements_text($${n}::text::jsonb))::text[]`;
  if (tipo === 'jsonb' || tipo === 'json') return `$${n}::text::${tipo}`;
  return null;
}

async function campos(sql: Tx, tabela: Tabela) {
  const rows = await sql.unsafe(
    `select a.attname as nome, format_type(a.atttypid, a.atttypmod) as tipo, not a.attnotnull as nulo,
            a.attgenerated <> '' as gerada
       from pg_attribute a
      where a.attrelid = ('public.' || $1)::regclass and a.attnum > 0 and not a.attisdropped
      order by a.attnum`, [tabela]);
  return rows.map((r) => ({
    nome: String(r.nome), tipo: String(r.tipo), nulo: !!r.nulo,
    editavel: !r.gerada && !SO_LEITURA.has(String(r.nome)) && conversao(String(r.tipo), 1) !== null,
  }));
}

async function temAuditoria(sql: Tx): Promise<boolean> {
  const r = await sql.unsafe(`select to_regclass('public.admin_auditoria') is not null as ok`);
  return !!(r[0] && r[0].ok);
}
async function auditar(tx: Tx, acao: string, alvo: string, tabela: string | null, antes: unknown, depois: unknown) {
  if (!(await temAuditoria(tx))) return false;
  await tx.unsafe(
    `insert into public.admin_auditoria (acao, alvo, tabela, antes, depois) values ($1, $2::uuid, $3, $4::text::jsonb, $5::text::jsonb)`,
    [acao, alvo, tabela, JSON.stringify(antes ?? null), JSON.stringify(depois ?? null)]);
  return true;
}

/* ── listar / inventário / excluir: as mesmas consultas da versão anterior ── */
async function listar(sql: Tx, busca: string) {
  const vazio = busca.trim() === '';
  const q = '%' + busca.trim().toLowerCase() + '%';
  return await sql.unsafe(`
    select u.id, u.created_at, u.last_sign_in_at, u.email, u.phone, u.banned_until,
           p.name, p.profissao, p.city, p.slug, p.plan, p.plan_expires_at, p.whatsapp, p.is_public,
           l.nome as locadora_nome, l.slug as locadora_slug, l.plan as locadora_plan,
           (select count(*)::int from reports r where r.professional_id = u.id) as relatorios,
           (select count(*)::int from budgets b where b.professional_id = u.id) as orcamentos,
           (select count(*)::int from equipamentos e where e.locadora_id = u.id) as equipamentos,
           (select count(*)::int from locacoes lc where lc.locadora_id = u.id) as locacoes,
           (select a.status from assinaturas a where a.professional_id = u.id order by a.updated_at desc limit 1) as assinatura
      from auth.users u
      left join professionals p on p.id = u.id
      left join locadoras l on l.id = u.id
     where $1::boolean or lower(coalesce(p.name,'') || ' ' || coalesce(p.profissao,'') || ' ' || coalesce(p.slug,'') || ' ' ||
           coalesce(p.whatsapp,'') || ' ' || coalesce(p.city,'') || ' ' || coalesce(l.nome,'') || ' ' || coalesce(u.email,'') || ' ' ||
           coalesce(u.phone,'') || ' ' || u.id::text) like $2
     order by u.created_at desc
     limit 300`, [vazio, q]);
}

async function inventario(sql: Tx, id: string) {
  const [r] = await sql.unsafe(`
    select
      (select json_build_object('email', email, 'phone', phone, 'criado', created_at, 'ultimo_login', last_sign_in_at) from auth.users where id = $1::uuid) as conta,
      (select json_build_object('nome', name, 'profissao', profissao, 'slug', slug, 'plan', plan, 'is_public', is_public, 'whatsapp', whatsapp, 'city', city) from professionals where id = $1::uuid) as profissional,
      (select json_build_object('nome', nome, 'slug', slug) from locadoras where id = $1::uuid) as locadora,
      (select count(*)::int from reports where professional_id = $1::uuid) as relatorios,
      (select count(*)::int from budgets where professional_id = $1::uuid) as orcamentos,
      (select count(*)::int from avaliacoes where professional_id = $1::uuid) as avaliacoes,
      (select count(*)::int from document_hashes where professional_id = $1::uuid or locadora_id = $1::uuid) as selos,
      (select count(*)::int from equipamentos where locadora_id = $1::uuid) as equipamentos,
      (select count(*)::int from locacoes where locadora_id = $1::uuid) as locacoes,
      ((select count(*) from loc_contratos where locadora_id = $1::uuid and status = 'assinado') +
       (select count(*) from locacao_contratos where locadora_id = $1::uuid and status = 'aceito'))::int as contratos_assinados,
      ((select count(*) from loc_contratos where locadora_id = $1::uuid) +
       (select count(*) from locacao_contratos where locadora_id = $1::uuid))::int as contratos,
      (select status from assinaturas where professional_id = $1::uuid order by updated_at desc limit 1) as assinatura,
      (select count(*)::int from gestao.company_users where user_id = $1::uuid and role = 'owner' and is_active) as empresas_dono,
      (select count(*)::int from storage.objects where bucket_id in ('avatars', 'photos', 'loc-contratos', 'obra-contratos') and name like $2) as arquivos,
      (select count(*)::int from analytics_events where user_id::text = $1::text) as eventos`, [id, id + '/%']);
  return r;
}

async function excluir(sql: Sql, id: string, apagarArquivos?: Ctx['apagarArquivos']) {
  const antes = await inventario(sql, id) as Record<string, any>;
  if (!antes.conta && !antes.profissional && !antes.locadora) return { ok: false, erro: 'nao_encontrado' };
  if (antes.empresas_dono > 0) return { ok: false, erro: 'dono_de_empresa', detalhe: 'Esta conta é a única responsável por uma empresa no módulo de gestão. Transfira a empresa antes.' };

  let auditado = false;
  await sql.begin(async (tx) => {
    await tx.unsafe(`select set_config('request.jwt.claims', '', true)`);  // sessão de administrador: sem JWT
    auditado = await auditar(tx, 'excluir', id, null, antes, null);
    // Locação — na ordem que as chaves estrangeiras exigem
    await tx.unsafe(`delete from loc_contrato_eventos where locadora_id = $1::uuid`, [id]);
    await tx.unsafe(`delete from loc_contrato_assinaturas where locadora_id = $1::uuid`, [id]);
    await tx.unsafe(`delete from loc_contratos where locadora_id = $1::uuid`, [id]);
    await tx.unsafe(`delete from locacao_contratos where locadora_id = $1::uuid`, [id]);
    await tx.unsafe(`delete from document_hashes where locadora_id = $1::uuid or professional_id = $1::uuid`, [id]);
    await tx.unsafe(`delete from locacoes where locadora_id = $1::uuid`, [id]);
    await tx.unsafe(`delete from equipamentos where locadora_id = $1::uuid`, [id]);
    await tx.unsafe(`delete from loc_contrato_modelos where locadora_id = $1::uuid`, [id]);
    await tx.unsafe(`delete from locadoras where id = $1::uuid`, [id]);
    // v12.40 · contrato de obra: obra_id é RESTRICT; eventos/assinaturas vão por cascade
    if ((await tx.unsafe(`select to_regclass('public.obra_contratos') is not null as ok`))[0].ok) {
      await tx.unsafe(`delete from obra_contratos where professional_id = $1::uuid`, [id]);
    }
    // Profissional — relatórios, orçamentos, avaliações etc. saem por ON DELETE CASCADE
    await tx.unsafe(`delete from professionals where id = $1::uuid`, [id]);
    await tx.unsafe(`update analytics_events set user_id = null where user_id::text = $1`, [id]);
    await tx.unsafe(`delete from auth.users where id = $1::uuid`, [id]);
  });

  const arquivos = apagarArquivos ? await apagarArquivos(id) : { apagados: 0, falhas: 0 };
  return {
    ok: true, id, excluido_em: new Date().toISOString(), auditado,
    nome: antes.profissional?.nome || antes.locadora?.nome || null,
    apagado: {
      relatorios: antes.relatorios, orcamentos: antes.orcamentos, avaliacoes: antes.avaliacoes, selos: antes.selos,
      equipamentos: antes.equipamentos, locacoes: antes.locacoes, contratos: antes.contratos,
      arquivos: arquivos.apagados, eventos_anonimizados: antes.eventos,
    },
    arquivos_com_falha: arquivos.falhas,
  };
}

/* ── ficha completa ─────────────────────────────────────────────── */
async function detalhe(sql: Tx, id: string) {
  const [conta] = await sql.unsafe(
    `select id, email, phone, created_at, last_sign_in_at, email_confirmed_at, phone_confirmed_at, banned_until, is_anonymous
       from auth.users where id = $1::uuid`, [id]);
  const [prof] = await sql.unsafe(`select to_jsonb(p) as r from public.professionals p where id = $1::uuid`, [id]);
  const [loc] = await sql.unsafe(`select to_jsonb(l) as r from public.locadoras l where id = $1::uuid`, [id]);
  if (!conta && !prof && !loc) return null;
  const extra = (await sql.unsafe(`
    select
      (select coalesce(json_agg(json_build_object('status', status, 'ciclo', ciclo, 'valor', valor, 'proxima_cobranca', proxima_cobranca, 'ambiente', ambiente)), '[]'::json)
         from assinaturas where professional_id = $1::uuid) as assinaturas,
      (select coalesce(json_agg(json_build_object('expira', expires_at, 'resgatada', redeemed_at, 'revenda', reseller_ref)), '[]'::json)
         from license_redemptions where professional_id = $1::uuid) as licencas`, [id]))[0];
  let auditoria: unknown[] = [];
  if (await temAuditoria(sql)) {
    auditoria = await sql.unsafe(
      `select quando, acao, tabela, antes, depois from public.admin_auditoria where alvo = $1::uuid order by quando desc limit 30`, [id]);
  }
  return {
    conta: conta || null,
    profissional: prof ? prof.r : null,
    locadora: loc ? loc.r : null,
    campos: { professionals: prof ? await campos(sql, 'professionals') : [], locadoras: loc ? await campos(sql, 'locadoras') : [] },
    inventario: await inventario(sql, id),
    assinaturas: extra.assinaturas, licencas: extra.licencas,
    auditoria, auditoria_ativa: await temAuditoria(sql),
  };
}

/* ── edição ─────────────────────────────────────────────────────── */
function paraParametro(tipo: string, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (tipo === 'text[]') {
    const lista = Array.isArray(v) ? v : String(v).split(',');
    return JSON.stringify(lista.map((x) => String(x).trim()).filter((x) => x !== ''));
  }
  if (tipo === 'jsonb' || tipo === 'json') return typeof v === 'string' ? v : JSON.stringify(v);
  if (tipo === 'boolean') return v === true || v === 'true' ? 'true' : 'false';
  const s = String(v);
  return s.trim() === '' ? null : s;
}

async function salvar(sql: Sql, id: string, tabela: string, alteracoes: Record<string, unknown>) {
  if (!(TABELAS as readonly string[]).includes(tabela)) return { ok: false, erro: 'tabela_invalida' };
  const t = tabela as Tabela;
  const meta = await campos(sql, t);
  const porNome = new Map(meta.map((c) => [c.nome, c]));
  const recusados: string[] = [];
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [col, valor] of Object.entries(alteracoes || {})) {
    const c = porNome.get(col);
    if (!c || !c.editavel) { recusados.push(col); continue; }
    const p = paraParametro(c.tipo, valor);
    if (p === null && !c.nulo) { recusados.push(col + ' (não pode ficar vazio)'); continue; }
    params.push(p);
    sets.push(`"${c.nome.replace(/"/g, '""')}" = ` + (p === null ? 'null' : conversao(c.tipo, params.length)));
    if (p === null) params.pop();
  }
  if (recusados.length) return { ok: false, erro: 'campos_recusados', campos: recusados };
  if (!sets.length) return { ok: false, erro: 'nada_para_salvar' };

  params.push(id);
  const nId = params.length;
  let antes: Record<string, unknown> | null = null, depois: Record<string, unknown> | null = null, auditado = false;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`select set_config('request.jwt.claims', '', true)`);
      const a = await tx.unsafe(`select to_jsonb(x) as r from public.${t} x where id = $1::uuid for update`, [id]);
      if (!a.length) throw Object.assign(new Error('nao_encontrado'), { codigo: 'nao_encontrado' });
      antes = a[0].r as Record<string, unknown>;
      const d = await tx.unsafe(`update public.${t} x set ${sets.join(', ')} where id = $${nId}::uuid returning to_jsonb(x) as r`, params);
      depois = d[0].r as Record<string, unknown>;
      const mudou: Record<string, unknown> = {}, era: Record<string, unknown> = {};
      for (const k of Object.keys(depois)) {
        if (JSON.stringify(depois[k]) !== JSON.stringify(antes![k])) { mudou[k] = depois[k]; era[k] = antes![k]; }
      }
      auditado = await auditar(tx, 'editar', id, t, era, mudou);
    });
  } catch (e) {
    const err = e as { codigo?: string; message?: string; detail?: string; column_name?: string };
    if (err.codigo === 'nao_encontrado') return { ok: false, erro: 'nao_encontrado' };
    return { ok: false, erro: 'banco_recusou', mensagem: String(err.message || e).slice(0, 400), detalhe: err.detail ?? null };
  }
  const alterados = Object.keys(depois!).filter((k) => JSON.stringify(depois![k]) !== JSON.stringify(antes![k]));
  return { ok: true, tabela: t, registro: depois, alterados, auditado };
}

/* ── login (auth.users) pela API de Auth ────────────────────────── */
async function conta(sql: Sql, authAdmin: AuthAdmin | undefined, id: string, corpo: Record<string, unknown>) {
  if (!authAdmin) return { ok: false, erro: 'servidor_sem_configuracao' };
  const [antes] = await sql.unsafe(`select email, phone, banned_until from auth.users where id = $1::uuid`, [id]);
  if (!antes) return { ok: false, erro: 'nao_encontrado' };
  const mudar: Record<string, unknown> = {};
  if (typeof corpo.email === 'string') {
    const e = corpo.email.trim().toLowerCase();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, erro: 'email_invalido' };
    mudar.email = e; if (e) mudar.email_confirm = true;
  }
  if (typeof corpo.phone === 'string') {
    const p = corpo.phone.replace(/\D/g, '');
    if (p && (p.length < 10 || p.length > 15)) return { ok: false, erro: 'telefone_invalido' };
    mudar.phone = p; if (p) mudar.phone_confirm = true;
  }
  if (typeof corpo.bloquear === 'boolean') mudar.ban_duration = corpo.bloquear ? '876000h' : 'none';
  if (!Object.keys(mudar).length) return { ok: false, erro: 'nada_para_salvar' };

  const r = await authAdmin(id, mudar);
  if (!r.ok) return { ok: false, erro: 'auth_recusou', status: r.status, mensagem: JSON.stringify(r.corpo).slice(0, 300) };
  const [depois] = await sql.unsafe(`select email, phone, banned_until from auth.users where id = $1::uuid`, [id]);
  let auditado = false;
  await sql.begin(async (tx) => { auditado = await auditar(tx, 'login', id, 'auth.users', antes, depois); });
  return { ok: true, conta: depois, auditado };
}

/* ── roteador ───────────────────────────────────────────────────── */
export async function tratar(req: Request, ctx: Ctx): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!ctx.adminKey || !ctx.sql) return json({ error: 'server_misconfigured' }, 500);
  if (!safeEqual(req.headers.get('x-admin-key') ?? '', ctx.adminKey)) {
    await (ctx.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(700);
    return json({ error: 'forbidden' }, 403);
  }
  let corpo: Record<string, unknown> = {};
  try { corpo = await req.json(); } catch { return json({ error: 'json_invalido' }, 400); }
  const acao = String(corpo.acao || '');
  const id = String(corpo.id || '').toLowerCase();
  const sql = ctx.sql;

  try {
    if (acao === 'listar') return json({ contas: await listar(sql, String(corpo.busca || '').slice(0, 80)) });
    if (!UUID.test(id)) return json({ error: 'id_invalido' }, 400);
    if (acao === 'inventario') return json(await inventario(sql, id));
    if (acao === 'detalhe') {
      const d = await detalhe(sql, id);
      return d ? json(d) : json({ error: 'nao_encontrado' }, 404);
    }
    if (acao === 'salvar') {
      const r = await salvar(sql, id, String(corpo.tabela || ''), (corpo.alteracoes || {}) as Record<string, unknown>);
      return json(r, r.ok ? 200 : 400);
    }
    if (acao === 'conta') {
      const r = await conta(sql, ctx.authAdmin, id, corpo);
      return json(r, r.ok ? 200 : 400);
    }
    if (acao === 'excluir') {
      const esperado = 'EXCLUIR ' + id.slice(0, 8);
      if (String(corpo.confirmacao || '').trim().toUpperCase() !== esperado.toUpperCase()) {
        return json({ error: 'confirmacao_incorreta', esperado }, 400);
      }
      const r = await excluir(sql, id, ctx.apagarArquivos);
      if (r.ok) console.log('[admin-cadastros] EXCLUSAO', JSON.stringify(r));
      return json(r, r.ok ? 200 : 409);
    }
    return json({ error: 'acao_desconhecida' }, 400);
  } catch (e) {
    console.error('[admin-cadastros]', e);
    return json({ error: 'server_error', detalhe: String(e).slice(0, 300) }, 500);
  }
}
