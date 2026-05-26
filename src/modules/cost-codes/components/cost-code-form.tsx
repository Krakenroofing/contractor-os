'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { createCostCodeAction, type CreateCostCodeState } from '../actions';
import { CATEGORY_LABEL, costCodeCategoryValues } from '../schema';
import { COST_CODE_DIVISIONS } from '@/lib/data/cost-code-defaults';

const initialState: CreateCostCodeState = {};

export function CostCodeForm() {
  const [state, formAction, pending] = useActionState(createCostCodeAction, initialState);
  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Code" error={err('code')} required>
          <Input name="code" placeholder="07-5400-TPO" required />
        </Field>

        <Field label="Division" error={err('division')}>
          <Select name="division" defaultValue="">
            <option value="">— None —</option>
            {COST_CODE_DIVISIONS.map((d) => (
              <option key={d.code} value={d.code}>
                {d.code} — {d.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Name"
          error={err('description')}
          className="md:col-span-2"
          required
        >
          <Input name="description" placeholder="TPO Membrane" required />
        </Field>

        <Field label="Category" error={err('category')} required>
          <Select name="category" defaultValue="material" required>
            {costCodeCategoryValues.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Sort order" error={err('sortOrder')}>
          <Input
            name="sortOrder"
            type="number"
            inputMode="numeric"
            placeholder="0"
            defaultValue="0"
          />
        </Field>

        <Field
          label="Default cost (optional)"
          error={err('defaultCost')}
        >
          <Input
            name="defaultCost"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            placeholder="e.g. 12.50 — leave blank when no standing rate"
          />
        </Field>

        <Field label="Notes" error={err('notes')} className="md:col-span-2">
          <Input name="notes" placeholder="Optional notes for estimators" />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create cost code'}
        </Button>
        <Link href="/cost-codes">
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
