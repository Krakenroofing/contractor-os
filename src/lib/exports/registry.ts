import 'server-only';
import type { DocumentPayload, DocumentType } from '@/lib/exports/types';
import { buildInvoicePayload } from '@/lib/exports/data/invoice-payload';
import { buildEstimatePayload } from '@/lib/exports/data/estimate-payload';
import { buildProposalPayload } from '@/lib/exports/data/proposal-payload';
import { buildDailyReportPayload } from '@/lib/exports/data/daily-report-payload';

// Single dispatch table. Adding a new document type = one entry here, plus
// the payload builder. Routes, PDF templates, and XLSX sheets all flow
// through this registry — no other module hard-codes the doc-type list.
export const PAYLOAD_BUILDERS: Record<
  DocumentType,
  (companyId: string, id: string) => Promise<DocumentPayload | null>
> = {
  invoice: buildInvoicePayload,
  estimate: buildEstimatePayload,
  proposal: buildProposalPayload,
  daily_report: buildDailyReportPayload,
};

export const SUPPORTED_DOCUMENT_TYPES: DocumentType[] = [
  'invoice',
  'estimate',
  'proposal',
  'daily_report',
];

export function isSupportedDocumentType(t: string): t is DocumentType {
  return (SUPPORTED_DOCUMENT_TYPES as string[]).includes(t);
}
