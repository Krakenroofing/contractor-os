'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { backfillRetainageAction, type BackfillState } from '@/modules/backfill/actions';
import { Field, FormShell } from './form-shell';

const initial: BackfillState = {};

export type RetainageInvoiceOption = {
  id: string;
  label: string;
};

export function RetainageMiniForm({
  invoices,
}: {
  invoices: RetainageInvoiceOption[];
}) {
  const [state, formAction, pending] = useActionState(
    backfillRetainageAction,
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const err = (k: string) => state.errors?.[k]?.[0];

  useEffect(() => {
    if (state.ok && !state.formError) formRef.current?.reset();
  }, [state.ok, state.formError]);

  return (
    <form ref={formRef} action={formAction}>
      <FormShell state={state} pending={pending} submitLabel="Record retainage release">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Invoice with retainage held" error={err('invoiceId')} required className="md:col-span-2">
            <Select name="invoiceId" required defaultValue="">
              <option value="" disabled>
                {invoices.length === 0
                  ? 'No invoices with retainage held — add one in step 5'
                  : 'Pick an invoice'}
              </option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Release number" error={err('releaseNumber')} required>
            <Input
              name="releaseNumber"
              required
              maxLength={50}
              placeholder="RTN-2026-001"
            />
          </Field>
          <Field label="Release date (historical)" error={err('releaseDate')} required>
            <Input name="releaseDate" type="date" required />
          </Field>
          <Field label="Amount released" error={err('amount')} required>
            <Input name="amount" inputMode="decimal" required placeholder="0.00" />
          </Field>
          <Field label="Notes" error={err('notes')} className="md:col-span-2">
            <Input
              name="notes"
              maxLength={2000}
              placeholder="Punch-list sign-off date, owner reference, etc."
            />
          </Field>
        </div>
      </FormShell>
    </form>
  );
}
