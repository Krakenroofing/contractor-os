'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  backfillPurchaseOrderAction,
  type BackfillState,
} from '@/modules/backfill/actions';
import { Field, FormShell } from './form-shell';

const initial: BackfillState = {};

export function PurchaseOrderMiniForm({
  projects,
  vendors,
}: {
  projects: { id: string; label: string }[];
  vendors: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(
    backfillPurchaseOrderAction,
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const err = (k: string) => state.errors?.[k]?.[0];

  useEffect(() => {
    if (state.ok && !state.formError) formRef.current?.reset();
  }, [state.ok, state.formError]);

  return (
    <form ref={formRef} action={formAction}>
      <FormShell state={state} pending={pending} submitLabel="Add purchase order">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Project" error={err('projectId')} required>
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
          <Field label="Vendor" error={err('vendorId')} required>
            <Select name="vendorId" required defaultValue="">
              <option value="" disabled>
                {vendors.length === 0 ? 'No vendors on file yet' : 'Pick a vendor'}
              </option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="PO number" error={err('number')} required>
            <Input name="number" required maxLength={50} placeholder="PO-2026-001" />
          </Field>
          <Field label="Status" error={err('status')}>
            <Select name="status" defaultValue="received">
              <option value="draft">Draft</option>
              <option value="issued">Issued</option>
              <option value="partially_received">Partially received</option>
              <option value="received">Received</option>
              <option value="closed">Closed</option>
            </Select>
          </Field>
          <Field label="Issue date (historical)" error={err('issueDate')} required>
            <Input name="issueDate" type="date" required />
          </Field>
          <Field label="Expected delivery" error={err('expectedDeliveryDate')}>
            <Input name="expectedDeliveryDate" type="date" />
          </Field>
          <Field label="Subtotal" error={err('subtotal')} required>
            <Input name="subtotal" inputMode="decimal" required placeholder="0.00" />
          </Field>
          <Field label="Tax / VAT" error={err('taxAmount')}>
            <Input name="taxAmount" inputMode="decimal" defaultValue="0" />
          </Field>
          <Field label="Shipping" error={err('shipping')}>
            <Input name="shipping" inputMode="decimal" defaultValue="0" />
          </Field>
          <Field label="Description" error={err('description')} className="md:col-span-2">
            <Input
              name="description"
              maxLength={500}
              placeholder="What was purchased (lump-sum description)"
            />
          </Field>
        </div>
      </FormShell>
    </form>
  );
}
