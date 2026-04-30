'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { createCostCodeAction, type CreateCostCodeState } from '../actions';
import { CATEGORY_LABEL, costCodeCategoryValues } from '../schema';

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
          <Input name="code" placeholder="01-100" required />
        </Field>

        <Field label="Category" error={err('category')} required>
          <Select name="category" defaultValue="labor" required>
            {costCodeCategoryValues.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
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
          <Input name="description" placeholder="Roof Tear-Off" required />
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
