'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { backfillProposalAction, type BackfillState } from '@/modules/backfill/actions';
import { Field, FormShell } from './form-shell';

const initial: BackfillState = {};

export function ProposalMiniForm({
  projects,
}: {
  projects: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(backfillProposalAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const err = (k: string) => state.errors?.[k]?.[0];

  useEffect(() => {
    if (state.ok && !state.formError) formRef.current?.reset();
  }, [state.ok, state.formError]);

  return (
    <form ref={formRef} action={formAction}>
      <FormShell state={state} pending={pending} submitLabel="Add proposal">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field
            label="Project"
            error={err('projectId')}
            required
            className="md:col-span-2"
          >
            <Select name="projectId" required defaultValue="">
              <option value="" disabled>
                {projects.length === 0
                  ? 'No projects yet — finish step 2 first'
                  : 'Pick a project'}
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estimate number" error={err('estimateNumber')} required>
            <Input name="estimateNumber" required maxLength={50} placeholder="EST-2026-001" />
          </Field>
          <Field label="Proposal number" error={err('proposalNumber')} required>
            <Input name="proposalNumber" required maxLength={50} placeholder="PROP-2026-001" />
          </Field>
          <Field label="Proposal date (historical)" error={err('proposalDate')} required>
            <Input name="proposalDate" type="date" required />
          </Field>
          <Field label="Expiry date" error={err('expiryDate')}>
            <Input name="expiryDate" type="date" />
          </Field>
          <Field label="Total" error={err('total')} required>
            <Input
              name="total"
              inputMode="decimal"
              required
              placeholder="0.00"
            />
          </Field>
          <Field label="Status" error={err('status')}>
            <Select name="status" defaultValue="approved">
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="expired">Expired</option>
            </Select>
          </Field>
          <Field label="Scope of work" error={err('scopeOfWork')} className="md:col-span-2">
            <textarea
              name="scopeOfWork"
              rows={2}
              className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="One-line summary of what was proposed"
            />
          </Field>
        </div>
      </FormShell>
    </form>
  );
}
