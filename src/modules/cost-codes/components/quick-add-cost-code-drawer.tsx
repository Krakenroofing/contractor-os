'use client';

import { useEffect, useState, useTransition } from 'react';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createCostCodeInlineAction,
  type InlineCostCode,
} from '../actions';
import { CATEGORY_LABEL, costCodeCategoryValues } from '../schema';

// Slide-over "+ Add new cost code" form. Lives on top of whatever line-item /
// allocation form opened it; on success it hands the created code back via
// onCreated so the caller can select it on the active row — the rest of the
// form is never touched. Saves to the company's cost-code library.
export function QuickAddCostCodeDrawer({
  open,
  onClose,
  initialCode = '',
  initialDescription = '',
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  initialCode?: string;
  initialDescription?: string;
  onCreated: (item: InlineCostCode) => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [description, setDescription] = useState(initialDescription);
  const [category, setCategory] = useState<string>('material');
  const [defaultCost, setDefaultCost] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reset to the seed values each time the drawer opens for a new row.
  useEffect(() => {
    if (!open) return;
    setCode(initialCode);
    setDescription(initialDescription);
    setCategory('material');
    setDefaultCost('');
    setError(null);
  }, [open, initialCode, initialDescription]);

  function save() {
    if (code.trim() === '') {
      setError('Code is required.');
      return;
    }
    if (description.trim() === '') {
      setError('Name is required.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createCostCodeInlineAction({
        code,
        description,
        category,
        defaultCost,
      });
      if (!res.ok) {
        setError(
          res.error ??
            res.errors?.code?.[0] ??
            res.errors?.description?.[0] ??
            'Could not create the cost code.',
        );
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
      title="Add cost code"
      description="Saves to your cost-code library and selects it on this row. Your other entries are kept."
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>
              Code<span className="ml-0.5 text-red-600">*</span>
            </Label>
            <Input
              value={code}
              autoFocus
              onChange={(e) => setCode(e.target.value)}
              placeholder="07-500"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {costCodeCategoryValues.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>
            Name / description<span className="ml-0.5 text-red-600">*</span>
          </Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Roof tear-off & disposal"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Default cost (optional)</Label>
          <Input
            value={defaultCost}
            inputMode="decimal"
            onChange={(e) => setDefaultCost(e.target.value)}
            placeholder="0.00"
          />
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
