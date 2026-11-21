// Fieldo · services/usageService.ts
//
// ⚠️ SUPERADO NA FASE 2 — mesma nota de reportService.ts: o Edge Function
// do MCP não chama este arquivo. A lógica equivalente (mais simples,
// porque agora mora inteira dentro de uma função SQL só) é
// mcp_get_account_usage em supabase/migrations/2026-09-09_mcp_api_keys.sql.
//
// Porta FIELDO.Reports.canCreate (db.js ~1791) pro runtime Deno do MCP.
// Fase 1 do plano aprovado em MCP-fieldo-auditoria.md. Nada aqui é
// chamado por ninguém ainda.
//
// Não porta o resto de Reports.stats() (nota média, valores a receber) —
// o contrato de get_account_usage (auditoria, item 3) promete só
// plano/uso/limite, não o painel financeiro inteiro. Se algum dia uma
// tool precisar do resto de stats(), é uma função nova, não esta.

import { getMyProfile } from './profileService.ts';
import { countRows } from './supabaseRest.ts';

// Mesma tabela que PLAN_LIMITS.reportsPerMonth em db.js (~193). Duplicada
// aqui de propósito controlado: o MCP roda num runtime separado (Deno,
// sem acesso a db.js) — mas se esse número mudar num lugar e não no
// outro, os dois produtos divergem silenciosamente. Fica registrado aqui
// como um risco conhecido; a correção definitiva (fase futura, fora do
// escopo aprovado agora) é mover PLAN_LIMITS para um lugar único que os
// dois lados leem — ex.: uma linha de configuração no próprio banco.
const REPORTS_PER_MONTH: Record<string, number> = {
  free: 5,
  pro: Infinity,
};

export type AccountUsage = {
  plan: string;
  used_this_month: number;
  limit: number | null;   // null = sem limite (plano pro)
  remaining: number | null;
  allowed_to_create: boolean;
};

export async function getAccountUsage(professionalJwt: string, professionalId: string): Promise<AccountUsage> {
  const now = new Date();
  const primeiroDiaMes = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [prof, usedThisMonth] = await Promise.all([
    getMyProfile(professionalJwt, professionalId),
    countRows(
      '/reports?professional_id=eq.' + encodeURIComponent(professionalId) +
      '&created_at=gte.' + encodeURIComponent(primeiroDiaMes) +
      '&select=id',
      professionalJwt,
    ),
  ]);

  const plan = (prof && prof.plan) || 'free';
  const rawLimit = REPORTS_PER_MONTH[plan] ?? REPORTS_PER_MONTH.free;
  const semLimite = !Number.isFinite(rawLimit);

  // Infinity não sobrevive a JSON.stringify (vira null sozinho, sem
  // avisar) — por isso o null explícito abaixo, documentado, em vez de
  // deixar isso acontecer por acidente na resposta HTTP da tool.
  return {
    plan,
    used_this_month: usedThisMonth,
    limit: semLimite ? null : rawLimit,
    remaining: semLimite ? null : Math.max(0, rawLimit - usedThisMonth),
    allowed_to_create: semLimite ? true : usedThisMonth < rawLimit,
  };
}
