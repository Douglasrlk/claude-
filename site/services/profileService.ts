// Fieldo · services/profileService.ts
//
// ⚠️ Ainda não usado por nenhuma tool da Fase 2 (get_my_profile fica pra
// Fase 4) — e quando chegar essa hora, o padrão vai ser o mesmo de
// reportService.ts/usageService.ts: uma função SQL SECURITY DEFINER
// nova (ex. mcp_get_my_profile), não este arquivo com JWT. Ver a nota
// no topo de reportService.ts para o porquê da mudança de desenho.
//
// Porta a fatia "remota pura" de FIELDO.Professionals.me (db.js ~1491)
// pro runtime Deno do MCP. Fase 1 do plano aprovado em
// MCP-fieldo-auditoria.md. Nada aqui é chamado por ninguém ainda.
//
// O que ficou de fora de propósito: o cache de 5 minutos que db.js mantém
// em localStorage (session_data / session_data_at). Esse cache existe no
// PWA pra não bater na rede a cada troca de tela do mesmo profissional;
// no MCP Server, cada chamada de tool já é uma ida à rede por natureza, e
// cachear em memória do processo entre profissionais diferentes seria
// risco de misturar dado de contas diferentes — mais simples e mais
// seguro buscar direto toda vez.

import { get } from './supabaseRest.ts';

export type Professional = {
  id: string;
  name: string | null;
  plan: string | null;
  niche: string | null;
  city: string | null;
  slug: string | null;
  is_public: boolean;
  [key: string]: unknown;
};

/* Espelha FIELDO.Professionals.me (sem force/cache) — busca o perfil do
   PRÓPRIO profissional autenticado. */
export async function getMyProfile(professionalJwt: string, professionalId: string): Promise<Professional | null> {
  const qs = '/professionals?id=eq.' + encodeURIComponent(professionalId) + '&limit=1';
  const rows = await get(qs, professionalJwt) as Professional[];
  return rows[0] || null;
}
