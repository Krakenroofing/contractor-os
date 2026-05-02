'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { backfillChangeOrderAction, type BackfillState } from '@/modules/backfill/actions';
import { Field, FormShell } from './form-shell';

const initial: BackfillState = {};

export function ChangeOrderMiniForm({
  projects,
}: {
  projects: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(
    backfillChangeOrderAction,
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const err = (k: string) => state.errors?.[k]?.[0];

  useEffect(() => {
    if (state.ok && !state.formError) formRef.current?.reset();
  }, [state.ok, state.formError]);

  return (
    <form ref={formRef} action={formAction}>
      <FormShell state={state} pending={pending} submitLabel="Add change order">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Project" error={err('projectId')} required className="md:col-span-2">
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
          <Field label="CO number" error={err('number')} required>
            <Input name="number" required maxLength={50} placeholder="CO-2026-001" />
          </Field>
          <Field label="Reason" error={err('reason')}>
            <Select name="reason" defaultValue="scope_change">
              <option value="scope_change">Scope change</option>
              <option value="customer_request">Customer request</option>
              <option value="design_change">Design change</option>
              <option value="conditions">Site conditions</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Status" error={err('status')}>
            <Select name="status" defaultValue="approved">
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </Select>
          </Field>
          <Field label="Total" error={err('total')} required>
            <Input
              name="total"
              inputMode="decimal"
              required
              placeholder="0.00"
            />
          </Field>
          <Field label="Submitted (historical)" error={err('submittedAt')}>
            <Input name="submittedAt" type="date" />
          </Field>
          <Field label="Approved (historical)" error={err('approvedAt')}>
            <Input name="approvedAt" type="date" />
          </Field>
          <Field label="Schedule impact (days)" error={err('scheduleImpactDays')}>
            <Input name="scheduleImpactDays" type="number" defaultValue={0} />
          </Field>
          <Field
            label="Description"
            error={err('description')}
            required
            className="md:col-span-2"
          >
            <textarea
              name="description"
              required
              rows={2}
              className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </Field>
        </div>
      </FormShell>
    </form>
  );
}
