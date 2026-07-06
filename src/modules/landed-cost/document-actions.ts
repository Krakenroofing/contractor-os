'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import {
  getLandedCost,
  createLandedCostAttachment,
  getLandedCostAttachment,
  softDeleteLandedCostAttachment,
} from '@/lib/data/landed-costs';
import {
  extForUpload,
  ALLOWED_DOCUMENT_MIME,
  MAX_DOCUMENT_BYTES,
  PROJECT_DOCUMENTS_BUCKET,
  DocumentStorageNotConfiguredError,
} from '@/lib/storage/project-documents';
import {
  createSignedUploadForBucket,
  removeStorageObject,
  statStorageObject,
} from '@/lib/storage/signed-upload';

// Shipping-document attachments for a landed-cost entry. Same direct-to-storage
// pattern as project documents (signed upload URL → client PUT → server
// finalize re-stats the blob), but scoped to a landed-cost id and parked in the
// project-documents bucket under `{companyId}/landed-cost/{id}/...`.

export type LcUploadUrlGrant = {
  fileName: string;
  storagePath?: string;
  signedUrl?: string;
  error?: string;
};

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

const requestsSchema = z
  .array(
    z.object({
      fileName: z.string().min(1).max(300),
      mimeType: z.string().min(1).max(100),
      byteSize: z.number().int().positive(),
    }),
  )
  .min(1)
  .max(20);

export async function createLandedCostUploadUrlsAction(
  landedCostId: string,
  requests: unknown,
): Promise<{ formError?: string; uploads?: LcUploadUrlGrant[] }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'landed_cost')) {
    return { formError: 'You do not have permission to upload documents.' };
  }
  const companyId = await getActiveCompanyId();
  const entry = await getLandedCost(companyId, landedCostId);
  if (!entry) return { formError: 'Landed cost entry not found.' };
  const parsed = requestsSchema.safeParse(requests);
  if (!parsed.success) return { formError: 'Invalid upload request.' };

  const uploads: LcUploadUrlGrant[] = [];
  for (const req of parsed.data) {
    const mime = req.mimeType.toLowerCase();
    if (!ALLOWED_DOCUMENT_MIME.has(mime)) {
      uploads.push({ fileName: req.fileName, error: `Unsupported file type (${req.mimeType}).` });
      continue;
    }
    if (req.byteSize > MAX_DOCUMENT_BYTES) {
      uploads.push({
        fileName: req.fileName,
        error: `Too large (${mb(req.byteSize)}MB — max ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)}MB).`,
      });
      continue;
    }
    try {
      const grant = await createSignedUploadForBucket({
        bucket: PROJECT_DOCUMENTS_BUCKET,
        companyId,
        scopeSegments: ['landed-cost', entry.id],
        ext: extForUpload(req.fileName, mime),
      });
      if (!grant) return { formError: new DocumentStorageNotConfiguredError().message };
      uploads.push({ fileName: req.fileName, storagePath: grant.storagePath, signedUrl: grant.signedUrl });
    } catch (err) {
      uploads.push({
        fileName: req.fileName,
        error: err instanceof Error ? err.message : 'Could not start upload.',
      });
    }
  }
  return { uploads };
}

const refSchema = z.object({
  storagePath: z.string().min(1).max(500),
  fileName: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(100),
  byteSize: z.number().int().nonnegative(),
});

export async function uploadLandedCostDocumentsAction(
  landedCostId: string,
  _prev: { ok?: boolean; formError?: string },
  formData: FormData,
): Promise<{ ok?: boolean; formError?: string }> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'landed_cost')) {
    return { formError: 'You do not have permission to upload documents.' };
  }
  const companyId = await getActiveCompanyId();
  const entry = await getLandedCost(companyId, landedCostId);
  if (!entry) return { formError: 'Landed cost entry not found.' };

  const raw = formData.get('uploads');
  let refs: z.infer<typeof refSchema>[] = [];
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = z.array(refSchema).max(20).safeParse(JSON.parse(raw));
    if (parsed.success) refs = parsed.data;
  }
  if (refs.length === 0) return { formError: 'Choose at least one file to upload.' };

  const failures: string[] = [];
  let ok = 0;
  const prefix = `${companyId}/landed-cost/${entry.id}/`;
  for (const ref of refs) {
    if (!ref.storagePath.startsWith(prefix)) {
      failures.push(`${ref.fileName}: invalid upload path.`);
      continue;
    }
    const stat = await statStorageObject(PROJECT_DOCUMENTS_BUCKET, ref.storagePath);
    if (!stat) {
      failures.push(`${ref.fileName}: upload not found in storage — retry.`);
      continue;
    }
    if (stat.byteSize > MAX_DOCUMENT_BYTES) {
      await removeStorageObject(PROJECT_DOCUMENTS_BUCKET, ref.storagePath);
      failures.push(`${ref.fileName}: too large (${mb(stat.byteSize)}MB).`);
      continue;
    }
    const mime = (
      stat.mimeType && stat.mimeType !== 'application/octet-stream' ? stat.mimeType : ref.mimeType
    ).toLowerCase();
    if (!ALLOWED_DOCUMENT_MIME.has(mime)) {
      await removeStorageObject(PROJECT_DOCUMENTS_BUCKET, ref.storagePath);
      failures.push(`${ref.fileName}: unsupported file type (${mime}).`);
      continue;
    }
    try {
      await createLandedCostAttachment({
        companyId,
        landedCostId: entry.id,
        storagePath: ref.storagePath,
        mimeType: mime,
        byteSize: stat.byteSize,
        originalFileName: ref.fileName,
        uploadedBy: user.id,
      });
      ok += 1;
    } catch (err) {
      failures.push(`${ref.fileName}: ${err instanceof Error ? err.message : 'failed to record.'}`);
    }
  }

  revalidatePath(`/landed-cost/${landedCostId}`);
  if (failures.length > 0 && ok === 0) return { formError: failures.join(' · ') };
  if (failures.length > 0) return { ok: true, formError: `${ok} uploaded, ${failures.length} failed: ${failures.join(' · ')}` };
  return { ok: true };
}

export async function deleteLandedCostAttachmentAction(
  landedCostId: string,
  attachmentId: string,
): Promise<{ ok?: boolean; formError?: string }> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'landed_cost')) {
    return { formError: 'You do not have permission to delete documents.' };
  }
  const companyId = await getActiveCompanyId();
  const existing = await getLandedCostAttachment(companyId, attachmentId);
  if (!existing || existing.landedCostId !== landedCostId) {
    return { formError: 'Attachment not found.' };
  }
  await softDeleteLandedCostAttachment(companyId, attachmentId);
  revalidatePath(`/landed-cost/${landedCostId}`);
  return { ok: true };
}
