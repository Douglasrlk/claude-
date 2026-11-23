// Fieldo · Edge Function "verificar-cnpj" — v12.13
//
// O profissional informa o CNPJ; o SERVIDOR confere na base pública da
// Receita Federal (BrasilAPI, com a ReceitaWS de reserva) e só então
// grava cnpj, nome da empresa, situação e data de abertura no perfil.
// O papel `authenticated` não tem UPDATE nessas colunas — por isso
// "CNPJ ativo" no perfil é um fato conferido, não algo digitado.
//
//   POST { cnpj }        → confere e grava (só CNPJ ATIVO é aceito)
//   POST { remover:true } → tira o CNPJ do perfil
//
// MEI: a razão social do MEI costuma terminar com o CPF do dono
// ("FULANO DE TAL 12345678900"). Esses dígitos são cortados antes de
// gravar — o perfil é público e o CPF não pode aparecer nele.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function cnpjValido(c: string): boolean {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base: string, pesos: number[]) => {
    const s = pesos.reduce((t, p, i) => t + Number(base[i]) * p, 0);
    const r = s % 11; return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(c, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(c, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(c[12]) && d2 === Number(c[13]);
}

/* tira CPF (11 dígitos, com ou sem pontuação) do fim da razão social do MEI */
function semCpf(nome: string): string {
  return nome.replace(/[\s\-]*\d{3}\.?\d{3}\.?\d{3}-?\d{2}\s*$/, "").replace(/\s{2,}/g, " ").trim();
}
function titulo(s: string): string {
  const minus = new Set(["de", "da", "do", "das", "dos", "e", "em"]);
  return s.toLowerCase().split(/\s+/).map((w, i) =>
    (i > 0 && minus.has(w)) ? w : (/^(me|epp|ltda|eireli|s\/a|sa)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))
  ).join(" ");
}

type Dados = { nome: string; situacao: string; abertura: string | null };

async function consultar(c: string): Promise<Dados | "nao_encontrado" | null> {
  // 1) BrasilAPI
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${c}`, { headers: { "User-Agent": "Fieldo/1.0" } });
    if (r.status === 404) return "nao_encontrado";
    if (r.ok) {
      const j = await r.json();
      const nome = String(j.nome_fantasia || "").trim() || semCpf(String(j.razao_social || ""));
      // descricao_situacao_cadastral = "ATIVA"; situacao_cadastral é o código (2 = ativa)
      const sit = j.descricao_situacao_cadastral ? String(j.descricao_situacao_cadastral) : (Number(j.situacao_cadastral) === 2 ? "ATIVA" : String(j.situacao_cadastral || ""));
      return { nome: titulo(nome), situacao: sit.toUpperCase(), abertura: j.data_inicio_atividade || null };
    }
  } catch (e) { console.error("[verificar-cnpj] brasilapi", e); }
  // 2) ReceitaWS (reserva)
  try {
    const r = await fetch(`https://receitaws.com.br/v1/cnpj/${c}`);
    if (r.ok) {
      const j = await r.json();
      if (j.status === "ERROR") return /inv|não encontrado|nao encontrado/i.test(String(j.message)) ? "nao_encontrado" : null;
      const nome = String(j.fantasia || "").trim() || semCpf(String(j.nome || ""));
      const ab = String(j.abertura || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      return { nome: titulo(nome), situacao: String(j.situacao || "").toUpperCase(), abertura: ab ? `${ab[3]}-${ab[2]}-${ab[1]}` : null };
    }
  } catch (e) { console.error("[verificar-cnpj] receitaws", e); }
  return null;
}

async function gravar(id: string, campos: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/professionals?id=eq.${id}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(campos),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error("[verificar-cnpj] gravar", r.status, t.slice(0, 200));
    if (/professionals_cnpj_uk|duplicate/i.test(t)) throw new Error("cnpj_em_uso");
    throw new Error("falha_ao_salvar");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("authorization") || "";
  const ru = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: auth } });
  if (!ru.ok) return json({ error: "sem_sessao" }, 401);
  const user = await ru.json();
  if (!user?.id) return json({ error: "sem_sessao" }, 401);

  let corpo: Record<string, unknown> = {};
  try { corpo = await req.json(); } catch { return json({ error: "json_invalido" }, 400); }

  try {
    if (corpo.remover === true) {
      await gravar(user.id, { cnpj: null, empresa_nome: null, cnpj_situacao: null, cnpj_abertura: null, cnpj_verificado_em: null });
      return json({ ok: true, removido: true });
    }

    const c = String(corpo.cnpj || "").replace(/\D/g, "");
    if (!cnpjValido(c)) return json({ error: "cnpj_invalido" }, 400);

    const d = await consultar(c);
    if (d === "nao_encontrado") return json({ error: "cnpj_nao_encontrado" }, 404);
    if (!d) return json({ error: "receita_indisponivel" }, 503);
    if (d.situacao !== "ATIVA") return json({ error: "cnpj_inativo", situacao: d.situacao }, 409);

    const campos = {
      cnpj: c, empresa_nome: d.nome.slice(0, 120) || null, cnpj_situacao: "ATIVA",
      cnpj_abertura: d.abertura, cnpj_verificado_em: new Date().toISOString(),
    };
    await gravar(user.id, campos);
    console.log("[verificar-cnpj] conferido", user.id.slice(0, 8));
    return json({ ok: true, ...campos });
  } catch (e) {
    const m = (e as Error).message;
    if (m === "cnpj_em_uso") return json({ error: "cnpj_em_uso" }, 409);
    return json({ error: "falha_ao_salvar" }, 500);
  }
});
