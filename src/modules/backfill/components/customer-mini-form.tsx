'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { backfillCustomerAction, type BackfillState } from '@/modules/backfill/actions';
import { Field, FormShell } from './form-shell';

const initial: BackfillState = {};

export function CustomerMiniForm() {
  const [state, formAction, pending] = useActionState(backfillCustomerAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const err = (k: string) => state.errors?.[k]?.[0];

  useEffect(() => {
    if (state.ok && !state.formError) formRef.current?.reset();
  }, [state.ok, state.formError]);

  return (
    <form ref={formRef} action={formAction}>
      <FormShell state={state} pending={pending} submitLabel="Add customer">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Customer name" error={err('name')} required>
            <Input name="name" required maxLength={200} />
          </Field>
          <Field label="Type" error={err('customerType')}>
            <Select name="customerType" defaultValue="residential">
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
            </Select>
          </Field>
          <Field label="Primary contact" error={err('primaryContactName')}>
            <Input name="primaryContactName" maxLength={200} />
          </Field>
          <Field label="Email" error={err('email')}>
            <Input name="email" type="email" maxLength={200} />
          </Field>
          <Field label="Phone" error={err('phone')}>
            <Input name="phone" maxLength={40} />
          </Field>
          <Field label="Notes" error={err('notes')} className="md:col-span-2">
            <textarea
              name="notes"
              rows={2}
              className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </Field>
        </div>
      </FormShell>
    </form>
  );
}
