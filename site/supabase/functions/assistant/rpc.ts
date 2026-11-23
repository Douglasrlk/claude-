// Fieldo · supabase/functions/mcp/rpc.ts (cópia junto do assistant)
//
// Fase 2 do MCP (ver MCP-fieldo-auditoria.md, seção "Status da
// implementação"). Única coisa neste arquivo: chamar as funções SQL
// `mcp_*` do banco (supabase/migrations/2026-09-09_mcp_api_keys.sql)
// via PostgREST, sempre com a ANON KEY — nunca com a service role key.
//
// v12.18: copiado para dentro da pasta do assistant (era importado de
// '../mcp/rpc.ts'), para a function ser publicada sozinha. O conteúdo é
// o mesmo do mcp/rpc.ts.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const REST_URL = SUPABASE_URL + '/rest/v1/rpc/';

export class RpcError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'RpcError';
    this.status = status;
  }
}

/* Chama uma função pública `mcp_*`/`_mcp_resolve_key` via
   /rest/v1/rpc/<nome>. `authOverride` = JWT do profissional, para o
   PostgREST autenticar como ele (auth.uid() funciona nas funções SQL). */
export async function callRpc(fn: string, args: Record<string, unknown>, authOverride?: string): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(REST_URL + fn, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: 'Bearer ' + (authOverride || ANON_KEY),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text || ('HTTP ' + res.status);
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.message === 'string') msg = parsed.message;
      } catch { /* corpo não era JSON — usa o texto cru mesmo */ }
      throw new RpcError(msg, res.status);
    }
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(t);
  }
}
