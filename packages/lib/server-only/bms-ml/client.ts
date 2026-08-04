import { env } from '../../utils/env';

/**
 * BMS ML API Client for OCR and document processing.
 * Connects to the BMS Machine Learning service for invoice/receipt extraction.
 */

// Config can come from env vars (global) or org settings (per-org)
export type BmsMlConfig = {
  apiUrl?: string | null;
  apiKey?: string | null;
  apiUsername?: string | null;
  apiPassword?: string | null;
  defaultTemplateId?: number | null;
  defaultEngine?: string | null;
};

// JWT token cache (per API URL)
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

const getJwtToken = async (config: BmsMlConfig): Promise<string | null> => {
  if (!config.apiUrl || !config.apiUsername || !config.apiPassword) return null;

  const cacheKey = config.apiUrl;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  try {
    // API URL is like http://host:8080/api/v1 — auth is at /api/auth/token/
    const baseUrl = config.apiUrl.replace(/\/api\/v1\/?$/, '');
    const response = await fetch(`${baseUrl}/api/auth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: config.apiUsername, password: config.apiPassword }),
    });

    if (!response.ok) return null;

    const data = await response.json() as { access: string; refresh: string };

    // Cache for 55 minutes (tokens usually expire in 60)
    tokenCache.set(cacheKey, { token: data.access, expiresAt: Date.now() + 55 * 60 * 1000 });

    return data.access;
  } catch {
    return null;
  }
};

const getGlobalConfig = (): BmsMlConfig => ({
  apiUrl: env('NEXT_PRIVATE_BMS_ML_API_URL') || null,
  apiKey: env('NEXT_PRIVATE_BMS_ML_API_KEY') || null,
});

const resolveConfig = (orgConfig?: BmsMlConfig | null): BmsMlConfig => {
  const global = getGlobalConfig();
  return {
    apiUrl: orgConfig?.apiUrl || global.apiUrl,
    apiKey: orgConfig?.apiKey || global.apiKey,
    apiUsername: orgConfig?.apiUsername || null,
    apiPassword: orgConfig?.apiPassword || null,
    defaultTemplateId: orgConfig?.defaultTemplateId || null,
    defaultEngine: orgConfig?.defaultEngine || null,
  };
};

const getHeaders = async (config: BmsMlConfig): Promise<Record<string, string>> => {
  const headers: Record<string, string> = {};

  // Priority 1: API key (simplest)
  if (config.apiKey) {
    if (config.apiKey.startsWith('eyJ')) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    } else if (config.apiKey.startsWith('sk-') || config.apiKey.startsWith('sk_')) {
      headers['X-API-Key'] = config.apiKey;
    } else {
      headers['X-API-Key'] = config.apiKey;
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }
    return headers;
  }

  // Priority 2: Username/password → JWT token
  if (config.apiUsername && config.apiPassword) {
    const token = await getJwtToken(config);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  return headers;
};

export const isBmsMlConfigured = (orgConfig?: BmsMlConfig | null) => {
  const config = resolveConfig(orgConfig);
  return !!config.apiUrl;
};

export type BmsMlUploadResult = {
  invoice: {
    id: number;
    filename: string;
    status: string;
    document_type: string;
    document_type_confidence: number;
    ocr_engine: string;
    ocr_confidence: number;
    ml_confidence: number;
    extraction_method: string;
    ai_enhanced: boolean;
    processing_time_ms: number;
    needs_human_review: boolean;
    raw_ocr_text: string;
    data: Record<string, unknown>;
    field_extractions: Array<{
      field_name: string;
      field_type: string;
      extracted_value: unknown;
      confidence_score: number;
      extraction_method: string;
      template_name: string;
      ai_fallback_used: boolean;
      requires_review: boolean;
    }>;
    line_items: unknown[];
    created_at: string;
  };
  processing_details: {
    steps: Array<{ step: string; [key: string]: unknown }>;
    status: string;
    completeness: {
      score: number;
      fields_found: number;
      total_fields: number;
      required_found: number;
      required_total: number;
    };
    total_duration_ms: number;
  };
};

export type BmsMlTemplate = {
  id: number;
  name: string;
  description: string;
  is_default: boolean;
  /** Absent on older deployments; treat undefined as active. */
  is_active?: boolean;
  /** Null for templates shared across organizations. */
  organization_id?: number | null;
  fields: Record<string, { type: string; required: boolean; patterns?: string[]; ai_hint?: string }>;
  ai_model?: string;
  ai_fallback_threshold?: number;
  use_count?: number;
  last_used_at?: string | null;
};

/**
 * Upload a file to BMS ML for OCR processing and field extraction.
 */
export const bmsMlUploadDocument = async (
  fileBuffer: Buffer,
  fileName: string,
  options?: {
    templateId?: number;
    ocrEngine?: string;
    mlOnly?: boolean;
    orgConfig?: BmsMlConfig | null;
  },
): Promise<BmsMlUploadResult> => {
  const config = resolveConfig(options?.orgConfig);
  if (!config.apiUrl) throw new Error('BMS ML API URL not configured');

  const formData = new FormData();
  // Type the part by extension so the service recognizes PDFs (it otherwise
  // keys off filename/content-type); fall back to octet-stream.
  const mime = /\.pdf$/i.test(fileName)
    ? 'application/pdf'
    : /\.(png|jpe?g|tiff?)$/i.test(fileName)
      ? 'image/' + fileName.split('.').pop()!.toLowerCase().replace('jpg', 'jpeg').replace('tif', 'tiff')
      : 'application/octet-stream';
  const blob = new Blob([fileBuffer], { type: mime });
  formData.append('file', blob, fileName);

  const templateId = options?.templateId || config.defaultTemplateId;
  const ocrEngine = options?.ocrEngine || config.defaultEngine;

  if (templateId) {
    formData.append('template_id', String(templateId));
  }
  if (ocrEngine) {
    formData.append('ocr_engine', ocrEngine);
  }
  if (options?.mlOnly) {
    formData.append('ml_only', 'true');
  }

  const authHeaders = await getHeaders(config);

  const response = await fetch(`${config.apiUrl}/invoices/`, {
    method: 'POST',
    headers: authHeaders,
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Upload failed' }));
    throw new Error((error as { detail?: string }).detail || `BMS ML API error: ${response.status}`);
  }

  return normalizeUploadResult(await response.json());
};

// Keys in the `data` object that are metadata, not extracted invoice fields.
const DATA_META_KEYS = new Set([
  'id',
  'created_at',
  'updated_at',
  'raw_extraction',
  'completeness_score',
  'required_fields_found',
  'total_required_fields',
]);

/**
 * Turn the BMS ML `data` object (canonical fields, each with a paired
 * `<field>_confidence`) into the `field_extractions` row shape. The API only
 * fills `field_extractions` when a saved template matches; for everything else
 * the AI-extracted fields live in `data`, so derive rows from there.
 */
const deriveFieldExtractions = (
  data: Record<string, unknown>,
  invoice: Record<string, unknown>,
): BmsMlUploadResult['invoice']['field_extractions'] => {
  const rows: BmsMlUploadResult['invoice']['field_extractions'] = [];
  const docConf =
    (typeof invoice.ml_confidence === 'number' && invoice.ml_confidence) ||
    (typeof invoice.ocr_confidence === 'number' && invoice.ocr_confidence) ||
    0;
  for (const [key, value] of Object.entries(data)) {
    if (key.endsWith('_confidence') || DATA_META_KEYS.has(key)) continue;
    if (value === null || value === undefined || value === '') continue;
    const conf = data[`${key}_confidence`];
    rows.push({
      field_name: key,
      field_type: typeof value === 'number' ? 'number' : 'text',
      extracted_value: value,
      confidence_score: typeof conf === 'number' ? conf : docConf,
      extraction_method: invoice.ai_enhanced ? 'ml+ai' : String(invoice.extraction_method ?? 'ml'),
      template_name: String(invoice.template_name ?? ''),
      ai_fallback_used: Boolean(invoice.ai_enhanced),
      requires_review: typeof conf === 'number' ? conf < 0.5 : false,
    });
  }
  return rows;
};

/**
 * The upload endpoint may return `{ invoice, processing_details }` or a flat
 * invoice record; normalize to the former and ensure `field_extractions` is
 * populated (from `data` when no template matched) so callers render uniformly.
 */
const normalizeUploadResult = (raw: unknown): BmsMlUploadResult => {
  const r = (raw ?? {}) as Record<string, unknown>;
  const invoice = ((r.invoice as Record<string, unknown>) ?? r) as BmsMlUploadResult['invoice'] &
    Record<string, unknown>;

  const data = invoice.data as Record<string, unknown> | undefined;
  if ((!Array.isArray(invoice.field_extractions) || invoice.field_extractions.length === 0) && data) {
    invoice.field_extractions = deriveFieldExtractions(data, invoice);
  }

  const processing_details =
    (r.processing_details as BmsMlUploadResult['processing_details']) ??
    ({
      steps: [],
      status: String(invoice.status ?? ''),
      completeness: {
        score: Number(data?.completeness_score ?? 0),
        fields_found: Number(data?.required_fields_found ?? 0),
        total_fields: Number(data?.total_required_fields ?? 0),
        required_found: Number(data?.required_fields_found ?? 0),
        required_total: Number(data?.total_required_fields ?? 0),
      },
      total_duration_ms: Number(invoice.processing_time_ms ?? 0),
    } as BmsMlUploadResult['processing_details']);

  return { invoice, processing_details };
};

/**
 * Get available extraction templates.
 */
export const bmsMlGetTemplates = async (orgConfig?: BmsMlConfig | null): Promise<BmsMlTemplate[]> => {
  const config = resolveConfig(orgConfig);
  if (!config.apiUrl) return [];

  const response = await fetch(`${config.apiUrl}/invoice-field-templates/`, {
    headers: await getHeaders(config),
  });

  if (!response.ok) return [];

  return response.json() as Promise<BmsMlTemplate[]>;
};

/**
 * Classify a document by its text content.
 */
export const bmsMlClassifyDocument = async (text: string, orgConfig?: BmsMlConfig | null) => {
  const config = resolveConfig(orgConfig);
  if (!config.apiUrl) return null;

  const response = await fetch(`${config.apiUrl}/documents/classify`, {
    method: 'POST',
    headers: { ...(await getHeaders(config)), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) return null;

  return response.json() as Promise<{
    predicted_type: string;
    confidence: number;
    probabilities: Record<string, number>;
  }>;
};

/**
 * Check OCR engine status.
 */
export const bmsMlGetStatus = async (orgConfig?: BmsMlConfig | null) => {
  const config = resolveConfig(orgConfig);
  if (!config.apiUrl) return { configured: false, available: false };

  try {
    const response = await fetch(`${config.apiUrl}/ocr-status/`, {
      headers: await getHeaders(config),
    });

    return {
      configured: true,
      available: response.ok,
      data: response.ok ? await response.json() : null,
    };
  } catch {
    return { configured: true, available: false };
  }
};
