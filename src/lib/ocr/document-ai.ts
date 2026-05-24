// Google Cloud Document AI integration for receipt OCR — Phase 2.6.
//
// Uses the Receipt / Expense processor (any "EXPENSE_PROCESSOR" or
// "EXPENSE_v1.x" type works; the bundled receipt parser returns the same
// shape of entities). Returns a normalized OcrExtractResult shape — the
// caller maps it to receipt header + line fields.
//
// Configuration (env vars, all required):
//   GOOGLE_DOCUMENT_AI_PROJECT_ID         GCP project id
//   GOOGLE_DOCUMENT_AI_LOCATION           "us" or "eu" — match the processor
//   GOOGLE_DOCUMENT_AI_PROCESSOR_ID       processor uuid from the GCP console
//   GOOGLE_APPLICATION_CREDENTIALS_JSON   service-account JSON content (raw)
//
// If any are missing, isOcrConfigured() returns false and the UI hides the
// "Auto-fill" buttons.

import 'server-only';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';

export type OcrLineItem = {
  description?: string;
  amount?: number;
  quantity?: number;
};

export type OcrExtractResult = {
  vendorName?: string;
  receiptDate?: string; // YYYY-MM-DD
  total?: number;
  subtotal?: number;
  vatAmount?: number;
  vatRate?: number; // percent (e.g., 13 for 13%)
  currency?: string;
  lineItems?: OcrLineItem[];
};

export class OcrNotConfiguredError extends Error {
  constructor() {
    super(
      'OCR is not configured. Set GOOGLE_DOCUMENT_AI_PROJECT_ID, _LOCATION, _PROCESSOR_ID, and GOOGLE_APPLICATION_CREDENTIALS_JSON.',
    );
    this.name = 'OcrNotConfiguredError';
  }
}

function readConfig(): {
  projectId: string;
  location: string;
  processorId: string;
  credentialsJson: string;
} | null {
  const projectId = process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID;
  const location = process.env.GOOGLE_DOCUMENT_AI_LOCATION;
  const processorId = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID;
  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!projectId || !location || !processorId || !credentialsJson) return null;
  return { projectId, location, processorId, credentialsJson };
}

export function isOcrConfigured(): boolean {
  return readConfig() !== null;
}

let cachedClient: DocumentProcessorServiceClient | null = null;
function getClient(location: string, credentialsJson: string) {
  if (cachedClient) return cachedClient;
  let parsed: unknown;
  try {
    parsed = JSON.parse(credentialsJson);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown parse error';
    throw new Error(
      `GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON (${detail}). Paste the full service-account JSON file contents — verbatim, no extra escaping.`,
    );
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { client_email?: unknown }).client_email !== 'string' ||
    typeof (parsed as { private_key?: unknown }).private_key !== 'string'
  ) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS_JSON parsed but is missing client_email or private_key. Use the full Google Cloud service-account JSON, not just a key id.',
    );
  }
  const credentials = parsed as { client_email: string; private_key: string };
  cachedClient = new DocumentProcessorServiceClient({
    credentials,
    apiEndpoint: `${location}-documentai.googleapis.com`,
  });
  return cachedClient;
}

/** Send an image / PDF to Document AI's Receipt processor and return a
 *  normalized extraction result. Throws OcrNotConfiguredError if env is
 *  unset, and bubbles other errors (network, auth, processor) up to the
 *  caller. */
export async function extractReceipt(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<OcrExtractResult> {
  const cfg = readConfig();
  if (!cfg) throw new OcrNotConfiguredError();
  const client = getClient(cfg.location, cfg.credentialsJson);

  // A common misconfiguration: pasting the full resource path
  // (`projects/.../locations/.../processors/<uuid>`) into the env var
  // instead of just the `<uuid>` tail. That double-prefixes below into
  // garbage and the SDK throws an opaque error. Catch it here with a
  // clear message instead.
  if (cfg.processorId.includes('/')) {
    throw new Error(
      'GOOGLE_DOCUMENT_AI_PROCESSOR_ID must be the bare processor UUID (e.g. "abc123def456"), not the full "projects/.../processors/..." path.',
    );
  }

  const name = `projects/${cfg.projectId}/locations/${cfg.location}/processors/${cfg.processorId}`;

  let response;
  try {
    [response] = await client.processDocument({
      name,
      rawDocument: {
        content: Buffer.from(input.bytes),
        mimeType: input.mimeType,
      },
    });
  } catch (err) {
    // The Google SDK wraps gRPC failures in GoogleError with .code / .details.
    // When those are missing the default .message renders as
    // "undefined undefined: undefined" which is useless to the operator.
    // Pull whatever fields exist into a readable string and rethrow.
    const e = err as {
      code?: number | string;
      details?: string;
      message?: string;
      reason?: string;
    } | null;
    const parts: string[] = [];
    if (e?.code !== undefined && e.code !== null) parts.push(`code=${e.code}`);
    if (e?.reason) parts.push(`reason=${e.reason}`);
    if (e?.details) parts.push(e.details);
    else if (e?.message && e.message !== 'undefined undefined: undefined') {
      parts.push(e.message);
    }
    const detail =
      parts.length > 0
        ? parts.join(' · ')
        : `Document AI did not return a usable error. Most common cause: the configured processor (GOOGLE_DOCUMENT_AI_PROCESSOR_ID=${cfg.processorId.slice(0, 6)}…) is not a Receipt/Expense/Invoice parser in the ${cfg.location} region of project ${cfg.projectId}, or the service account lacks the "Document AI API User" role.`;
    throw new Error(`Document AI call failed: ${detail}`);
  }

  const doc = response.document;
  if (!doc) return {};

  const result: OcrExtractResult = {};
  const lineItems: OcrLineItem[] = [];

  for (const entity of doc.entities ?? []) {
    const type = entity.type ?? '';
    const value = readEntityValue(entity);
    switch (type) {
      case 'supplier_name':
      case 'merchant_name':
        result.vendorName ??= value.text ?? undefined;
        break;
      case 'receipt_date':
      case 'invoice_date':
      case 'purchase_time':
        result.receiptDate ??= normalizeDate(value);
        break;
      case 'total_amount':
      case 'total_price':
        result.total ??= parseMoney(value);
        break;
      case 'net_amount':
      case 'subtotal_amount':
        result.subtotal ??= parseMoney(value);
        break;
      case 'total_tax_amount':
      case 'tax_amount':
        result.vatAmount ??= parseMoney(value);
        break;
      case 'currency':
        result.currency ??= (value.text ?? '').toUpperCase().slice(0, 3);
        break;
      case 'line_item': {
        const li: OcrLineItem = {};
        for (const prop of entity.properties ?? []) {
          const ptype = prop.type ?? '';
          const pval = readEntityValue(prop);
          if (ptype === 'line_item/description') li.description = pval.text ?? undefined;
          if (ptype === 'line_item/amount') li.amount = parseMoney(pval);
          if (ptype === 'line_item/quantity') {
            const q = Number(pval.text ?? '');
            if (Number.isFinite(q)) li.quantity = q;
          }
        }
        if (li.description || li.amount !== undefined) lineItems.push(li);
        break;
      }
      default:
        // Ignore unrecognized entity types — processors expose dozens
        // (line_item/unit_price, line_item/product_code, etc.).
        break;
    }
  }

  // Derive VAT rate from net + tax if both are present and net > 0.
  if (
    result.vatRate === undefined &&
    result.vatAmount !== undefined &&
    result.subtotal !== undefined &&
    result.subtotal > 0
  ) {
    const ratio = result.vatAmount / result.subtotal;
    result.vatRate = Math.round(ratio * 1000) / 10; // 1-decimal percent
  }

  if (lineItems.length > 0) result.lineItems = lineItems;
  return result;
}

// ---- helpers ----

type EntityValue = {
  text: string | null;
  money?: { units?: number | string | null; nanos?: number | null };
  date?: { year?: number | null; month?: number | null; day?: number | null };
};

// The Google SDK's IEntity / IMoney types use protobuf-style optional /
// Long-typed fields that don't align with our simple shape. Cast through a
// minimal local type — runtime values are already plain JS once the proto
// is converted at the SDK boundary.
function readEntityValue(entity: unknown): EntityValue {
  const e = (entity ?? {}) as {
    mentionText?: string | null;
    normalizedValue?: {
      text?: string | null;
      moneyValue?: {
        units?: number | string | bigint | null;
        nanos?: number | null;
      } | null;
      dateValue?: {
        year?: number | null;
        month?: number | null;
        day?: number | null;
      } | null;
    } | null;
  };
  const norm = e.normalizedValue ?? null;
  const money = norm?.moneyValue
    ? {
        units:
          typeof norm.moneyValue.units === 'bigint'
            ? norm.moneyValue.units.toString()
            : norm.moneyValue.units ?? null,
        nanos: norm.moneyValue.nanos ?? null,
      }
    : undefined;
  return {
    text: norm?.text ?? e.mentionText ?? null,
    money,
    date: norm?.dateValue ?? undefined,
  };
}

function parseMoney(v: EntityValue): number | undefined {
  if (v.money) {
    const units = Number(v.money.units ?? 0);
    const nanos = Number(v.money.nanos ?? 0);
    return Math.round((units + nanos / 1e9) * 100) / 100;
  }
  if (v.text) {
    const cleaned = v.text.replace(/[^\d.,-]/g, '').replace(/,/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
  }
  return undefined;
}

function normalizeDate(v: EntityValue): string | undefined {
  if (v.date && v.date.year && v.date.month && v.date.day) {
    const y = v.date.year.toString().padStart(4, '0');
    const m = v.date.month.toString().padStart(2, '0');
    const d = v.date.day.toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // Fall back to parsing the mention text — Document AI often supplies a
  // normalized YYYY-MM-DD string in `normalizedValue.text` even when
  // dateValue is empty.
  if (v.text) {
    const m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v.text);
    if (m) {
      const y = m[1];
      const mo = m[2].padStart(2, '0');
      const d = m[3].padStart(2, '0');
      return `${y}-${mo}-${d}`;
    }
  }
  return undefined;
}
