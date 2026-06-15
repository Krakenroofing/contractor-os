'use client';

import { useEffect, useState, useTransition } from 'react';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { createVendorInlineAction, type InlineVendor } from '../actions';
import { TYPE_LABEL, vendorTypeValues, type VendorType } from '../schema';

// Slide-over "+ Add new vendor" form. Sits on top of whatever form opened it;
// on success it hands the created vendor back via onCreated so the caller can
// select it in place — the rest of the form is never touched. Minimal by
// design (name + type); other vendor fields are set later on /vendors.
export function QuickAddVendorDrawer({
  open,
  onClose,
  initialName = '',
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  initialName?: string;
  onCreated: (vendor: InlineVendor) => void;
}) {
  const [name, setName] = useState(initialName);
  const [vendorType, setVendorType] = useState<VendorType>('supplier');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reset to the seed values each time the drawer opens.
  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setVendorType('supplier');
    setError(null);
  }, [open, initialName]);

  function save() {
    if (name.trim() === '') {
      setError('Vendor name is required.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createVendorInlineAction({ name, vendorType });
      if (!res.ok) {
        setError(res.error ?? res.errors?.name?.[0] ?? 'Could not create the vendor.');
        return;
      }
      onCreated(res.vendor);
      onClose();
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add vendor"
      description="Saves to your vendor list and selects it here. Your other entries are kept."
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <Label>
            Vendor name<span className="ml-0.5 text-red-600">*</span>
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
            placeholder="Western Hardware & Lumber"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select
            value={vendorType}
            onChange={(e) => setVendorType(e.target.value as VendorType)}
          >
            {vendorTypeValues.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>

        <p className="text-xs text-slate-500">
          You can add contact, address, VAT rate, and default cost
          code/category later from the vendor&apos;s page.
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
