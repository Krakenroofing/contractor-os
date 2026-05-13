import { z } from 'zod';

export const documentCategoryValues = [
  'proposal',
  'estimate',
  'invoice',
  'contract',
  'permit',
  'drawing',
  'photo',
  'daily_report',
  'submittal',
  'warranty',
  'closeout',
  'financial',
  'other',
] as const;
export type DocumentCategory = (typeof documentCategoryValues)[number];

export const DOCUMENT_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  proposal: 'Proposal',
  estimate: 'Estimate',
  invoice: 'Invoice',
  contract: 'Contract',
  permit: 'Permit',
  drawing: 'Drawing',
  photo: 'Photo',
  daily_report: 'Daily Report',
  submittal: 'Submittal',
  warranty: 'Warranty',
  closeout: 'Closeout',
  financial: 'Financial',
  other: 'Other',
};

// Single-file metadata form schema (used by uploader). The actual File blob
// is read off FormData directly so it isn't represented here.
export const uploadMetadataSchema = z.object({
  category: z.enum(documentCategoryValues).default('other'),
  description: z.string().trim().max(2000).optional().default(''),
  visibleToClient: z.coerce.boolean().default(false),
});

export type UploadMetadataInput = z.infer<typeof uploadMetadataSchema>;

export const updateMetadataSchema = z.object({
  fileName: z.string().trim().min(1, 'File name is required').max(300),
  category: z.enum(documentCategoryValues).default('other'),
  description: z.string().trim().max(2000).optional().default(''),
  visibleToClient: z.coerce.boolean().default(false),
});

export type UpdateMetadataInput = z.infer<typeof updateMetadataSchema>;
