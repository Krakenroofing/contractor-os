'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createInventoryItemAction,
  updateInventoryItemAction,
  type InventoryItemState,
} from '../actions';

type Option = { id: string; label: string };

export type ProductFormInitialValues = {
  id?: string;
  name: string;
  category: string;
  sku: string;
  unit: string;
  defaultCost: string;
  defaultCostCodeId: string;
  isTaxable: 'yes' | 'no';
  qbGlAccountText: string;
  notes: string;
};

const blankInitial: ProductFormInitialValues = {
  name: '',
  category: '',
  sku: '',
  unit: '',
  defaultCost: '0',
  defaultCostCodeId: '',
  isTaxable: 'yes',
  qbGlAccountText: '',
  notes: '',
};

type Mode = { kind: 'create' } | { kind: 'edit'; id: string };

export function ProductForm({
  mode = { kind: 'create' },
  initial,
  costCodes = [],
}: {
  mode?: Mode;
  initial?: ProductFormInitialValues;
  costCodes?: Option[];
}) {
  const values = initial ?? blankInitial;
  const isEdit = mode.kind === 'edit';
  const initialState: InventoryItemState = {};
  const [state, formAction, pending] = useActionState(
    isEdit ? updateInventoryItemAction : createInventoryItemAction,
    initialState,
  );
  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      {isEdit && <input type="hidden" name="id" value={mode.id} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Product name" error={err('name')} required className="md:col-span-2">
          <Input name="name" required defaultValue={values.name} />
        </Field>

        <Field label="Category" error={err('category')}>
          <Input
            name="category"
            placeholder="02 Site Work"
            defaultValue={values.category}
          />
        </Field>

        <Field label="SKU" error={err('sku')}>
          <Input name="sku" defaultValue={values.sku} />
        </Field>

        <Field label="Unit" error={err('unit')}>
          <Input name="unit" placeholder="ea / box / lb" defaultValue={values.unit} />
        </Field>

        <Field label="Default cost" error={err('defaultCost')}>
          <Input
            name="defaultCost"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={values.defaultCost}
          />
        </Field>

        <Field label="Default cost code" error={err('defaultCostCodeId')}>
          <Select name="defaultCostCodeId" defaultValue={values.defaultCostCodeId}>
            <option value="">— None —</option>
            {costCodes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Taxable" error={err('isTaxable')}>
          <Select name="isTaxable" defaultValue={values.isTaxable}>
            <option value="yes">Taxable</option>
            <option value="no">Exempt</option>
          </Select>
        </Field>

        <Field
          label="QuickBooks expense account (reference)"
          error={err('qbGlAccountText')}
          className="md:col-span-2"
        >
          <Input
            name="qbGlAccountText"
            placeholder="50400 Materials Costs"
            defaultValue={values.qbGlAccountText}
          />
        </Field>

        <Field label="Notes" error={err('notes')} className="md:col-span-2">
          <textarea
            name="notes"
            rows={3}
            defaultValue={values.notes}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {isEdit ? 'Save changes' : 'Create product'}
        </Button>
        <Link href={isEdit ? `/inventory/${mode.id}` : '/inventory'}>
          <Button type="button" variant="outline">
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
