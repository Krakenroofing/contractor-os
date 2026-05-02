'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { backfillInvoiceAction, type BackfillState } from '@/modules/backfill/actions';
import { Field, FormShell } from './form-shell';

const initial: BackfillState = {};

export function InvoiceMiniForm({
  projects,
}: {
  projects: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(backfillInvoiceAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const err = (k: string) => state.errors?.[k]?.[0];

  useEffect(() => {
    if (state.ok && !state.formError) formRef.current?.reset();
  }, [state.ok, state.formError]);

  return (
    <form ref={formRef} action={formAction}>
      <FormShell state={state} pending={pending} submitLabel="Add invoice">
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
          <Field label="Invoice number" error={err('number')} required>
            <Input name="number" required maxLength={50} placeholder="INV-2026-001" />
          </Field>
          <Field label="Status" error={err('status')}>
            <Select name="status" defaultValue="sent">
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
            </Select>
          </Field>
          <Field label="Invoice date (historical)" error={err('invoiceDate')} required>
            <Input name="invoiceDate" type="date" required />
          </Field>
          <Field label="Due date" error={err('dueDate')}>
            <Input name="dueDate" type="date" />
          </Field>
          <Field label="Subtotal" error={err('subtotal')} required>
            <Input
              name="subtotal"
              inputMode="decimal"
              required
              placeholder="0.00"
            />
          </Field>
          <Field label="Tax / VAT" error={err('taxAmount')}>
            <Input name="taxAmount" inputMode="decimal" defaultValue="0" />
          </Field>
          <Field label="Retainage %" error={err('retainagePercent')}>
            <Input
              name="retainagePercent"
              inputMode="decimal"
              defaultValue="0"
              placeholder="e.g. 10"
            />
          </Field>
          <Field
            label="Expected retainage release"
            error={err('expectedRetainageReleaseDate')}
          >
            <Input name="expectedRetainageReleaseDate" type="date" />
          </Field>
          <Field label="Description" error={err('description')} className="md:col-span-2">
            <Input
              name="description"
              maxLength={500}
              placeholder="Progress billing, milestone, deposit, etc."
            />
          </Field>
        </div>
      </FormShell>
    </form>
  );
}
