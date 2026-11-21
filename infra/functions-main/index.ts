// Roteador do supabase/edge-runtime: /functions/v1/<nome> → /home/deno/functions/<nome>
// (o gateway já remove o prefixo /functions/v1).
//
// ATENÇÃO: aqui NÃO há verificação de JWT (verify_jwt). Em produção esse
// ajuste é feito por função no painel/CLI do Supabase e NÃO está versionado
// no zip (falta supabase/config.toml). As funções admin-* se protegem pelo
// x-admin-key; as demais conferem o usuário chamando /auth/v1/user.
// Use só em ambiente local.

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

Deno.serve(async (req: Request) => {
  const nome = new URL(req.url).pathname.split("/")[1];
  if (!nome || !/^[a-z0-9-]+$/.test(nome)) {
    return Response.json({ error: "funcao_ausente" }, { status: 400 });
  }
  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `/home/deno/functions/${nome}`,
      memoryLimitMb: 256,
      workerTimeoutMs: 120_000,
      noModuleCache: false,
      importMapPath: null,
      envVars: Object.entries(Deno.env.toObject()),
    });
    return await worker.fetch(req);
  } catch (e) {
    console.error(`[functions] ${nome}:`, e);
    return Response.json({ error: "falha_ao_iniciar_funcao", funcao: nome }, { status: 500 });
  }
});
