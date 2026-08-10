// Serve the ORIGINAL uploaded bank-statement file, byte-for-byte as it came
// from the bank / operator. Auditors ask for unmodified source statements —
// this is that. Tenant-scoped through getImportBatch; the blob itself lives
// in the private statement-files bucket.

import { NextRequest } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { getImportBatch } from '@/lib/data/statement-imports';
import { downloadStatementBytes } from '@/lib/storage/statement-files';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ batchId: string }> },
) {
  const role = await getActiveRole();
  if (!canView(role, 'statement_imports')) {
    return new Response('Forbidden', { status: 403 });
  }
  const companyId = await getActiveCompanyId();
  const { batchId } = await ctx.params;

  const batch = await getImportBatch(companyId, batchId);
  if (!batch) return new Response('Not found', { status: 404 });
  if (batch.storagePath === 'manual') {
    return new Response(
      'This batch holds manually added entries — there is no source file.',
      { status: 404 },
    );
  }

  const bytes = await downloadStatementBytes(batch.storagePath);
  if (!bytes) {
    return new Response('The stored file could not be read.', { status: 404 });
  }

  // Sanitize the filename for the Content-Disposition header.
  const safeName = batch.sourceFilename.replace(/[^\w.\- ()]/g, '_');
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': batch.mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
