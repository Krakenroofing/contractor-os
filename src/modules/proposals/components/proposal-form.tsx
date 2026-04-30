'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatMoney } from '@/lib/money';
import { createProposalAction, type CreateProposalState } from '../actions';
import { proposalStatusValues, STATUS_LABEL } from '../schema';

const initialState: CreateProposalState = {};

export type EstimateOption = {
  id: string;
  number: string;
  projectName: string;
  customerName: string;
  total: string;
};

export function ProposalForm({
  estimates,
  defaultNumber,
}: {
  estimates: EstimateOption[];
  defaultNumber: string;
}) {
  const [state, formAction, pending] = useActionState(createProposalAction, initialState);
  const [estimateId, setEstimateId] = useState<string>('');
  const selected = estimates.find((e) => e.id === estimateId);

  const err = (key: string) => state.errors?.[key]?.[0];

  const today = new Date().toISOString().slice(0, 10);
  const defaultExpiry = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  })();

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Proposal number" error={err('number')} required>
          <Input name="number" defaultValue={defaultNumber} required />
        </Field>

        <Field label="Status" error={err('status')}>
          <Select name="status" defaultValue="draft">
            {proposalStatusValues.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Linked estimate"
          error={err('estimateId')}
          className="md:col-span-2"
          required
        >
          <Select
            name="estimateId"
            value={estimateId}
            onChange={(e) => setEstimateId(e.target.value)}
            required
          >
            <option value="" disabled>
              {estimates.length === 0
                ? 'No estimates — create one first'
                : 'Select an estimate'}
            </option>
            {estimates.map((e) => (
              <option key={e.id} value={e.id}>
                {e.number} — {e.projectName} ({e.customerName}) · {formatMoney(e.total)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Proposal date" error={err('proposalDate')}>
          <Input name="proposalDate" type="date" defaultValue={today} />
        </Field>

        <Field label="Valid until" error={err('expiryDate')}>
          <Input name="expiryDate" type="date" defaultValue={defaultExpiry} />
        </Field>
      </div>

      {selected && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Project</p>
            <p className="mt-0.5 text-slate-900">{selected.projectName}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Customer</p>
            <p className="mt-0.5 text-slate-900">{selected.customerName}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Total (from estimate)
            </p>
            <p className="mt-0.5 text-base font-semibold tabular-nums">
              {formatMoney(selected.total)}
            </p>
          </div>
        </div>
      )}

      <TextareaField
        name="scopeOfWork"
        label="Scope of work"
        rows={5}
        error={err('scopeOfWork')}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TextareaField
          name="inclusions"
          label="Inclusions"
          rows={4}
          error={err('inclusions')}
        />
        <TextareaField
          name="exclusions"
          label="Exclusions"
          rows={4}
          error={err('exclusions')}
        />
        <TextareaField
          name="paymentSchedule"
          label="Payment schedule"
          rows={4}
          error={err('paymentSchedule')}
        />
        <TextareaField
          name="warrantyNotes"
          label="Warranty notes"
          rows={4}
          error={err('warrantyNotes')}
        />
      </div>
      <TextareaField
        name="termsAndConditions"
        label="Terms and conditions"
        rows={6}
        error={err('termsAndConditions')}
      />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create proposal'}
        </Button>
        <Link href="/proposals">
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
  className,
  required,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function TextareaField({
  name,
  label,
  rows,
  error,
}: {
  name: string;
  label: string;
  rows: number;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <textarea
        name={name}
        rows={rows}
        className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
