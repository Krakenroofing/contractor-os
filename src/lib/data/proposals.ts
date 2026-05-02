// Async data accessor for proposals (dual-backend: Postgres or mock store).

import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { proposals, type Proposal } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
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
  estimateId: string;
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
