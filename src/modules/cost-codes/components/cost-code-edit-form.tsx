'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { updateCostCodeAction, type UpdateCostCodeState } from '../actions';
import { CATEGORY_LABEL, costCodeCategoryValues, type CostCodeCategory } from '../schema';
import { COST_CODE_DIVISIONS } from '@/lib/data/cost-code-defaults';

const initialState: UpdateCostCodeState = {};

export function CostCodeEditForm({
  id,
  defaults,
}: {
  id: string;
  defaults: {
    description: string;
    category: CostCodeCategory;
    division: string | null;
    sortOrder: number;
    notes: string | null;
  };
}) {
  const action = updateCostCodeAction.bind(null, id);
  const [state, formAction, pending] = useActionState(action, initialState);
  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form action={formAction} className="space-y-4">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}
      {state.ok && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          Saved.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Name" error={err('description')} className="md:col-span-2" required>
          <Input name="description" defaultValue={defaults.description} required />
        </Field>

        <Field label="Category" error={err('category')} required>
          <Select name="category" defaultValue={defaults.category} required>
            {costCodeCategoryValues.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Division" error={err('division')}>
          <Select name="division" defaultValue={defaults.division ?? ''}>
            <option value="">— None —</option>
            {COST_CODE_DIVISIONS.map((d) => (
              <option key={d.code} value={d.code}>
                {d.code} — {d.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Sort order" error={err('sortOrder')}>
          <Input
            name="sortOrder"
            type="number"
            inputMode="numeric"
            defaultValue={defaults.sortOrder}
          />
        </Field>

        <Field label="Notes" error={err('notes')} className="md:col-span-2">
          <Input name="notes" defaultValue={defaults.notes ?? ''} />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
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
