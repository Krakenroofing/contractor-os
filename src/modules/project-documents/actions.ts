'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { getProject } from '@/lib/data/projects';
import {
  createProjectDocument,
  getProjectDocument,
  softDeleteProjectDocument,
  updateProjectDocument,
  ProjectDocumentsNotAvailableInDemoError,
} from '@/lib/data/project-documents';
import {
  uploadProjectDocument,
  ALLOWED_DOCUMENT_MIME,
  MAX_DOCUMENT_BYTES,
  DocumentStorageNotConfiguredError,
} from '@/lib/storage/project-documents';
import {
  documentCategoryValues,
  uploadMetadataSchema,
  updateMetadataSchema,
} from './schema';

export type DocumentActionState = {
  formError?: string;
  errors?: Record<string, string[]>;
  ok?: boolean;
};

const idSchema = z.string().uuid('Missing or invalid id');

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

function bytesToMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

function pickCategory(raw: unknown): (typeof documentCategoryValues)[number] {
  const s = (raw ?? 'other').toString();
  return (documentCategoryValues as readonly string[]).includes(s)
    ? (s as (typeof documentCategoryValues)[number])
    : 'other';
}

// =============================================================================
// Upload — multi-file. The uploader form posts one or more `file` entries plus
// shared metadata (category, description, visibleToClient). Each file becomes
// its own row; if any single file fails, the others still upload (best-effort)
// and the formError reports the failures.
// =============================================================================

export async function uploadDocumentsAction(
  projectId: string,
  _prev: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'documents')) {
    return { formError: 'You do not have permission to upload documents.' };
  }
  const companyId = await getActiveCompanyId();
  const project = await getProject(companyId, projectId);
  if (!project) return { formError: 'Project not found in the active company.' };

  const meta = uploadMetadataSchema.safeParse({
    category: formData.get('category') ?? 'other',
    description: formData.get('description') ?? '',
    visibleToClient:
      formData.get('visibleToClient') === 'on' ||
      formData.get('visibleToClient') === 'true',
  });
  if (!meta.success) {
    return { errors: meta.error.flatten().fieldErrors };
  }

  const files = formData.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return { formError: 'Choose at least one file to upload.' };
  }

  const failures: string[] = [];
  let successCount = 0;

  for (const file of files) {
    if (file.size > MAX_DOCUMENT_BYTES) {
      failures.push(
        `${file.name}: too large (${bytesToMb(file.size)}MB). Max is ${Math.round(
          MAX_DOCUMENT_BYTES / 1024 / 1024,
        )}MB.`,
      );
      continue;
    }
    const mime = (file.type || 'application/octet-stream').toLowerCase();
    if (!ALLOWED_DOCUMENT_MIME.has(mime)) {
      failures.push(`${file.name}: unsupported file type (${file.type || 'unknown'}).`);
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const upload = await uploadProjectDocument({
        companyId,
        projectId: project.id,
        bytes,
        mimeType: mime,
        originalFileName: file.name,
      });
      await createProjectDocument({
        companyId,
        projectId: project.id,
        uploadedBy: user.id,
        fileName: file.name,
        originalFileName: file.name,
        storagePath: upload.storagePath,
        mimeType: mime,
        byteSize: file.size,
        category: meta.data.category,
        description: emptyToNull(meta.data.description),
        visibleToClient: meta.data.visibleToClient,
        parentDocumentId: null,
        versionNumber: 1,
        isCurrentVersion: true,
        sortOrder: 0,
      });
      successCount += 1;
    } catch (err) {
      if (err instanceof DocumentStorageNotConfiguredError) {
        return { formError: err.message };
      }
      if (err instanceof ProjectDocumentsNotAvailableInDemoError) {
        return { formError: err.message };
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      failures.push(`${file.name}: ${message}`);
    }
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/documents`);

  if (failures.length > 0 && successCount === 0) {
    return { formError: failures.join(' · ') };
  }
  if (failures.length > 0) {
    return {
      ok: true,
      formError: `${successCount} uploaded, ${failures.length} failed: ${failures.join(' · ')}`,
    };
  }
  return { ok: true };
}

// =============================================================================
// Update metadata (name, category, description, client-visible flag)
// =============================================================================

export async function updateDocumentAction(
  projectId: string,
  documentId: string,
  _prev: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'documents')) {
    return { formError: 'You do not have permission to edit documents.' };
  }
  const idCheck = idSchema.safeParse(documentId);
  if (!idCheck.success) return { formError: 'Missing or invalid document id.' };
  const companyId = await getActiveCompanyId();

  const parsed = updateMetadataSchema.safeParse({
    fileName: formData.get('fileName') ?? '',
    category: pickCategory(formData.get('category')),
    description: formData.get('description') ?? '',
    visibleToClient:
      formData.get('visibleToClient') === 'on' ||
      formData.get('visibleToClient') === 'true',
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const out = await updateProjectDocument(companyId, documentId, {
      fileName: parsed.data.fileName,
      category: parsed.data.category,
      description: emptyToNull(parsed.data.description),
      visibleToClient: parsed.data.visibleToClient,
    });
    if (!out) return { formError: 'Document not found.' };
  } catch (err) {
    if (err instanceof ProjectDocumentsNotAvailableInDemoError) {
      return { formError: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save document: ${message}` };
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/documents`);
  return { ok: true };
}

// =============================================================================
// Soft-delete (removes blob best-effort, keeps the row marked deleted)
// =============================================================================

export async function deleteDocumentAction(
  projectId: string,
  documentId: string,
  _prev: DocumentActionState,
  _formData: FormData,
): Promise<DocumentActionState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'documents')) {
    return { formError: 'You do not have permission to delete documents.' };
  }
  const idCheck = idSchema.safeParse(documentId);
  if (!idCheck.success) return { formError: 'Missing or invalid document id.' };
  const companyId = await getActiveCompanyId();

  // Guard against deleting documents from another company.
  const existing = await getProjectDocument(companyId, documentId);
  if (!existing) return { formError: 'Document not found.' };

  try {
    await softDeleteProjectDocument(companyId, documentId);
  } catch (err) {
    if (err instanceof ProjectDocumentsNotAvailableInDemoError) {
      return { formError: err.message };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to delete document: ${message}` };
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/documents`);
  return { ok: true };
}
