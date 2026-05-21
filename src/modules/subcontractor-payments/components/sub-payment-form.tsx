'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatMoney } from '@/lib/money';
import {
  createSubPaymentAction,
  updateSubPaymentAction,
  type SubPaymentState,
} from '../actions';
import {
  STATUS_LABEL,
  subPaymentStatusValues,
  type SubPaymentStatus,
} from '../schema';

type Option = { id: string; label: string };

export type SubPaymentFormInitialValues = {
  id?: string;
  vendorId: string;
  projectId: string;
  workPeriodStart: string;
  workPeriodEnd: string;
  scopeDescription: string;
  grossAmount: string;
  retainagePercent: string;
  retainageHeld: string;
  paidDate: string;
  status: SubPaymentStatus;
  notes: string;
};

const blankInitial: SubPaymentFormInitialValues = {
  vendorId: '',
  projectId: '',
  workPeriodStart: '',
  workPeriodEnd: '',
  scopeDescription: '',
  grossAmount: '',
  retainagePercent: '0',
  retainageHeld: '',
  paidDate: '',
  status: 'draft',
  notes: '',
};

type Mode = { kind: 'create' } | { kind: 'edit'; id: string };

export function SubPaymentForm({
  mode = { kind: 'create' },
  initial,
  subcontractors,
  projects,
}: {
  mode?: Mode;
  initial?: SubPaymentFormInitialValues;
  subcontractors: Option[];
  projects: Option[];
}) {
  const values = initial ?? blankInitial;
  const isEdit = mode.kind === 'edit';

  const initialState: SubPaymentState = {};
  const [state, formAction, pending] = useActionState(
    isEdit ? updateSubPaymentAction : createSubPaymentAction,
    initialState,
  );
  const err = (key: string) => state.errors?.[key]?.[0];

  // Live retainage preview so the user can see what gross / retainage% /
  // explicit override will resolve to before submitting.
  const [grossInput, setGrossInput] = useState(values.grossAmount);
  const [pctInput, setPctInput] = useState(values.retainagePercent);
  const [heldOverride, setHeldOverride] = useState(values.retainageHeld);

  const preview = useMemo(() => {
    const gross = Number(grossInput) || 0;
    const pct = Number(pctInput) || 0;
    const computedHeld = +(gross * (pct / 100)).toFixed(2);
    const held = heldOverride.trim() === '' ? computedHeld : Number(heldOverride) || 0;
    const net = Math.max(0, +(gross - held).toFixed(2));
    return { gross, held, net };
  }, [grossInput, pctInput, heldOverride]);

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      {isEdit && <input type="hidden" name="id" value={mode.id} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Subcontractor" error={err('vendorId')} required>
          <Select name="vendorId" defaultValue={values.vendorId} required>
            <option value="">— Pick a subcontractor —</option>
            {subcontractors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Project (optional)" error={err('projectId')}>
          <Select name="projectId" defaultValue={values.projectId}>
            <option value="">— Unassigned —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Work period start"
          error={err('workPeriodStart')}
          required
        >
          <Input
            type="date"
            name="workPeriodStart"
            required
            defaultValue={values.workPeriodStart}
          />
        </Field>

        <Field label="Work period end" error={err('workPeriodEnd')} required>
          <Input
            type="date"
            name="workPeriodEnd"
            required
            defaultValue={values.workPeriodEnd}
          />
        </Field>

        <Field
          label="Scope completed"
          error={err('scopeDescription')}
          required
          className="md:col-span-2"
        >
          <textarea
            name="scopeDescription"
            rows={3}
            required
            className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            placeholder="What scope did the subcontractor complete this period?"
            defaultValue={values.scopeDescription}
          />
        </Field>
      </div>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Money
        </legend>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Gross amount" error={err('grossAmount')} required>
            <Input
              type="number"
              step="0.01"
              min="0"
              name="grossAmount"
              required
              value={grossInput}
              onChange={(e) => setGrossInput(e.target.value)}
              placeholder="0.00"
            />
          </Field>

          <Field label="Retainage %" error={err('retainagePercent')}>
            <Input
              type="number"
              step="0.001"
              min="0"
              max="100"
              name="retainagePercent"
              value={pctInput}
              onChange={(e) => setPctInput(e.target.value)}
              placeholder="0"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              e.g. 10 for 10% withheld
            </p>
          </Field>

          <Field
            label="Retainage held (override)"
            error={err('retainageHeld')}
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              name="retainageHeld"
              value={heldOverride}
              onChange={(e) => setHeldOverride(e.target.value)}
              placeholder={preview.gross > 0 ? preview.held.toFixed(2) : 'auto'}
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Leave blank to use gross × retainage %. Adjust downward to record
              a release.
            </p>
          </Field>
        </div>

        {preview.gross > 0 && (
          <div className="rounded-md bg-slate-50 border border-slate-200 px-4 py-3 text-sm space-y-1">
            <div className="flex items-center justify-between tabular-nums">
              <span className="text-slate-600">Gross</span>
              <span className="font-medium">{formatMoney(preview.gross)}</span>
            </div>
            <div className="flex items-center justify-between tabular-nums">
              <span className="text-slate-600">Retainage held</span>
              <span className="text-amber-700">−{formatMoney(preview.held)}</span>
            </div>
            <div className="flex items-center justify-between tabular-nums font-semibold border-t border-slate-200 pt-1">
              <span className="text-slate-700">Net to pay</span>
              <span className="text-emerald-700">{formatMoney(preview.net)}</span>
            </div>
          </div>
        )}
      </fieldset>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Status" error={err('status')}>
          <Select name="status" defaultValue={values.status}>
            {subPaymentStatusValues.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Paid date" error={err('paidDate')}>
          <Input
            type="date"
            name="paidDate"
            defaultValue={values.paidDate}
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Set when status moves to Paid.
          </p>
        </Field>
      </div>

      <Field label="Notes" error={err('notes')}>
        <textarea
          name="notes"
          rows={3}
          className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          placeholder="Check number, lien waiver received, etc."
          defaultValue={values.notes}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending
            ? isEdit
              ? 'Saving…'
              : 'Creating…'
            : isEdit
              ? 'Save changes'
              : 'Add subcontractor payment'}
        </Button>
        <Link href="/payroll?view=subs">
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
