'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { CustomerPicker } from '@/modules/customers/components/customer-picker';
import { backfillProjectAction, type BackfillState } from '@/modules/backfill/actions';
import { Field, FormShell } from './form-shell';

const initial: BackfillState = {};

export function ProjectMiniForm({
  customers,
}: {
  customers: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(backfillProjectAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const err = (k: string) => state.errors?.[k]?.[0];

  useEffect(() => {
    if (state.ok && !state.formError) formRef.current?.reset();
  }, [state.ok, state.formError]);

  return (
    <form ref={formRef} action={formAction}>
      <FormShell state={state} pending={pending} submitLabel="Add project">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Customer" error={err('customerId')} required>
            <CustomerPicker
              name="customerId"
              required
              allowNone={false}
              placeholder="Pick a customer"
              customers={customers}
            />
          </Field>
          <Field label="Project number" error={err('number')} required>
            <Input name="number" required maxLength={50} placeholder="2026-001" />
          </Field>
          <Field label="Project name" error={err('name')} required className="md:col-span-2">
            <Input name="name" required maxLength={200} />
          </Field>
          <Field label="Status" error={err('status')}>
            <Select name="status" defaultValue="in_progress">
              <option value="lead">Lead</option>
              <option value="estimating">Estimating</option>
              <option value="won">Won</option>
              <option value="in_progress">In progress</option>
              <option value="closed">Closed</option>
              <option value="lost">Lost</option>
            </Select>
          </Field>
          <Field label="Contract value" error={err('contractValue')} required>
            <Input
              name="contractValue"
              inputMode="decimal"
              defaultValue="0"
              required
              placeholder="0.00"
            />
          </Field>
          <Field label="Start date (historical)" error={err('startDate')} required>
            <Input name="startDate" type="date" required />
          </Field>
          <Field label="Target completion date" error={err('targetCompletionDate')}>
            <Input name="targetCompletionDate" type="date" />
          </Field>
        </div>
      </FormShell>
    </form>
  );
}
