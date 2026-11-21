// Fieldo · services/reportService.ts
//
// ⚠️ SUPERADO NA FASE 2 — mantido no repositório por transparência (nada
// é apagado neste projeto, só substituído com explicação), mas o Edge
// Function do MCP (supabase/functions/mcp/) NÃO chama este arquivo.
//
// Por quê: este arquivo foi desenhado na Fase 1 assumindo que o MCP ia
// autenticar com um JWT real do profissional (a "Opção B" original da
// auditoria). Ao implementar a Fase 2 de verdade, achei um problema
// sério nesse desenho — reaproveitar o mecanismo de e-mail/senha
// sintéticos do código de recuperação quebraria a recuperação de conta
// de quem já tem uma. A correção (ver supabase/migrations/2026-09-09_
// mcp_api_keys.sql) trocou JWT-por-tabela por chave-MCP-por-função SQL
// (SECURITY DEFINER) — o Edge Function nem chega a manusear um JWT de
// profissional, só repassa a chave crua pra função SQL certa. A lógica
// equivalente a este arquivo agora mora em supabase/functions/mcp/rpc.ts.
//
// Porta a fatia "remota pura" de FIELDO.Reports (db.js, módulo Reports,
// ~linha 1621) pro runtime Deno do MCP. Fase 1 do plano aprovado em
// MCP-fieldo-auditoria.md. Nada aqui é chamado por ninguém ainda —
// db.js e o restante do PWA continuam intocados.
//
// O que ficou de fora de propósito (auditoria, item 4 — "operações que
// precisam ser refatoradas"): tudo que é local-first no navegador
// (IndexedDB, fila de sincronização via LocalDB.queueOp, rascunho). Uma
// chamada de tool MCP é síncrona por natureza — a IA está esperando uma
// resposta agora, não "salva e sincroniza depois".
//
// Campos que o banco já preenche sozinho (ver schema real de `reports`,
// checado ao vivo): is_public (default true), payment_status (default
// 'nao_cobrado'), photos (default '[]'), rating_token (default gerado
// pelo Postgres). Por isso o payload abaixo não manda nenhum desses —
// deixar o banco decidir o default é mais seguro do que reimplementar a
// mesma regra aqui e desalinhar no futuro.

import { get, post, countRows } from './supabaseRest.ts';
import type { CreateServiceReportInput } from './validation/reportSchema.ts';

export type ServiceReport = {
  id: string;
  professional_id: string;
  client_name: string;
  category_key: string | null;
  category_label: string | null;
  niche: string | null;
  service_date: string | null;
  service_location: string | null;
  service_description: string | null;
  valor: number | null;
  payment_status: string;
  is_public: boolean;
  rating_token: string;
  created_at: string;
  [key: string]: unknown;
};

/* Espelha FIELDO.Reports.create (db.js ~1667), sem a parte local-first. */
export async function createServiceReport(
  professionalJwt: string,
  professionalId: string,
  input: CreateServiceReportInput,
): Promise<ServiceReport> {
  const payload: Record<string, unknown> = {
    professional_id: professionalId,
    client_name: input.client_name,
    service_description: input.service_description ?? null,
    category_key: input.category_key ?? null,
    // category_label espelha category_key: no PWA vem de um catálogo de
    // categorias com rótulo bonito (ex: "eletrica" → "Elétrica"); o MCP
    // ainda não tem esse catálogo portado, então usa a mesma chave como
    // rótulo por enquanto — não é dado errado, é um rótulo menos bonito.
    category_label: input.category_key ?? null,
    niche: input.niche ?? input.category_key ?? null,
    service_location: input.service_location ?? null,
    service_date: input.service_date ?? new Date().toISOString().slice(0, 10),
  };
  if (input.valor !== undefined) payload.valor = input.valor;

  const rows = await post('/reports', professionalJwt, payload) as ServiceReport[] | ServiceReport;
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || !row.id) throw new Error('Falha ao criar o relatório: resposta inesperada do banco.');
  return row;
}

/* Espelha FIELDO.Reports.list (db.js ~1623), sem o merge com registros
   locais pendentes (isso só existe no PWA offline-first). */
export async function listServiceReports(
  professionalJwt: string,
  professionalId: string,
  opts: { limit?: number } = {},
): Promise<{ reports: ServiceReport[]; total_no_mes: number }> {
  const limit = Math.max(1, Math.min(50, opts.limit ?? 5));
  const qs = '/reports?professional_id=eq.' + encodeURIComponent(professionalId) +
    '&order=created_at.desc&limit=' + limit;
  const reports = await get(qs, professionalJwt) as ServiceReport[];

  const now = new Date();
  const primeiroDiaMes = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const totalNoMes = await countRows(
    '/reports?professional_id=eq.' + encodeURIComponent(professionalId) +
    '&created_at=gte.' + encodeURIComponent(primeiroDiaMes) +
    '&select=id',
    professionalJwt,
  );

  return { reports, total_no_mes: totalNoMes };
}

/* get_service_report — variante AUTENTICADA que a auditoria (item 3)
   apontou como faltante: Reports.getById do db.js é pública de propósito
   (link do QR/perfil, sem exigir login). Aqui filtramos também por
   professional_id — não por segurança extra (a RLS já impede ler dado
   alheio de qualquer jeito), mas para devolver "não encontrado" em vez
   de confirmar que um id de outro profissional existe. */
export async function getServiceReport(
  professionalJwt: string,
  professionalId: string,
  reportId: string,
): Promise<ServiceReport | null> {
  const qs = '/reports?id=eq.' + encodeURIComponent(reportId) +
    '&professional_id=eq.' + encodeURIComponent(professionalId) + '&limit=1';
  const rows = await get(qs, professionalJwt) as ServiceReport[];
  return rows[0] || null;
}
