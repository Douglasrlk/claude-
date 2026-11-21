// Fieldo · services/supabaseRest.ts
//
// Fase 1 do plano do MCP (ver MCP-fieldo-auditoria.md) — camada de serviço
// nova, TypeScript puro, sem DOM/localStorage/IndexedDB. Este arquivo é a
// única coisa que fala HTTP com o PostgREST do Supabase; reportService.ts,
// profileService.ts e usageService.ts chamam ele, nunca fazem fetch direto.
// Isso existe pra não duplicar a lógica de headers/timeout/erro em três
// lugares diferentes (Riscos, item 1 da auditoria: duplicar regra de
// negócio é o maior risco arquitetural deste trabalho).
//
// IMPORTANTE: nada aqui é chamado por ninguém ainda. db.js e o PWA
// continuam exatamente como estavam — este é só o primeiro tijolo,
// conforme combinado (Fase 1 = só criação de arquivo novo).
//
// Espelha o padrão de _headers/_req em db.js (linhas ~230-290), removendo
// só o que é específico do navegador:
//   - sem retry automático em 401 com Session.refresh() — no MCP, quem
//     resolve/renova o JWT do profissional é a camada de autenticação do
//     Fase 2 (auth.ts), antes de chamar o serviço. O serviço aqui recebe
//     sempre um JWT já válido.
//   - sem opts.anon — os serviços do MCP autenticado sempre recebem um
//     JWT de profissional; a única tool pública (get_public_profile) usa
//     a mesma anon key, mas isso é decisão da Fase 4, não deste arquivo.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ||
  'https://jrsctnncoljdcvdofxsg.supabase.co';

// Mesma anon key que já é pública hoje — ela vai embutida em todo HTML do
// PWA (db.js, linha ~174) e é a chave de LEITURA pública do Supabase; não
// é segredo. Ainda assim lemos de env var primeiro, com esse valor só como
// fallback, para o dia em que o projeto trocar de chave sem precisar mexer
// em código.
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impyc2N0bm5jb2xqZGN2ZG9meHNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTEzMzgsImV4cCI6MjA5MDc4NzMzOH0.XJj5d37fOgK4nN9B3xI_x7P1HE_4lvnYC_qx_5eF0FI';

const REST_URL = SUPABASE_URL + '/rest/v1';

export class SupabaseRestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SupabaseRestError';
    this.status = status;
  }
}

export type RestOptions = {
  prefer?: string;
  timeoutMs?: number;
};

function headersFor(professionalJwt: string | null, prefer?: string): Record<string, string> {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: 'Bearer ' + (professionalJwt || SUPABASE_ANON_KEY),
    'Content-Type': 'application/json',
    Prefer: prefer || 'return=representation',
  };
}

async function withTimeout<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(t);
  }
}

/* Chamada genérica ao PostgREST. professionalJwt = null usa a anon key
   (equivalente a opts.anon do db.js) — hoje isso só é usado internamente
   por quem tiver motivo explícito; os serviços de report/profile/usage
   sempre passam um JWT de verdade. */
export async function restFetch(
  method: string,
  path: string,
  professionalJwt: string | null,
  body?: unknown,
  opts: RestOptions = {},
): Promise<unknown> {
  return withTimeout(opts.timeoutMs || 15000, async (signal) => {
    const res = await fetch(REST_URL + path, {
      method,
      headers: headersFor(professionalJwt, opts.prefer),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new SupabaseRestError(text || ('HTTP ' + res.status), res.status);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  });
}

export function get(path: string, professionalJwt: string | null, opts?: RestOptions): Promise<unknown> {
  return restFetch('GET', path, professionalJwt, undefined, opts);
}

export function post(path: string, professionalJwt: string | null, body: unknown, opts?: RestOptions): Promise<unknown> {
  return restFetch('POST', path, professionalJwt, body, opts);
}

/* Conta linhas sem baixar o conteúdo — usa Prefer: count=exact + um Range
   de uma linha só, e lê o total do header Content-Range (formato
   "0-0/123"). Existe pra usageService não precisar baixar todos os
   relatórios do mês só pra saber quantos são. */
export async function countRows(path: string, professionalJwt: string | null, opts: RestOptions = {}): Promise<number> {
  return withTimeout(opts.timeoutMs || 15000, async (signal) => {
    const headers = headersFor(professionalJwt, 'count=exact');
    headers['Range'] = '0-0';
    const res = await fetch(REST_URL + path, { method: 'GET', headers, signal });
    if (!res.ok && res.status !== 206) {
      const text = await res.text().catch(() => '');
      throw new SupabaseRestError(text || ('HTTP ' + res.status), res.status);
    }
    const range = res.headers.get('content-range'); // ex: "0-0/123"
    if (!range) return 0;
    const total = range.split('/')[1];
    if (!total || total === '*') return 0;
    return parseInt(total, 10) || 0;
  });
}
