// Fieldo · Edge Function "admin-engenharia" — a janela para as Fases 1, 2 e 3.
//
// Irmã da admin-analytics (mesmo portão, mesmo espírito). A admin-analytics
// responde "por que não estamos crescendo"; esta responde "o site está de pé,
// e o que a engenharia andou fazendo".
//
// GET  → leitura de tudo (como sempre foi).
// POST → v1.1 (29/10, auditoria do Fieldo Engenharia, aprovado pelo dono):
//        UMA ação só, "marcar_lido". Os 33 incidentes abertos até aqui
//        nunca tinham sido lidos porque não existia tela nem jeito de dar
//        baixa. Esta ação só muda reviewed/reviewed_at/reviewed_by de
//        incidentes; não aprova mudança, não publica nada, não chama o
//        Conselho (Regras 6 e 7 continuam valendo).
//
// verify_jwt = false DE PROPÓSITO, igual admin-stats/admin-analytics: a
// autorização é o header x-admin-key, comparado em tempo constante contra
// FIELDO_ADMIN_KEY. Sem a chave certa, devolve 403 e mais nada.
//
// As tabelas lidas aqui (integrity_*, change_*, council_*) têm RLS ligada e
// nenhuma policy — anon e authenticated não enxergam nada delas.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADMIN_KEY    = Deno.env.get('FIELDO_ADMIN_KEY');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'content-type, x-admin-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const REST = SUPABASE_URL + '/rest/v1/';
const SVC_HEADERS = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function buscar<T>(tabela: string, query: string): Promise<T[]> {
  const r = await fetch(REST + tabela + '?' + query, { headers: SVC_HEADERS });
  if (!r.ok) throw new Error(tabela + ' ' + r.status);
  return r.json();
}

type Check = {
  id: string; run_id: string; url: string; checked_at: string; http_status: number | null;
  html_bytes: number | null; title: string | null; canonical: string | null;
  json_ld_valid: boolean | null; run_ok: boolean; error: string | null;
  is_baseline: boolean; is_regression: boolean;
};
type Incidente = {
  id: string; url: string; opened_at: string; severity: string; summary: string;
  reviewed: boolean; reviewed_at: string | null;
};
type Change = {
  change_id: string; opened_at: string; reason: string; author: string;
  files: string[]; status: string; approved_by: string | null; approved_at: string | null;
  deploy_id: string | null; post_deploy_status: string | null;
};
type ChangeFile = {
  change_id: string; file_path: string; bytes_before: number | null; bytes_after: number | null;
  hash_before: string | null; hash_after: string | null;
};
type ChangeTest = { change_id: string; run_at: string; environment: string; result: string; reasons: string[] | null };
type Review = {
  id: string; incident_id: string | null; change_id: string | null; requested_at: string;
  finished_at: string | null; model: string; input_digest: string; status: string;
  error: string | null; tokens_in: number | null; tokens_out: number | null; is_escalation: boolean;
};
type Opinion = {
  review_id: string; specialist: string; severity: string; summary: string;
  reasoning: string | null; recommended_action: string | null; confidence: string | null;
};
type Budget = { month_start: string; calls_used: number; calls_limit: number };

async function marcarLido(body: Record<string, unknown>): Promise<Response> {
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string' && UUID.test(x)) as string[] : [];
  if (ids.length === 0 || ids.length > 500) return json({ error: 'ids_invalidos' }, 400);
  const quem = typeof body.por === 'string' && body.por.trim() ? body.por.trim().slice(0, 60) : 'painel admin-engenharia';
  const r = await fetch(REST + 'integrity_incidents?id=in.(' + ids.join(',') + ')&reviewed=is.false', {
    method: 'PATCH',
    headers: { ...SVC_HEADERS, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ reviewed: true, reviewed_at: new Date().toISOString(), reviewed_by: quem }),
  });
  if (!r.ok) {
    console.error('[admin-engenharia] marcar_lido', r.status, (await r.text()).slice(0, 200));
    return json({ error: 'falha_ao_salvar' }, 500);
  }
  const rows = await r.json();
  return json({ ok: true, marcados: Array.isArray(rows) ? rows.length : 0 });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (!SUPABASE_URL || !SERVICE_KEY || !ADMIN_KEY) {
    console.error('[admin-engenharia] variáveis de ambiente ausentes.');
    return json({ error: 'server_misconfigured' }, 500);
  }

  if (!safeEqual(req.headers.get('x-admin-key') ?? '', ADMIN_KEY)) {
    await new Promise((r) => setTimeout(r, 700));
    return json({ error: 'forbidden' }, 403);
  }

  if (req.method === 'POST') {
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { return json({ error: 'json_invalido' }, 400); }
    if (body.acao === 'marcar_lido') return marcarLido(body);
    return json({ error: 'acao_desconhecida' }, 400);
  }

  try {
    const agora = new Date();
    const mesAtual = agora.toISOString().slice(0, 8) + '01';

    const [checks, incidentes, changes, changeFiles, changeTests, reviews, opinions, budgets] = await Promise.all([
      buscar<Check>('integrity_checks',
        'select=id,run_id,url,checked_at,http_status,html_bytes,title,canonical,json_ld_valid,run_ok,error,is_baseline,is_regression' +
        '&order=checked_at.desc&limit=400'),
      buscar<Incidente>('integrity_incidents',
        'select=id,url,opened_at,severity,summary,reviewed,reviewed_at&order=opened_at.desc&limit=300'),
      buscar<Change>('change_requests',
        'select=change_id,opened_at,reason,author,files,status,approved_by,approved_at,deploy_id,post_deploy_status' +
        '&order=opened_at.desc&limit=50'),
      buscar<ChangeFile>('change_file_versions',
        'select=change_id,file_path,bytes_before,bytes_after,hash_before,hash_after&order=created_at.desc&limit=200'),
      buscar<ChangeTest>('change_tests',
        'select=change_id,run_at,environment,result,reasons&order=run_at.desc&limit=100'),
      buscar<Review>('council_reviews',
        'select=id,incident_id,change_id,requested_at,finished_at,model,input_digest,status,error,tokens_in,tokens_out,is_escalation' +
        '&order=requested_at.desc&limit=60'),
      buscar<Opinion>('council_opinions',
        'select=review_id,specialist,severity,summary,reasoning,recommended_action,confidence&order=created_at.asc&limit=300'),
      buscar<Budget>('council_budget', 'select=month_start,calls_used,calls_limit&month_start=eq.' + mesAtual),
    ]);

    // ── FASE 1 ──────────────────────────────────────────────────────
    const ultimoRunId = checks.length ? checks[0].run_id : null;
    const daUltimaRodada = checks.filter((c) => c.run_id === ultimoRunId);

    const vistas = new Set<string>();
    const paginas = checks.filter((c) => {
      if (vistas.has(c.url)) return false;
      vistas.add(c.url);
      return true;
    }).map((c) => ({
      url: c.url, checked_at: c.checked_at, http_status: c.http_status,
      html_bytes: c.html_bytes, title: c.title, canonical: c.canonical,
      json_ld_valid: c.json_ld_valid, run_ok: c.run_ok, error: c.error,
      is_regression: c.is_regression,
    })).sort((a, b) => a.url.localeCompare(b.url));

    const historico: Record<string, { checked_at: string; html_bytes: number | null }[]> = {};
    for (const c of checks) {
      (historico[c.url] ||= []).push({ checked_at: c.checked_at, html_bytes: c.html_bytes });
    }
    for (const url of Object.keys(historico)) {
      historico[url] = historico[url].slice(0, 12).reverse();
    }

    const rodadasSet = new Map<string, { run_id: string; quando: string; urls: number; ok: number; regressoes: number }>();
    for (const c of checks) {
      const r = rodadasSet.get(c.run_id) ?? { run_id: c.run_id, quando: c.checked_at, urls: 0, ok: 0, regressoes: 0 };
      r.urls++;
      if (c.run_ok) r.ok++;
      if (c.is_regression) r.regressoes++;
      if (c.checked_at > r.quando) r.quando = c.checked_at;
      rodadasSet.set(c.run_id, r);
    }
    const rodadas = Array.from(rodadasSet.values()).sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, 10);

    const fase1 = {
      agendamento: 'a cada 3 horas (0 */3 * * *)',
      ultima_rodada: rodadas[0] ?? null,
      paginas_monitoradas: paginas.length,
      paginas,
      historico_tamanho: historico,
      rodadas,
      incidentes,
      incidentes_abertos: incidentes.filter((i) => !i.reviewed).length,
      ultima_verificacao: daUltimaRodada.length
        ? daUltimaRodada.reduce((m, c) => (c.checked_at > m ? c.checked_at : m), daUltimaRodada[0].checked_at)
        : null,
    };

    // ── FASE 2 ──────────────────────────────────────────────────────
    const mudancas = changes.map((ch) => ({
      ...ch,
      arquivos: changeFiles.filter((f) => f.change_id === ch.change_id),
      teste: changeTests.find((t) => t.change_id === ch.change_id) ?? null,
    }));

    const fase2 = {
      mudancas,
      aguardando_aprovacao: mudancas.filter((m) => m.status === 'aguardando_aprovacao').length,
      falhou: mudancas.filter((m) => m.status === 'falhou').length,
    };

    // ── FASE 3 ──────────────────────────────────────────────────────
    const consultas = reviews.map((r) => ({
      ...r,
      url: r.incident_id ? (incidentes.find((i) => i.id === r.incident_id)?.url ?? null) : null,
      pareceres: opinions.filter((o) => o.review_id === r.id),
    }));

    const b = budgets[0] ?? null;
    const fase3 = {
      agendamento: 'de hora em hora (20 * * * *), no máximo 3 incidentes por rodada',
      orcamento: b
        ? { mes: b.month_start, usadas: b.calls_used, teto: b.calls_limit, restantes: b.calls_limit - b.calls_used }
        : { mes: mesAtual, usadas: 0, teto: 50, restantes: 50 },
      consultas,
      total_pareceres: opinions.length,
      graves: opinions.filter((o) => o.severity === 'grave').length,
      tokens_mes: reviews.reduce((s, r) => s + (r.tokens_in ?? 0) + (r.tokens_out ?? 0), 0),
    };

    return json({ gerado_em: agora.toISOString(), fase1, fase2, fase3 });
  } catch (e) {
    console.error('[admin-engenharia]', e);
    return json({ error: 'server_error', detail: String(e).slice(0, 300) }, 500);
  }
});
