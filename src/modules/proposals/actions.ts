'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { getEstimate } from '@/lib/data/estimates';
import { getProject } from '@/lib/data/projects';
import {
  createProposal,
  updateProposal,
  setProposalSourceDocument,
  DuplicateProposalNumberError,
} from '@/lib/data/proposals';
import { createProjectDocument } from '@/lib/data/project-documents';
import { uploadProjectDocument } from '@/lib/storage/project-documents';
import {
  ALLOWED_RECEIPT_MIME,
  MAX_RECEIPT_BYTES,
  RECEIPT_FILES_BUCKET,
  deleteReceiptBlob,
  downloadReceiptBlob,
  uploadReceiptFile,
} from '@/lib/storage/receipt-files';
import { statStorageObject } from '@/lib/storage/signed-upload';
import {
  extractProposalFromPdf,
  isOcrConfigured,
  type ExtractedProposal,
} from '@/lib/ocr/proposal-extract';
import { proposalFormSchema, type ProposalFormParsed } from './schema';

export type CreateProposalState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * Resolve where the proposal points and what it totals. Two shapes:
 *  - estimate-backed: project + total derive from the linked estimate;
 *  - standalone (e.g. created from an uploaded PDF): project picked
 *    directly, total entered on the form.
 */
async function resolveTarget(
  companyId: string,
  data: ProposalFormParsed,
): Promise<
  | { target: { projectId: string; estimateId: string | null; total: string } }
  | { errors: Record<string, string[]> }
> {
  const estimateId = data.estimateId?.trim() || null;
  if (estimateId) {
    const estimate = await getEstimate(companyId, estimateId);
    if (!estimate) return { errors: { estimateId: ['Estimate not found'] } };
    return {
      target: {
        projectId: estimate.projectId,
        estimateId: estimate.id,
        total: estimate.total,
      },
    };
  }
  const projectId = data.projectId?.trim() || '';
  if (projectId === '') {
    return {
      errors: { projectId: ['Pick a project (or link an estimate)'] },
    };
  }
  const project = await getProject(companyId, projectId);
  if (!project) {
    return { errors: { projectId: ['Project not found in this company'] } };
  }
  const total = data.total?.trim() || '';
  if (total === '') {
    return { errors: { total: ['Enter the proposal total'] } };
  }
  return { target: { projectId, estimateId: null, total } };
}

function parseFormData(formData: FormData) {
  return proposalFormSchema.safeParse({
    number: formData.get('number'),
    estimateId: formData.get('estimateId') ?? '',
    projectId: formData.get('projectId') ?? '',
    total: formData.get('total') ?? '',
    status: formData.get('status') ?? 'draft',
    proposalDate: formData.get('proposalDate') ?? '',
    expiryDate: formData.get('expiryDate') ?? '',
    scopeOfWork: formData.get('scopeOfWork') ?? '',
    inclusions: formData.get('inclusions') ?? '',
    exclusions: formData.get('exclusions') ?? '',
    paymentSchedule: formData.get('paymentSchedule') ?? '',
    warrantyNotes: formData.get('warrantyNotes') ?? '',
    termsAndConditions: formData.get('termsAndConditions') ?? '',
  });
}

export async function createProposalAction(
  _prev: CreateProposalState,
  formData: FormData,
): Promise<CreateProposalState> {
  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;
  const user = await requireAuth();
  const companyId = await getActiveCompanyId();

  const resolved = await resolveTarget(companyId, data);
  if ('errors' in resolved) return { errors: resolved.errors };
  const { target } = resolved;

  let createdId: string;
  try {
    const proposal = await createProposal(companyId, {
      number: data.number,
      projectId: target.projectId,
      estimateId: target.estimateId,
      total: target.total,
      status: data.status,
      proposalDate: emptyToNull(data.proposalDate ?? null),
      expiryDate: emptyToNull(data.expiryDate ?? null),
      scopeOfWork: emptyToNull(data.scopeOfWork ?? null),
      inclusions: emptyToNull(data.inclusions ?? null),
      exclusions: emptyToNull(data.exclusions ?? null),
      paymentSchedule: emptyToNull(data.paymentSchedule ?? null),
      warrantyNotes: emptyToNull(data.warrantyNotes ?? null),
      termsAndConditions: emptyToNull(data.termsAndConditions ?? null),
    });
    createdId = proposal.id;
  } catch (err) {
    if (err instanceof DuplicateProposalNumberError) {
      return { errors: { number: ['That proposal number is already used'] } };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create proposal: ${message}` };
  }

  // Archive the uploaded source PDF (if this create came from the upload
  // flow): move it from the temp receipt-files bucket into the project's
  // documents and link it on the proposal. A storage hiccup here never
  // takes the proposal down — the user can re-upload in project documents.
  const sourceStoragePath = String(formData.get('sourceStoragePath') ?? '').trim();
  if (sourceStoragePath !== '' && sourceStoragePath.startsWith(`${companyId}/`)) {
    const sourceFileName =
      String(formData.get('sourceFileName') ?? '').trim() || 'proposal.pdf';
    const sourceMimeType =
      String(formData.get('sourceMimeType') ?? '').trim() || 'application/pdf';
    const sourceByteSize = Number(formData.get('sourceByteSize') ?? 0) || 0;
    try {
      const blob = await downloadReceiptBlob(sourceStoragePath);
      if (blob) {
        const docUpload = await uploadProjectDocument({
          companyId,
          projectId: target.projectId,
          bytes: blob.bytes,
          mimeType: sourceMimeType,
          originalFileName: sourceFileName,
        });
        const doc = await createProjectDocument({
          companyId,
          projectId: target.projectId,
          uploadedBy: user.id,
          fileName: sourceFileName,
          originalFileName: sourceFileName,
          storagePath: docUpload.storagePath,
          mimeType: sourceMimeType,
          byteSize: sourceByteSize,
          changeOrderId: null,
          category: 'proposal',
          description: `Source PDF for proposal ${data.number}`,
          visibleToClient: false,
          parentDocumentId: null,
          versionNumber: 1,
          isCurrentVersion: true,
          sortOrder: 0,
        });
        await setProposalSourceDocument(companyId, createdId, doc.id);
        await deleteReceiptBlob(sourceStoragePath).catch(() => {});
      }
    } catch (err) {
      console.error(
        `[proposal-from-pdf] failed to attach source PDF for proposal ${data.number}:`,
        err,
      );
    }
  }

  revalidatePath('/proposals');
  redirect(`/proposals/${createdId}`);
}

// ---------------------------------------------------------------------------
// Update — same form schema as create, id bound by the page route.
// ---------------------------------------------------------------------------

export async function updateProposalAction(
  id: string,
  _prev: CreateProposalState,
  formData: FormData,
): Promise<CreateProposalState> {
  const parsed = parseFormData(formData);
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const data = parsed.data;

  const companyId = await getActiveCompanyId();
  const resolved = await resolveTarget(companyId, data);
  if ('errors' in resolved) return { errors: resolved.errors };
  const { target } = resolved;

  try {
    const out = await updateProposal(companyId, id, {
      number: data.number,
      projectId: target.projectId,
      estimateId: target.estimateId,
      total: target.total,
      status: data.status,
      proposalDate: emptyToNull(data.proposalDate ?? null),
      expiryDate: emptyToNull(data.expiryDate ?? null),
      scopeOfWork: emptyToNull(data.scopeOfWork ?? null),
      inclusions: emptyToNull(data.inclusions ?? null),
      exclusions: emptyToNull(data.exclusions ?? null),
      paymentSchedule: emptyToNull(data.paymentSchedule ?? null),
      warrantyNotes: emptyToNull(data.warrantyNotes ?? null),
      termsAndConditions: emptyToNull(data.termsAndConditions ?? null),
    });
    if (!out) {
      return {
        formError:
          'Proposal not found, or editing is not available in demo mode.',
      };
    }
  } catch (err) {
    if (err instanceof DuplicateProposalNumberError) {
      return { errors: { number: ['That proposal number is already used'] } };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save proposal: ${message}` };
  }

  revalidatePath('/proposals');
  revalidatePath(`/proposals/${id}`);
  redirect(`/proposals/${id}`);
}

// ---------------------------------------------------------------------------
// Upload + extract — mirrors the PO create-from-PDF pipeline: the client
// PUTs the file straight into the receipt-files temp bucket via a signed
// URL, then this action reads the bytes, OCRs them, and returns the parsed
// proposal fields for the review form.
// ---------------------------------------------------------------------------

export type ExtractProposalPdfState = {
  formError?: string;
  extracted?: ExtractedProposal;
  source?: {
    storagePath: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
  };
};

export async function extractProposalPdfAction(
  _prev: ExtractProposalPdfState,
  formData: FormData,
): Promise<ExtractProposalPdfState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'proposals')) {
    return { formError: 'You do not have permission to create proposals.' };
  }
  if (!isOcrConfigured()) {
    return {
      formError:
        'PDF extraction is not configured on this environment. Use the manual form instead.',
    };
  }

  const companyId = await getActiveCompanyId();
  const refRaw = formData.get('uploads');
  if (typeof refRaw !== 'string' || refRaw.trim() === '') {
    return { formError: 'Upload a proposal PDF first.' };
  }
  const parsedRef = z
    .object({
      storagePath: z.string().min(1).max(500),
      fileName: z.string().min(1).max(300),
      mimeType: z.string().min(1).max(100),
    })
    .safeParse(
      (() => {
        try {
          const arr = JSON.parse(refRaw);
          return Array.isArray(arr) ? arr[0] : arr;
        } catch {
          return null;
        }
      })(),
    );
  if (!parsedRef.success) {
    return { formError: 'Invalid upload reference — retry the upload.' };
  }
  const ref = parsedRef.data;
  if (!ref.storagePath.startsWith(`${companyId}/`)) {
    return { formError: 'Invalid upload path.' };
  }
  const stat = await statStorageObject(RECEIPT_FILES_BUCKET, ref.storagePath);
  if (!stat) {
    return { formError: 'Upload not found in storage — retry the upload.' };
  }
  if (stat.byteSize > MAX_RECEIPT_BYTES) {
    await deleteReceiptBlob(ref.storagePath).catch(() => {});
    return { formError: 'File too large (max 25 MB).' };
  }
  const mime = (
    stat.mimeType && stat.mimeType !== 'application/octet-stream'
      ? stat.mimeType
      : ref.mimeType
  ).toLowerCase();
  if (!ALLOWED_RECEIPT_MIME.has(mime)) {
    await deleteReceiptBlob(ref.storagePath).catch(() => {});
    return {
      formError: `Unsupported file type ${mime}. Use PDF or a photo (JPG/PNG/HEIC).`,
    };
  }
  const blob = await downloadReceiptBlob(ref.storagePath);
  if (!blob) {
    return { formError: 'Could not read the uploaded file from storage — retry.' };
  }
  let bytes = blob.bytes;

  // Re-create the PDF via pdf-lib before extraction — Document AI's backend
  // chokes on structural quirks (linearization, PDF/A, trailing bytes past
  // %%EOF). Same guard the receipts + PO pipelines use. Sync processors cap
  // at 10 pages; proposals are typically 2–6, so take the first 10.
  if (mime === 'application/pdf') {
    try {
      const { PDFDocument } = await import('pdf-lib');
      const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const totalPages = source.getPageCount();
      if (totalPages === 0) {
        return { formError: 'PDF has no pages.' };
      }
      const pageCount = Math.min(totalPages, 10);
      const clean = await PDFDocument.create();
      const copied = await clean.copyPages(
        source,
        Array.from({ length: pageCount }, (_, i) => i),
      );
      for (const p of copied) clean.addPage(p);
      bytes = new Uint8Array(await clean.save());
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      return {
        formError: `Could not parse the PDF before extraction: ${detail}. Try re-exporting it.`,
      };
    }
  }

  let extracted: ExtractedProposal;
  try {
    extracted = await extractProposalFromPdf({ bytes, mimeType: mime });
  } catch (err) {
    await deleteReceiptBlob(ref.storagePath).catch(() => {});
    console.error('[proposal-upload] extractProposalFromPdf failed', err);
    const message =
      err instanceof Error && err.message.trim() !== ''
        ? err.message
        : 'Extraction failed — try again, or use the manual form.';
    return { formError: message };
  }

  return {
    extracted,
    source: {
      storagePath: ref.storagePath,
      fileName: ref.fileName,
      mimeType: mime,
      byteSize: stat.byteSize,
    },
  };
}
