// Fieldo · admin-migracoes · nucleo.ts (v12.40)
//
// Pedido do dono (18/11): um painel para ele mesmo aplicar o SQL no banco,
// sem depender do SQL Editor. Desenho para isso não virar uma porta aberta:
//
//   1. LISTA FECHADA. Só roda SQL cujo SHA-256 está em lista.ts — as
//      migrations revisadas da v12.40. Qualquer outro texto é recusado,
//      mesmo com a chave certa. Não existe "executar SQL livre".
//   2. CHAVE DE ADMIN. Header x-admin-key comparado em tempo constante com
//      FIELDO_ADMIN_KEY (o mesmo dos painéis admin-*). Chave errada: 403,
//      com atraso, e mais nada.
//   3. TRANSAÇÃO. Cada migration roda inteira ou não roda (begin/commit).
//      Registro em supabase_migrations.schema_migrations, como o
//      apply_migration faz, para aparecer no histórico do Supabase.
//   4. DESTRUTIVA PEDE CONFIRMAÇÃO DIGITADA. A remoção do backup exige o
//      campo confirmar = "APAGAR BACKUP".
//   5. STATUS POR SONDAGEM. "Já aplicada" vem de consulta de leitura ao
//      próprio banco (a tabela existe? a função existe?), não de memória.
//
// Este arquivo não usa nada do Deno: o index.ts entrega a conexão e a
// chave. Assim o mesmo código roda no teste local com Node + Postgres.

import { MIGRACOES, type Migracao } from './lista.ts';

export type Sql = {
  unsafe: (q: string) => Promise<unknown[]>;
  begin: <T>(fn: (tx: { unsafe: (q: string, p?: unknown[]) => Promise<unknown[]> }) => Promise<T>) => Promise<T>;
};

export const CONFIRMACAO_DESTRUTIVA = 'APAGAR BACKUP';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-admin-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* sondagens de leitura: true = o efeito da migration já está no banco */
const SONDAS: Record<string, string> = {
  backup_v10_5: `select not exists (select 1 from pg_namespace where nspname = 'backup_v10_5') as ok`,
  pro_vencimento_avisos: `select to_regclass('public.notificacoes') is not null
                            and to_regprocedure('public.plano_ciclo_diario()') is not null as ok`,
  pro_concedido_prazo: `select not exists (select 1 from public.professionals
                          where id in ('d58edadf-d451-4694-bb9f-4b313e588231','3d129e17-91fa-41ec-be39-2c3708615b8e')
                            and plan = 'pro' and plan_expires_at is null) as ok`,
  loc_search_path: `select not exists (select 1 from pg_proc p
                      where p.pronamespace = 'public'::regnamespace and p.proname like '\\_loc\\_%'
                        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) as ok`,
  inteligencia_comercial: `select to_regprocedure('public.minhas_metricas(integer)') is not null as ok`,
  verificar_pdf: `select to_regprocedure('public.verificar_pdf(text)') is not null as ok`,
  obra_contratos: `select to_regclass('public.obra_contratos') is not null as ok`,
  admin_auditoria: `select to_regclass('public.admin_auditoria') is not null as ok`,
  fieldo_studio: `select to_regclass('public.studio_videos') is not null
                    and to_regprocedure('public.studio_exportar(uuid,text,integer)') is not null
                    and to_regprocedure('private.midia_reservar(uuid,text,integer,text,integer)') is not null as ok`,
  locacao_precos_periodo: `select exists (select 1 from information_schema.columns
                              where table_schema = 'public' and table_name = 'equipamentos' and column_name = 'preco_quinzena')
                           and exists (select 1 from information_schema.columns
                              where table_schema = 'public' and table_name = 'locacao_itens' and column_name = 'cobranca') as ok`,
};

async function sondar(sql: Sql, m: Migracao): Promise<boolean | null> {
  try {
    const r = await sql.unsafe(SONDAS[m.id]) as Array<{ ok: boolean }>;
    return !!(r[0] && r[0].ok);
  } catch {
    return null;            /* não deu para saber (ex.: tabela da sonda ainda não existe) */
  }
}

async function status(sql: Sql) {
  const itens = [];
  for (const m of MIGRACOES) {
    itens.push({ id: m.id, ordem: m.ordem, nome: m.nome, arquivo: m.arquivo, destrutiva: m.destrutiva, sha256: m.sha256, aplicada: await sondar(sql, m) });
  }
  return itens;
}

export async function tratar(req: Request, ctx: { adminKey?: string; sql?: Sql; esperar?: (ms: number) => Promise<void> }): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!ctx.adminKey || !ctx.sql) return json({ error: 'servidor_sem_configuracao' }, 500);

  if (!safeEqual(req.headers.get('x-admin-key') ?? '', ctx.adminKey)) {
    await (ctx.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(700);
    return json({ error: 'forbidden' }, 403);
  }
  const sql = ctx.sql;

  if (req.method === 'GET') return json({ ok: true, migracoes: await status(sql) });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let corpo: { id?: string; sql?: string; confirmar?: string };
  try { corpo = await req.json(); } catch { return json({ error: 'corpo_invalido' }, 400); }

  const m = MIGRACOES.find((x) => x.id === corpo.id);
  if (!m) return json({ error: 'migracao_desconhecida' }, 400);
  if (typeof corpo.sql !== 'string' || !corpo.sql) return json({ error: 'sql_ausente' }, 400);

  /* lista fechada: o texto tem de ser exatamente o arquivo revisado */
  const h = await sha256Hex(corpo.sql);
  if (h !== m.sha256) return json({ error: 'sql_nao_confere', esperado: m.sha256, recebido: h }, 400);

  if (m.destrutiva && corpo.confirmar !== CONFIRMACAO_DESTRUTIVA) {
    return json({ error: 'confirmacao_necessaria', digite: CONFIRMACAO_DESTRUTIVA }, 400);
  }

  if (await sondar(sql, m) === true) return json({ ok: true, ja_aplicada: true, id: m.id });

  const inicio = Date.now();
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(corpo.sql!);
      /* histórico do Supabase (existe lá; num Postgres comum, pula) */
      const temHistorico = await tx.unsafe(`select to_regclass('supabase_migrations.schema_migrations') is not null as ok`) as Array<{ ok: boolean }>;
      if (temHistorico[0] && temHistorico[0].ok) {
        await tx.unsafe(
          `insert into supabase_migrations.schema_migrations (version, name, statements, created_by)
           values (to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'), $1, array[$2::text], 'painel-fieldo')`,
          [m.arquivo.replace(/\.sql$/, ''), corpo.sql!],
        );
      }
    });
  } catch (e) {
    const err = e as { message?: string; detail?: string; hint?: string; position?: string };
    return json({ ok: false, error: 'falhou', id: m.id, mensagem: String(err.message || e).slice(0, 800),
                  detalhe: err.detail ?? null, dica: err.hint ?? null, nada_foi_alterado: true }, 500);
  }

  return json({ ok: true, id: m.id, aplicada: await sondar(sql, m), ms: Date.now() - inicio });
}
