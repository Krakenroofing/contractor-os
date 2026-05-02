'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getActiveCompanyId } from '@/lib/active-company';
import { getEstimate } from '@/lib/data/estimates';
import {
  createProposal,
  DuplicateProposalNumberError,
} from '@/lib/data/proposals';
import { proposalFormSchema } from './schema';

export type CreateProposalState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export async function createProposalAction(
  _prev: CreateProposalState,
  formData: FormData,
): Promise<CreateProposalState> {
  const parsed = proposalFormSchema.safeParse({
    number: formData.get('number'),
    estimateId: formData.get('estimateId'),
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

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  const estimate = await getEstimate(companyId, data.estimateId);
  if (!estimate) {
    return { errors: { estimateId: ['Estimate not found'] } };
  }

  let createdId: string;
  try {
    const proposal = await createProposal(companyId, {
      number: data.number,
      projectId: estimate.projectId,
      estimateId: estimate.id,
      total: estimate.total,
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

  revalidatePath('/proposals');
  redirect(`/proposals/${createdId}`);
}
