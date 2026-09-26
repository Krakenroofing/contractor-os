// Approvals + separation of duties (roadmap P6).
//
// Rule: a PO or bill over the company's approval limit must be approved by
// someone other than whoever created it (for bills: whoever entered the
// bill or set up its vendor). Owners may approve their own entries, but
// only with a stated reason — each one lands in control_exceptions, which
// the other owner reviews. Other roles can't self-approve at all.

import 'server-only';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { controlExceptions, type ControlException } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import type { Role } from '@/lib/permissions';

export type ApprovalCheck =
  | { ok: true; selfApproval: false }
  | { ok: true; selfApproval: true; reason: string }
  | { ok: false; code: 'reason_required' | 'forbidden'; error: string };

export function checkApproval(input: {
  amount: number;
  limit: string | number | null;
  actorId: string;
  role: Role;
  creatorIds: Array<string | null | undefined>;
  reason?: string | null;
  what: string;
}): ApprovalCheck {
  const limit = input.limit === null ? null : Number(input.limit);
  if (limit === null || !Number.isFinite(limit) || Math.abs(input.amount) <= limit) {
    return { ok: true, selfApproval: false };
  }
  const isCreator = input.creatorIds.some((c) => c && c === input.actorId);
  if (!isCreator) return { ok: true, selfApproval: false };
  const limitText = limit.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  if (input.role !== 'owner') {
    return {
      ok: false,
      code: 'forbidden',
      error: `${input.what} is over the ${limitText} approval limit and you entered it — someone else has to approve it.`,
    };
  }
  const reason = (input.reason ?? '').trim();
  if (reason.length < 3) {
    return {
      ok: false,
      code: 'reason_required',
      error: `${input.what} is over the ${limitText} approval limit and you entered it. Approving your own entry is logged for the other owner to review — give a short reason.`,
    };
  }
  return { ok: true, selfApproval: true, reason: reason.slice(0, 500) };
}

/** The approval trigger's message (KP003) out of a wrapped DB error, or null. */
export function approvalNeededMessage(err: unknown): string | null {
  let e: unknown = err;
  while (e && typeof e === 'object') {
    const m = (e as { message?: string }).message;
    if (typeof m === 'string') {
      const i = m.indexOf('Approval needed:');
      if (i >= 0) return m.slice(i);
    }
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

export async function recordControlException(input: {
  companyId: string;
  kind: ControlException['kind'];
  entityType: ControlException['entityType'];
  entityId: string;
  entityLabel: string | null;
  amount: number;
  userId: string | null;
  reason: string;
}): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await getDb()!.insert(controlExceptions).values({
    companyId: input.companyId,
    kind: input.kind,
    entityType: input.entityType,
    entityId: input.entityId,
    entityLabel: input.entityLabel,
    amount: input.amount.toFixed(2),
    userId: input.userId,
    reason: input.reason,
  });
}

export async function listControlExceptions(
  companyId: string,
  opts: { unreviewedOnly?: boolean } = {},
): Promise<ControlException[]> {
  if (!isDatabaseConfigured()) return [];
  return getDb()!
    .select()
    .from(controlExceptions)
    .where(
      and(
        eq(controlExceptions.companyId, companyId),
        opts.unreviewedOnly ? isNull(controlExceptions.reviewedAt) : undefined,
      ),
    )
    .orderBy(desc(controlExceptions.createdAt))
    .limit(500);
}

export async function markControlExceptionReviewed(
  companyId: string,
  id: string,
  reviewerId: string | null,
): Promise<ControlException | undefined> {
  const [row] = await getDb()!
    .update(controlExceptions)
    .set({ reviewedAt: new Date(), reviewedByUserId: reviewerId })
    .where(and(eq(controlExceptions.id, id), eq(controlExceptions.companyId, companyId)))
    .returning();
  return row;
}
