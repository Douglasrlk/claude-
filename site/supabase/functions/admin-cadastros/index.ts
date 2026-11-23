// Fieldo · Edge Function "admin-cadastros" (v12.40) — autonomia total sobre
// os cadastros: listar, ver a ficha, EDITAR qualquer campo do perfil e da
// locadora, mudar e-mail/telefone do login, bloquear acesso e excluir.
// Toda a regra está em nucleo.ts; aqui só a ligação com o Deno.
//
// Por que conexão direta ao Postgres (SUPABASE_DB_URL) e não a API REST:
// as travas do banco que impedem um USUÁRIO de mexer em plano, contrato
// assinado e selo liberam só quando não há JWT na sessão — a sessão de
// administrador. A REST sempre carrega JWT, até com a service role.
// E-mail, telefone e bloqueio do login vão pela API de Auth (service role),
// que é o caminho que o Supabase suporta para auth.users.

import postgres from 'npm:postgres@3.4.4';
import { tratar, type Sql } from './nucleo.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADMIN_KEY = Deno.env.get('FIELDO_ADMIN_KEY');
const DB_URL = Deno.env.get('SUPABASE_DB_URL');
const BUCKETS = ['avatars', 'photos', 'loc-contratos', 'obra-contratos'];

const sql = DB_URL ? postgres(DB_URL, { max: 1, prepare: false, idle_timeout: 20 }) as unknown as Sql : undefined;

async function authAdmin(id: string, corpo: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'PUT',
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return { ok: r.ok, status: r.status, corpo: await r.json().catch(() => null) };
}

async function apagarArquivos(id: string): Promise<{ apagados: number; falhas: number }> {
  let apagados = 0, falhas = 0;
  for (const bucket of BUCKETS) {
    const nomes = (await sql!.unsafe(`select name from storage.objects where bucket_id = $1 and name like $2`, [bucket, id + '/%']))
      .map((r) => String(r.name));
    for (let i = 0; i < nomes.length; i += 100) {
      const lote = nomes.slice(i, i + 100);
      const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: lote }),
      });
      if (resp.ok) apagados += lote.length;
      else { falhas += lote.length; console.error('[admin-cadastros] storage', bucket, resp.status, await resp.text()); }
    }
  }
  return { apagados, falhas };
}

Deno.serve((req) => tratar(req, {
  adminKey: SUPABASE_URL && SERVICE_KEY ? ADMIN_KEY : undefined,
  sql, authAdmin, apagarArquivos,
}));
