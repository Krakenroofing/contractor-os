'use client';

import { useEffect, useState, useTransition } from 'react';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createInventoryItemInlineAction,
  type InlineProduct,
} from '../actions';

// Slide-over "+ Add new product" form. Lives on top of whatever line-item
// form opened it; on success it hands the created item back via onCreated so
// the caller can select it on the active line — the rest of the form is never
// touched. Kept intentionally minimal (no cost code / GL — set those later on
// the inventory page); the line already carries its own cost code.
export function QuickAddProductDrawer({
  open,
  onClose,
  initialName = '',
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  initialName?: string;
  onCreated: (item: InlineProduct) => void;
}) {
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('');
  const [defaultCost, setDefaultCost] = useState('0');
  const [isTaxable, setIsTaxable] = useState<'yes' | 'no'>('yes');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reset to the seed values each time the drawer opens for a new line.
  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setCategory('');
    setSku('');
    setUnit('');
    setDefaultCost('0');
    setIsTaxable('yes');
    setError(null);
  }, [open, initialName]);

  function save() {
    if (name.trim() === '') {
      setError('Product name is required.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createInventoryItemInlineAction({
        name,
        category,
        sku,
        unit,
        defaultCost,
        isTaxable,
      });
      if (!res.ok) {
        setError(res.error ?? res.errors?.name?.[0] ?? 'Could not create the product.');
        return;
      }
      onCreated(res.item);
      onClose();
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add product to inventory"
      description="Saves to your catalog and selects it on this line. Your other entries are kept."
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <Label>
            Product name<span className="ml-0.5 text-red-600">*</span>
          </Label>
          <Input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="CSI TPO 060 10x100 White Reinforced"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="07 Roofing"
            />
          </div>
          <div className="space-y-1.5">
            <Label>SKU</Label>
            <Input value={sku} onChange={(e) => setSku(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Unit</Label>
            <Input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="ea / box / roll"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Default cost</Label>
            <Input
              value={defaultCost}
              inputMode="decimal"
              onChange={(e) => setDefaultCost(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>Taxable</Label>
            <Select
              value={isTaxable}
              onChange={(e) => setIsTaxable(e.target.value as 'yes' | 'no')}
            >
              <option value="yes">Taxable</option>
              <option value="no">Exempt</option>
            </Select>
          </div>
        </div>

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
