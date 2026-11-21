// Fieldo · Edge Function "admin-migracoes" (v12.40)
//
// Painel do dono para aplicar as migrations revisadas da v12.40 direto no
// banco. Toda a regra está em nucleo.ts (lista fechada por SHA-256, chave
// de admin, transação, confirmação digitada para o que apaga dados).
// Aqui só a ligação com o Deno: chave e conexão direta ao Postgres.
//
// verify_jwt = false: a autorização é o x-admin-key (como admin-engenharia).
// SUPABASE_DB_URL é injetada pelo Supabase em toda Edge Function.

import postgres from 'npm:postgres@3.4.5';
import { tratar, type Sql } from './nucleo.ts';

const ADMIN_KEY = Deno.env.get('FIELDO_ADMIN_KEY');
const DB_URL = Deno.env.get('SUPABASE_DB_URL');

let _sql: Sql | undefined;
function conexao(): Sql | undefined {
  if (!DB_URL) return undefined;
  if (!_sql) {
    _sql = postgres(DB_URL, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 15,
                              connection: { statement_timeout: 120000 } }) as unknown as Sql;
  }
  return _sql;
}

Deno.serve((req) => tratar(req, { adminKey: ADMIN_KEY, sql: conexao() }));
