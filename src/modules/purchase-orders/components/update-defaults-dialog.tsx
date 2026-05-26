'use client';

// Per-PO-line "Update defaults" dialog. When the operator enters a unit
// cost that differs from the standing default, this dialog offers to
// push that cost back to (a) the linked inventory item and/or (b) the
// chosen cost code — with explicit checkbox consent so accidental clicks
// don't rewrite a product's default cost.
//
// Both targets are optional: an unlinked line (no inventory item) hides
// the product checkbox; a missing cost code hides that checkbox.

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { formatMoney } from '@/lib/money';
import { updateInventoryItemDefaultCostAction } from '@/modules/inventory/actions';
import { updateCostCodeDefaultCostAction } from '@/modules/cost-codes/actions';

export function UpdateDefaultsDialog({
  unitCost,
  inventoryItem,
  costCode,
}: {
  /** Current unit cost entered on the PO line (string from the form input). */
  unitCost: string;
  /** Linked inventory item, if any. Null when line is free-text. */
  inventoryItem: {
    id: string;
    name: string;
    currentDefaultCost: number;
  } | null;
  /** Picked cost code on this line. Null when the operator hasn't picked
   *  one yet. */
  costCode: {
    id: string;
    code: string;
    description: string;
    currentDefaultCost: number | null;
  } | null;
}) {
  const [open, setOpen] = useState(false);
  const [savingItem, setSavingItem] = useState(true);
  const [savingCode, setSavingCode] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsedCost = Number(unitCost);
  const validCost = Number.isFinite(parsedCost) && parsedCost > 0;

  // What's actually changing? Hide the dialog button when nothing's pickable.
  const hasItem = inventoryItem !== null;
  const hasCode = costCode !== null;
  const itemDiffers = hasItem && inventoryItem.currentDefaultCost !== parsedCost;
  const codeDiffers =
    hasCode &&
    (costCode.currentDefaultCost ?? 0) !== parsedCost;
  // Only show the button when there's at least one target whose default
  // would change. Saves a useless click.
  const buttonVisible = validCost && (itemDiffers || codeDiffers);

  if (!buttonVisible && !open) return null;

  function onSubmit() {
    if (!validCost) {
      setError('Enter a positive unit cost on this line first.');
      return;
    }
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const updates: string[] = [];
      const errors: string[] = [];

      if (savingItem && hasItem) {
        const res = await updateInventoryItemDefaultCostAction({
          id: inventoryItem.id,
          defaultCost: String(parsedCost),
        });
        if (res.ok) {
          updates.push(inventoryItem.name);
        } else if (res.error) {
          errors.push(`Product: ${res.error}`);
        }
      }
      if (savingCode && hasCode) {
        const res = await updateCostCodeDefaultCostAction({
          id: costCode.id,
          defaultCost: String(parsedCost),
        });
        if (res.ok) {
          updates.push(`${costCode.code} cost code`);
        } else if (res.error) {
          errors.push(`Cost code: ${res.error}`);
        }
      }

      if (errors.length > 0) {
        setError(errors.join(' · '));
      }
      if (updates.length > 0) {
        setSuccess(
          `Saved ${formatMoney(parsedCost)} as default on ${updates.join(' + ')}.`,
        );
        // Close after a moment so the operator sees the confirmation, then
        // server-revalidated form data lands on the next render.
        setTimeout(() => setOpen(false), 1500);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[10px] text-blue-600 hover:underline"
        title={`Save ${formatMoney(parsedCost)} as the new default on the product / cost code`}
      >
        Update defaults
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Update defaults</h2>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-900 text-sm"
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
              {success}
            </div>
          )}

          <p className="text-slate-600">
            Save{' '}
            <span className="font-semibold text-slate-900">
              {formatMoney(parsedCost)}
            </span>{' '}
            as the new default cost on:
          </p>

          {hasItem && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={savingItem}
                onChange={(e) => setSavingItem(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-slate-900">
                  {inventoryItem.name}
                </span>{' '}
                <span className="text-xs text-slate-500">(product)</span>
                <span className="block text-xs text-slate-500">
                  Current default:{' '}
                  {inventoryItem.currentDefaultCost > 0
                    ? formatMoney(inventoryItem.currentDefaultCost)
                    : '—'}
                </span>
              </span>
            </label>
          )}

          {hasCode && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={savingCode}
                onChange={(e) => setSavingCode(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="font-mono text-xs text-slate-700">
                  {costCode.code}
                </span>{' '}
                <span className="font-medium text-slate-900">
                  {costCode.description}
                </span>{' '}
                <span className="text-xs text-slate-500">(cost code)</span>
                <span className="block text-xs text-slate-500">
                  Current default:{' '}
                  {costCode.currentDefaultCost != null && costCode.currentDefaultCost > 0
                    ? formatMoney(costCode.currentDefaultCost)
                    : '—'}
                </span>
              </span>
            </label>
          )}

          {!hasItem && !hasCode && (
            <p className="text-xs text-slate-500">
              No linked product or cost code on this line. Nothing to update.
            </p>
          )}

          <Label className="block">
            <span className="sr-only">New default cost</span>
          </Label>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onSubmit}
              disabled={
                pending ||
                (!savingItem && !savingCode) ||
                (!hasItem && !hasCode)
              }
            >
              {pending ? 'Saving…' : 'Save defaults'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
