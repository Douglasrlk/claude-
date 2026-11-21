// Fieldo · services/validation/reportSchema.ts
//
// Validação EXPLÍCITA para create_service_report. Hoje essa validação
// existe só de forma implícita, dentro de servico.html: o navegador não
// deixa o profissional apertar "gerar" com o campo cliente vazio, porque
// o HTML/JS da tela cuida disso antes de chamar FIELDO.Reports.create.
// Uma tool de MCP não tem tela na frente — é a IA preenchendo o payload
// direto — então esse "formulário" precisa existir aqui, em código,
// checando o mesmo que a tela checava (ver auditoria, item 4).

export type CreateServiceReportInput = {
  client_name: string;
  service_description?: string;
  category_key?: string;
  niche?: string;
  service_location?: string;
  valor?: number;
  service_date?: string; // AAAA-MM-DD
};

export class ValidationError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CLIENT_NAME = 200;
const MAX_DESCRICAO = 4000;
const MAX_LOCAL = 200;
const MAX_VALOR = 10_000_000; // teto de sanidade, não é limite de negócio real

function textoOpcional(v: unknown, campo: string, max: number): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new ValidationError(campo, campo + ' precisa ser texto');
  const t = v.trim();
  if (!t) return undefined;
  if (t.length > max) throw new ValidationError(campo, campo + ' muito longo (máx. ' + max + ' caracteres)');
  return t;
}

export function validateCreateServiceReport(raw: unknown): CreateServiceReportInput {
  if (!raw || typeof raw !== 'object') {
    throw new ValidationError('_root', 'entrada inválida — esperado um objeto');
  }
  const r = raw as Record<string, unknown>;

  const clientName = typeof r.client_name === 'string' ? r.client_name.trim() : '';
  if (!clientName) throw new ValidationError('client_name', 'client_name é obrigatório');
  if (clientName.length > MAX_CLIENT_NAME) {
    throw new ValidationError('client_name', 'client_name muito longo (máx. ' + MAX_CLIENT_NAME + ' caracteres)');
  }

  const serviceDescription = textoOpcional(r.service_description, 'service_description', MAX_DESCRICAO);
  const categoryKey = textoOpcional(r.category_key, 'category_key', 100);
  const niche = textoOpcional(r.niche, 'niche', 100);
  const serviceLocation = textoOpcional(r.service_location, 'service_location', MAX_LOCAL);

  let valor: number | undefined;
  if (r.valor !== undefined && r.valor !== null) {
    const n = Number(r.valor);
    if (!Number.isFinite(n) || n < 0) throw new ValidationError('valor', 'valor precisa ser um número maior ou igual a zero');
    if (n > MAX_VALOR) throw new ValidationError('valor', 'valor implausível');
    valor = Math.round(n * 100) / 100;
  }

  let serviceDate: string | undefined;
  if (r.service_date !== undefined && r.service_date !== null) {
    const s = String(r.service_date);
    if (!DATE_RE.test(s)) throw new ValidationError('service_date', 'service_date precisa estar no formato AAAA-MM-DD');
    serviceDate = s;
  }

  return {
    client_name: clientName,
    service_description: serviceDescription,
    category_key: categoryKey,
    niche,
    service_location: serviceLocation,
    valor,
    service_date: serviceDate,
  };
}
