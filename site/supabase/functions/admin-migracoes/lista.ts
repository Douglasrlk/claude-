// Gerado a partir de supabase/migrations/ (v12.40–v12.42). É a LISTA FECHADA do que
// o painel pode aplicar: o SQL recebido só roda se o SHA-256 dele for um
// destes. Mudou uma vírgula no arquivo → hash diferente → recusado.
export type Migracao = { id: string; ordem: number; arquivo: string; nome: string; destrutiva: boolean; sha256: string };

export const MIGRACOES: Migracao[] = [
  { id: 'backup_v10_5', ordem: 1, arquivo: '2026-11-11_lgpd_apagar_backup_v10_5.sql', nome: 'Remover o backup de agosto (backup_v10_5)', destrutiva: true, sha256: 'a9498d37f697dde24947ee70865e1a2c36e1bb5c852ecc21b057aa43686f1ee2' },
  { id: 'pro_vencimento_avisos', ordem: 2, arquivo: '2026-11-18_pro_vencimento_avisos.sql', nome: 'Pro com prazo, avisos e volta ao grátis', destrutiva: false, sha256: 'bfcfeea20d001d338b151d7811221492bf478b127632d8765df30f3549ad2c05' },
  { id: 'pro_concedido_prazo', ordem: 3, arquivo: '2026-11-18_pro_concedido_prazo.sql', nome: 'Prazo de 30 + 5 dias para os 2 Pro sem vencimento', destrutiva: false, sha256: '28a37377ab7071cca2d3967b4d020fcc4123facdfd22d15766e9c9d2d84e8c60' },
  { id: 'loc_search_path', ordem: 4, arquivo: '2026-11-18_loc_search_path.sql', nome: 'search_path fixo nas 13 funções da Locação', destrutiva: false, sha256: '9c2bd3a0c5cf4344e93588bac089562e4411b0c962ea726b4aa3d135d8126fc7' },
  { id: 'inteligencia_comercial', ordem: 5, arquivo: '2026-11-18_inteligencia_comercial.sql', nome: 'Inteligência Comercial (minhas_metricas)', destrutiva: false, sha256: '92175cb45df92dc07af17f578b5706efd07c26d3ab0015b6c065a31014b13175' },
  { id: 'verificar_pdf', ordem: 6, arquivo: '2026-11-18_verificar_pdf.sql', nome: 'Verificar PDF pelo arquivo', destrutiva: false, sha256: '025654c8566cccc18624d0de7c128f863286b09df213d45ac0e27f3c6cfe2406' },
  { id: 'obra_contratos', ordem: 7, arquivo: '2026-11-18_obra_contratos.sql', nome: 'Contrato de obra com assinatura', destrutiva: false, sha256: '85f299522c39ee685ca4e1e79900a20c6c7214fd02858411fd8ab0b54af92dfe' },
  { id: 'admin_auditoria', ordem: 8, arquivo: '2026-11-18_admin_auditoria.sql', nome: 'Auditoria do painel (antes/depois de cada ação)', destrutiva: false, sha256: '89daebf55b7e5a6247dfd7d134fb71f451bbba36469a970ea41a22226b835995' },
  { id: 'fieldo_studio', ordem: 9, arquivo: '2026-11-19_fieldo_studio.sql', nome: 'Fieldo Studio e núcleo de mídia (cotas, vídeos, avisos)', destrutiva: false, sha256: '1273e9f89ff51233b08f0be28de8b1a4ebdad74f61cf9640422d21349fce67c7' },
  { id: 'locacao_precos_periodo', ordem: 10, arquivo: '2026-11-21_locacao_precos_periodo.sql', nome: 'Locação por período (diária, semana, quinzena, mês)', destrutiva: false, sha256: '2818f99bcebedfd7d7d976f1cb721d1a1248eaf9d27fe7b1bd0e65e93959a889' },
];
