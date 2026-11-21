// Fieldo · Edge Function "conta-acesso" — v12.12 (TESTE)
//
// Troca o "código de recuperação de 16 caracteres" por e-mail e senha.
//
// Por que uma função no servidor e não um PUT /auth/v1/user direto do
// navegador: toda conta do Fieldo já tem um e-mail (o sintético
// fd-…@device.fieldo.app, derivado do código). Com "Secure email change"
// ligado, trocar um e-mail que já existe pelo navegador NÃO troca: deixa
// a mudança pendente e manda e-mail de confirmação — e o projeto não tem
// servidor de e-mail próprio, então a confirmação nunca chega (já há 2
// contas presas assim no banco). Aqui a troca é feita pela API de
// administração, confirmada na hora, e só para a PRÓPRIA conta de quem
// chama (o id vem do JWT, nunca do corpo).
//
// verify_jwt = true: sem sessão válida a requisição nem chega aqui.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return json({ error: "sem_sessao" }, 401);

  // Quem está chamando — pelo próprio token dela
  const ru = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: auth } });
  if (!ru.ok) return json({ error: "sem_sessao" }, 401);
  const user = await ru.json();
  if (!user?.id) return json({ error: "sem_sessao" }, 401);
  if (user.is_anonymous) return json({ error: "conta_anonima" }, 409);

  let corpo: Record<string, unknown> = {};
  try { corpo = await req.json(); } catch { return json({ error: "json_invalido" }, 400); }
  const email = String(corpo.email || "").trim().toLowerCase();
  const senha = String(corpo.senha || "");

  if (!EMAIL.test(email) || email.length > 120) return json({ error: "email_invalido" }, 400);
  if (email.endsWith("@device.fieldo.app")) return json({ error: "email_invalido" }, 400);
  if (senha.length < 8 || senha.length > 72) return json({ error: "senha_curta" }, 400);

  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: senha, email_confirm: true }),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error("[conta-acesso]", r.status, t.slice(0, 300));
    if (/already|exists|registered/i.test(t)) return json({ error: "email_em_uso" }, 409);
    if (/weak|password/i.test(t)) return json({ error: "senha_fraca" }, 400);
    return json({ error: "falha_ao_salvar" }, 500);
  }

  // O mesmo e-mail passa a ser o de avisos da conta, se ela não tinha um
  await fetch(`${SUPABASE_URL}/rest/v1/professionals?id=eq.${user.id}&email=is.null`, {
    method: "PATCH",
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ email }),
  }).catch(() => {});

  console.log("[conta-acesso] acesso por e-mail definido", user.id.slice(0, 8));
  return json({ ok: true, email });
});
