'use client';

import { useEffect, useState, useTransition } from 'react';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createCustomerInlineAction,
  type InlineCustomer,
} from '../actions';
import { customerTypeValues, type CustomerType } from '../schema';

const TYPE_LABEL: Record<CustomerType, string> = {
  residential: 'Residential',
  commercial: 'Commercial',
};

// Slide-over "+ Add new customer" form. Hands the created customer back via
// onCreated so the caller can select it in place — the rest of the form is
// untouched. Minimal (name + type); other fields are set later on /customers.
export function QuickAddCustomerDrawer({
  open,
  onClose,
  initialName = '',
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  initialName?: string;
  onCreated: (customer: InlineCustomer) => void;
}) {
  const [name, setName] = useState(initialName);
  const [customerType, setCustomerType] = useState<CustomerType>('residential');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setCustomerType('residential');
    setError(null);
  }, [open, initialName]);

  function save() {
    if (name.trim() === '') {
      setError('Customer name is required.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createCustomerInlineAction({ name, customerType });
      if (!res.ok) {
        setError(res.error ?? res.errors?.name?.[0] ?? 'Could not create the customer.');
        return;
      }
      onCreated(res.customer);
      onClose();
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add customer"
      description="Saves to your customer list and selects it here. Your other entries are kept."
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <Label>
            Customer name<span className="ml-0.5 text-red-600">*</span>
          </Label>
          <Input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                save();
              }
            }}
            placeholder="Capstone Developments Ltd."
          />
        </div>

        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select
            value={customerType}
            onChange={(e) => setCustomerType(e.target.value as CustomerType)}
          >
            {customerTypeValues.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>

        <p className="text-xs text-slate-500">
          You can add contact, billing address, and TIN later from the
          customer&apos;s page.
        </p>

        <div className="flex items-center gap-2 pt-2">
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Add & select'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
