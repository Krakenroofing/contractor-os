import { NextResponse } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import {
  PAYLOAD_BUILDERS,
  isSupportedDocumentType,
} from '@/lib/exports/registry';
import { renderDocumentPdf } from '@/lib/exports/pdf/render';
import { renderDocumentXlsx } from '@/lib/exports/xlsx/render';
import type { ExportFormat } from '@/lib/exports/types';

// Single dispatch route: /api/exports/{type}/{id}/{format}
//
// Auth: relies on `getActiveCompanyId` — same gate the detail pages use.
// If the active company doesn't own the requested resource the payload
// builder returns null and we 404, never leaking another tenant's data.
//
// Storage: nothing is persisted. The buffer is generated on the fly and
// streamed back. Adding optional storage later means writing to Supabase
// Storage in this handler and returning a signed URL instead — no template
// or payload changes required.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORTED_FORMATS: ExportFormat[] = ['pdf', 'xlsx'];

function isSupportedFormat(s: string): s is ExportFormat {
  return (SUPPORTED_FORMATS as string[]).includes(s);
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const EXTENSIONS: Record<ExportFormat, string> = {
  pdf: 'pdf',
  xlsx: 'xlsx',
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ type: string; id: string; format: string }> },
) {
  const { type, id, format } = await ctx.params;

  if (!isSupportedDocumentType(type)) {
    return NextResponse.json({ error: 'Unsupported document type' }, { status: 400 });
  }
  if (!isSupportedFormat(format)) {
    return NextResponse.json({ error: 'Unsupported format' }, { status: 400 });
  }

  const companyId = await getActiveCompanyId();
  const builder = PAYLOAD_BUILDERS[type];
  const payload = await builder(companyId, id);
  if (!payload) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const safeNumber = payload.number.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const filename = `${type}-${safeNumber}.${EXTENSIONS[format]}`;

  let body: Uint8Array;
  if (format === 'pdf') {
    body = await renderDocumentPdf(payload);
  } else {
    body = await renderDocumentXlsx(payload);
  }

  // Copy into a freshly-allocated ArrayBuffer-backed Uint8Array. Newer TS
  // libs type renderer output as `Uint8Array<ArrayBufferLike>` (the buffer
  // could in principle be SharedArrayBuffer), which doesn't satisfy
  // BlobPart's stricter `ArrayBufferView<ArrayBuffer>` requirement. The
  // explicit copy normalizes the type and is cheap relative to the PDF
  // rendering cost.
  const normalized = new Uint8Array(new ArrayBuffer(body.byteLength));
  normalized.set(body);

  return new NextResponse(normalized, {
    status: 200,
    headers: {
      'Content-Type': CONTENT_TYPES[format],
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'Content-Length': String(body.byteLength),
    },
  });
}
