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
    // Dump the raw error before we wrap it so the underlying SDK / gRPC
    // shape lands in Vercel logs verbatim, even when the SDK's own
    // formatter produces nothing useful. inspect() handles non-enumerable
    // props and circular refs that JSON.stringify can't.
    try {
      const util = await import('node:util');
      // The metadata field is a gRPC Metadata instance whose contents are
      // the actual server-side error info (often grpc-status-details-bin
      // with a binary protobuf, or text headers like google-cloud-resource-prefix).
      // Extract it explicitly so we don't have to read minified inspect output.
      let metadataDump: unknown = '(none)';
      const meta = (err as { metadata?: { getMap?: () => unknown; internalRepr?: unknown } } | null)
        ?.metadata;
      if (meta) {
        if (typeof meta.getMap === 'function') {
          try {
            metadataDump = meta.getMap();
          } catch {
            metadataDump = '(getMap threw)';
          }
        } else if (meta.internalRepr) {
          try {
            // internalRepr is a Map<string, Buffer[]> on @grpc/grpc-js
            const m = meta.internalRepr as Map<string, unknown[]>;
            const out: Record<string, string[]> = {};
            for (const [k, v] of m.entries()) {
              out[k] = v.map((b) =>
                Buffer.isBuffer(b) ? `<Buffer ${b.length}B>` : String(b),
              );
            }
            metadataDump = out;
          } catch {
            metadataDump = '(internalRepr parse failed)';
          }
        }
      }
      console.error(
        '[document-ai] processDocument raw error:',
        util.inspect(err, { depth: 6, showHidden: true, colors: false }),
        '\n[document-ai] typeof:',
        typeof err,
        '\n[document-ai] ownPropertyNames:',
        err && typeof err === 'object'
          ? Object.getOwnPropertyNames(err as object)
          : '(non-object)',
        '\n[document-ai] metadata:',
        util.inspect(metadataDump, { depth: 4, colors: false }),
      );
    } catch (logErr) {
      console.error('[document-ai] failed to dump raw error', logErr);
    }

    // The Google SDK wraps gRPC failures in GoogleError with .code / .details.
    // When those are missing the default .message renders as
    // "undefined undefined: undefined" which is useless to the operator.
    // Pull whatever fields exist into a readable string and rethrow.
    const e = err as {
      code?: number | string;
      details?: string;
      message?: string;
      reason?: string;
      statusDetails?: unknown;
      metadata?: unknown;
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
        : `Document AI did not return a usable error. Check the Vercel logs for "[document-ai] processDocument raw error" — that line has the full SDK error object. Most common causes: the configured processor (GOOGLE_DOCUMENT_AI_PROCESSOR_ID=${cfg.processorId.slice(0, 6)}…) is not a Receipt/Expense/Invoice parser in the ${cfg.location} region of project ${cfg.projectId}, the service account lacks the "Document AI API User" role, or the PDF exceeds the processor's sync size/page limit.`;
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

// ===== Diagnostic helpers (Phase 6.2 troubleshooting) =====

export type DocumentAiDiagnosis = {
  ok: boolean;
  info: {
    projectId?: string;
    location?: string;
    processorId?: string;
    serviceAccountEmail?: string;
    privateKeyId?: string;
    privateKeyStartsWith?: string;
    privateKeyEndsWith?: string;
    privateKeyLength?: number;
    privateKeyHasRealNewlines?: boolean;
    credentialsRawLength?: number;
  };
  step: 'config' | 'parse' | 'shape' | 'listProcessors' | 'restList' | 'ok';
  detail?: string;
  processorCount?: number;
  processorIdsFound?: string[];
  targetProcessorPresent?: boolean;
  rawError?: string;
  // REST fallback results — populated when the gRPC path fails. If REST
  // succeeds where gRPC fails, the bundling / SDK theory is confirmed.
  rest?: {
    ok: boolean;
    processorCount?: number;
    processorIds?: string[];
    targetPresent?: boolean;
    error?: string;
  };
  // Identity check — what Google says our access token represents.
  // If tokenIdentity.email doesn't match info.serviceAccountEmail, then
  // the auth library is somehow minting tokens for a different identity
  // than the credentials JSON declares, which explains "permission denied
  // even with Owner role" because the role was granted to a different SA.
  tokenIdentity?: {
    ok: boolean;
    email?: string;
    issuedTo?: string;
    audience?: string;
    scope?: string;
    expiresIn?: string;
    error?: string;
  };
};

/**
 * End-to-end connectivity test for Document AI. Bypasses processDocument
 * (which can fail opaquely) and just calls listProcessors — a simpler API
 * that exercises auth + transport without the document-processing layer.
 *
 * Reports every relevant config field so we can sanity-check the JSON
 * pasted into Vercel against what GCP says.
 */
export async function diagnoseDocumentAi(): Promise<DocumentAiDiagnosis> {
  const cfg = readConfig();
  if (!cfg) {
    return {
      ok: false,
      step: 'config',
      detail:
        'One or more env vars missing: GOOGLE_DOCUMENT_AI_PROJECT_ID, _LOCATION, _PROCESSOR_ID, GOOGLE_APPLICATION_CREDENTIALS_JSON.',
      info: {},
    };
  }

  let parsed: {
    client_email?: string;
    private_key?: string;
    private_key_id?: string;
    project_id?: string;
  };
  try {
    parsed = JSON.parse(cfg.credentialsJson);
  } catch (err) {
    return {
      ok: false,
      step: 'parse',
      detail: err instanceof Error ? err.message : 'JSON parse failed',
      info: {
        projectId: cfg.projectId,
        location: cfg.location,
        processorId: cfg.processorId,
        credentialsRawLength: cfg.credentialsJson.length,
      },
    };
  }

  const info: DocumentAiDiagnosis['info'] = {
    projectId: cfg.projectId,
    location: cfg.location,
    processorId: cfg.processorId,
    serviceAccountEmail: parsed.client_email,
    privateKeyId: parsed.private_key_id,
    privateKeyStartsWith: parsed.private_key?.slice(0, 28),
    privateKeyEndsWith: parsed.private_key?.slice(-26),
    privateKeyLength: parsed.private_key?.length,
    // After JSON.parse, escape sequences like \n become real newlines.
    // If this is false, the private key was pasted in a way that lost
    // its newlines — auth will fail at JWT signing.
    privateKeyHasRealNewlines: parsed.private_key?.includes('\n') ?? false,
    credentialsRawLength: cfg.credentialsJson.length,
  };

  if (!parsed.client_email || !parsed.private_key) {
    return {
      ok: false,
      step: 'shape',
      detail: 'Parsed JSON is missing client_email or private_key.',
      info,
    };
  }

  // Pre-flight: hit the OAuth2 token endpoint directly. This bypasses gRPC
  // entirely so if auth itself is broken (service account disabled, key
  // revoked, clock skew, project suspended), we get a readable HTTP error
  // instead of the "undefined undefined: undefined" gRPC wrapping. If
  // token acquisition succeeds, we know the bug is in the gRPC layer
  // (processor, network, SDK).
  let tokenIdentity: DocumentAiDiagnosis['tokenIdentity'];
  try {
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      credentials: { client_email: parsed.client_email, private_key: parsed.private_key },
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const authClient = await auth.getClient();
    const tokenResp = await authClient.getAccessToken();
    if (!tokenResp || !tokenResp.token) {
      return {
        ok: false,
        step: 'listProcessors',
        detail:
          'OAuth2 token endpoint returned no token (but no error either). This is unusual — likely an auth library version issue. Try again or rotate the key.',
        info,
      };
    }
    // Verify what identity this token actually represents. Critical when
    // permissions appear correctly bound but the API still says
    // PERMISSION_DENIED — confirms whether the auth flow minted a token
    // for the SA we expect, or somehow swapped to a different identity.
    try {
      const tokenInfoResp = await fetch(
        `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(tokenResp.token)}`,
      );
      if (tokenInfoResp.ok) {
        const ti = (await tokenInfoResp.json()) as {
          email?: string;
          azp?: string;
          aud?: string;
          scope?: string;
          expires_in?: string;
        };
        tokenIdentity = {
          ok: true,
          email: ti.email,
          issuedTo: ti.azp,
          audience: ti.aud,
          scope: ti.scope,
          expiresIn: ti.expires_in,
        };
      } else {
        tokenIdentity = {
          ok: false,
          error: `tokeninfo HTTP ${tokenInfoResp.status}: ${(await tokenInfoResp.text()).slice(0, 200)}`,
        };
      }
    } catch (tiErr) {
      tokenIdentity = {
        ok: false,
        error: tiErr instanceof Error ? tiErr.message : 'tokeninfo call threw',
      };
    }
    // Token acquired — fall through to the gRPC call below.
  } catch (err) {
    let rawError: string;
    try {
      const util = await import('node:util');
      rawError = util.inspect(err, { depth: 6, showHidden: true, colors: false });
    } catch {
      rawError = String(err);
    }
    console.error('[document-ai] diagnose token acquisition failed:', rawError);
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'Token acquisition threw without a message';
    return {
      ok: false,
      step: 'listProcessors',
      detail: `OAuth2 token exchange failed (BEFORE gRPC): ${message}. Most common causes when credentials look valid: service account is DISABLED (different from deleted — check the Status column on the Service Accounts page), GCP project is suspended or being deleted, or system clock skew on the Vercel function is too large for JWT validation.`,
      info,
      rawError,
    };
  }

  // Token works. Try listProcessors — exercises gRPC + the API itself
  // without invoking the document-processing layer.
  try {
    const client = getClient(cfg.location, cfg.credentialsJson);
    const parent = `projects/${cfg.projectId}/locations/${cfg.location}`;
    const [processors] = await client.listProcessors({ parent });
    const ids = processors
      .map((p) => p.name?.split('/').pop())
      .filter((v): v is string => typeof v === 'string');
    return {
      ok: true,
      step: 'ok',
      info,
      processorCount: processors.length,
      processorIdsFound: ids,
      targetProcessorPresent: ids.includes(cfg.processorId),
      tokenIdentity,
    };
  } catch (err) {
    let rawError: string;
    try {
      const util = await import('node:util');
      rawError = util.inspect(err, { depth: 6, showHidden: true, colors: false });
    } catch {
      rawError = String(err);
    }
    console.error('[document-ai] diagnose listProcessors failed:', rawError);

    // gRPC failed. Try the REST endpoint instead — same auth, same API,
    // just plain HTTP. If this works, the SDK / bundling is the bug and
    // we should refactor extractReceipt to use REST.
    const restResult = await tryRestListProcessors(cfg, parsed);

    return {
      ok: false,
      step: 'listProcessors',
      detail:
        err instanceof Error && err.message && err.message !== 'undefined undefined: undefined'
          ? err.message
          : 'listProcessors (gRPC) threw an unparseable error. Check the REST result below — if REST succeeds, the bug is in @grpc/grpc-js bundling inside Next.js and we should refactor to REST.',
      info,
      rawError,
      rest: restResult,
      tokenIdentity,
    };
  }
}

/**
 * Plain-HTTP fallback for listProcessors. Uses google-auth-library to get
 * an access token, then fetch() to call the v1 REST endpoint. Bypasses
 * @grpc/grpc-js entirely.
 */
async function tryRestListProcessors(
  cfg: { projectId: string; location: string; processorId: string },
  parsed: { client_email?: string; private_key?: string },
): Promise<NonNullable<DocumentAiDiagnosis['rest']>> {
  if (!parsed.client_email || !parsed.private_key) {
    return { ok: false, error: 'No credentials available for REST fallback.' };
  }
  try {
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      credentials: { client_email: parsed.client_email, private_key: parsed.private_key },
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const authClient = await auth.getClient();
    const tokenResp = await authClient.getAccessToken();
    if (!tokenResp || !tokenResp.token) {
      return { ok: false, error: 'REST: failed to get OAuth2 token.' };
    }

    const url = `https://${cfg.location}-documentai.googleapis.com/v1/projects/${cfg.projectId}/locations/${cfg.location}/processors`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${tokenResp.token}` },
    });
    const body = await resp.text();
    if (!resp.ok) {
      return {
        ok: false,
        error: `REST HTTP ${resp.status}: ${body.slice(0, 500)}`,
      };
    }
    let json: { processors?: Array<{ name?: string }> };
    try {
      json = JSON.parse(body);
    } catch {
      return { ok: false, error: `REST returned non-JSON: ${body.slice(0, 200)}` };
    }
    const ids = (json.processors ?? [])
      .map((p) => p.name?.split('/').pop())
      .filter((v): v is string => typeof v === 'string');
    return {
      ok: true,
      processorCount: ids.length,
      processorIds: ids,
      targetPresent: ids.includes(cfg.processorId),
    };
  } catch (err) {
    console.error('[document-ai] REST listProcessors failed:', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'REST call threw without message',
    };
  }
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
