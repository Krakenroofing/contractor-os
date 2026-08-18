// Async data accessor for proposals (dual-backend: Postgres or mock store).

import 'server-only';
import { and, desc, eq, ne } from 'drizzle-orm';
import { proposals, type Proposal } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import { nextNumberInSequence } from '@/lib/next-number';
import {
  listMockProposals as mockList,
  getMockProposal as mockGet,
  listProposalsForProject as mockListForProject,
  createMockProposal as mockCreate,
  DuplicateProposalNumberError,
} from '@/lib/mock-store';

export { DuplicateProposalNumberError };

export type CreateProposalInput = {
  number: string;
  projectId: string;
  /** null for standalone proposals (uploaded PDFs with no in-app estimate). */
  estimateId: string | null;
  /** Archived source-PDF project_documents row, for uploaded proposals. */
  sourceDocumentId?: string | null;
  total: string;
  status: Proposal['status'];
  proposalDate: string | null;
  expiryDate: string | null;
  scopeOfWork: string | null;
  inclusions: string | null;
  exclusions: string | null;
  paymentSchedule: string | null;
  warrantyNotes: string | null;
  termsAndConditions: string | null;
};

function timestampsForStatus(status: Proposal['status'], now: Date) {
  // Match the mock-store's behavior so the first-save timestamps look the
  // same regardless of backend.
  return {
    submittedAt:
      status !== 'draft' && status !== 'expired' ? now : null,
    sentAt:
      status !== 'draft' && status !== 'expired' ? now : null,
    viewedAt:
      status === 'viewed' ||
      status === 'accepted' ||
      status === 'approved' ||
      status === 'declined' ||
      status === 'rejected'
        ? now
        : null,
    approvedAt:
      status === 'approved' || status === 'accepted' ? now : null,
    rejectedAt:
      status === 'rejected' || status === 'declined' ? now : null,
    acceptedAt:
      status === 'accepted' || status === 'approved' ? now : null,
    declinedAt:
      status === 'declined' || status === 'rejected' ? now : null,
  };
}

export async function listProposals(companyId: string): Promise<Proposal[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(proposals)
      .where(eq(proposals.companyId, companyId))
      .orderBy(desc(proposals.createdAt));
  }
  return mockList(companyId);
}

export async function getProposal(
  companyId: string,
  id: string,
): Promise<Proposal | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, id), eq(proposals.companyId, companyId)))
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

export async function listProposalsForProject(
  companyId: string,
  projectId: string,
): Promise<Proposal[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(proposals)
      .where(
        and(eq(proposals.companyId, companyId), eq(proposals.projectId, projectId)),
      )
      .orderBy(desc(proposals.createdAt));
  }
  return mockListForProject(projectId);
}

export async function createProposal(
  companyId: string,
  input: CreateProposalInput,
): Promise<Proposal> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const existing = await db
      .select({ id: proposals.id })
      .from(proposals)
      .where(and(eq(proposals.companyId, companyId), eq(proposals.number, input.number)))
      .limit(1);
    if (existing.length > 0) throw new DuplicateProposalNumberError();

    const now = new Date();
    const ts = timestampsForStatus(input.status, now);

    const inserted = await db
      .insert(proposals)
      .values({
        companyId,
        projectId: input.projectId,
        estimateId: input.estimateId,
        templateId: null,
        number: input.number,
        version: 1,
        status: input.status,
        proposalDate: input.proposalDate,
        expiryDate: input.expiryDate,
        total: input.total,
        scopeOfWork: input.scopeOfWork,
        inclusions: input.inclusions,
        exclusions: input.exclusions,
        paymentSchedule: input.paymentSchedule,
        warrantyNotes: input.warrantyNotes,
        termsAndConditions: input.termsAndConditions,
        sourceDocumentId: input.sourceDocumentId ?? null,
        pdfUrl: null,
        publicToken: null,
        ...ts,
        signatureImageUrl: null,
        signedByName: null,
        signedByEmail: null,
        signedIp: null,
      })
      .returning();
    return inserted[0];
  }
  return mockCreate(companyId, input);
}

export type UpdateProposalInput = CreateProposalInput;

/** Next proposal number following whatever scheme the company already uses.
 *  Shared by the new-proposal page and the upload-PDF review form. */
export async function nextProposalNumber(companyId: string): Promise<string> {
  const existing = await listProposals(companyId);
  return nextNumberInSequence(
    existing,
    `PROP-${new Date().getFullYear()}-001`,
  );
}

/** Link the archived source PDF (project_documents row) after upload —
 *  runs after createProposal so a failed create never orphans the link. */
export async function setProposalSourceDocument(
  companyId: string,
  id: string,
  sourceDocumentId: string,
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb()!;
  await db
    .update(proposals)
    .set({ sourceDocumentId, updatedAt: new Date() })
    .where(and(eq(proposals.id, id), eq(proposals.companyId, companyId)));
}

// Updates a proposal in place. The status timestamps (sentAt/approvedAt/etc.)
// are RE-stamped if the status moved to a state we hadn't recorded a
// timestamp for yet — we never clear an existing timestamp, so audit history
// stays intact.
export async function updateProposal(
  companyId: string,
  id: string,
  input: UpdateProposalInput,
): Promise<Proposal | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const existingRow = await db
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, id), eq(proposals.companyId, companyId)))
      .limit(1);
    if (existingRow.length === 0) return undefined;
    const prev = existingRow[0];

    if (prev.number !== input.number) {
      const dupe = await db
        .select({ id: proposals.id })
        .from(proposals)
        .where(
          and(
            eq(proposals.companyId, companyId),
            eq(proposals.number, input.number),
            ne(proposals.id, id),
          ),
        )
        .limit(1);
      if (dupe.length > 0) throw new DuplicateProposalNumberError();
    }

    const now = new Date();
    const nextTs = timestampsForStatus(input.status, now);

    // Preserve existing timestamps when the new status would set one we
    // already had. Only overwrite a null to non-null transition.
    const patch = {
      projectId: input.projectId,
      estimateId: input.estimateId,
      number: input.number,
      status: input.status,
      proposalDate: input.proposalDate,
      expiryDate: input.expiryDate,
      total: input.total,
      scopeOfWork: input.scopeOfWork,
      inclusions: input.inclusions,
      exclusions: input.exclusions,
      paymentSchedule: input.paymentSchedule,
      warrantyNotes: input.warrantyNotes,
      termsAndConditions: input.termsAndConditions,
      sentAt: prev.sentAt ?? nextTs.sentAt,
      viewedAt: prev.viewedAt ?? nextTs.viewedAt,
      approvedAt: prev.approvedAt ?? nextTs.approvedAt,
      acceptedAt: prev.acceptedAt ?? nextTs.acceptedAt,
      rejectedAt: prev.rejectedAt ?? nextTs.rejectedAt,
      declinedAt: prev.declinedAt ?? nextTs.declinedAt,
      updatedAt: now,
    };

    await db
      .update(proposals)
      .set(patch)
      .where(and(eq(proposals.id, id), eq(proposals.companyId, companyId)));

    const updated = await db
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, id), eq(proposals.companyId, companyId)))
      .limit(1);
    return updated[0];
  }
  // Demo mode: no in-memory update path — return undefined and let the
  // action layer surface a friendly message.
  return undefined;
}
