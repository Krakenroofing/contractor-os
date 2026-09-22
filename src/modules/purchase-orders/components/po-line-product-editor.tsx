'use client';

// Inline product link on the PO detail page — works on received POs too,
// unlike the Edit form. Chris organizes the item catalog after orders have
// shipped, so the link has to be settable after the fact; the action
// backfills stock movements for quantities already received.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  ProductPicker,
  type ProductPickerOption,
} from '@/modules/inventory/components/product-picker';
import { setPoLineProductAction } from '../actions';

export function PoLineProductEditor({
  poId,
  lineId,
  itemId,
  itemName,
  description,
  products,
}: {
  poId: string;
  lineId: string;
  itemId: string;
  itemName: string | null;
  /** Line description — seeds the quick-add form when creating a product. */
  description: string;
  products: ProductPickerOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(itemId);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    startTransition(async () => {
      setError(null);
      const res = await setPoLineProductAction({
        poId,
        lineId,
        inventoryItemId: value || null,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="group inline-flex items-center gap-1 text-left"
        title={
          itemName
            ? 'Change the linked product'
            : 'Link this line to a product in the inventory catalog'
        }
        onClick={() => {
          setValue(itemId);
          setEditing(true);
        }}
      >
        {itemName ? (
          <span className="text-slate-700">{itemName}</span>
        ) : (
          <span className="text-slate-400">+ Link product</span>
        )}
        <span className="text-slate-400 opacity-0 group-hover:opacity-100">
          ✎
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1 min-w-[220px]">
      <ProductPicker
        value={value}
        options={products}
        defaultNewName={description}
        onItemSelected={(picked) => setValue(picked?.id ?? '')}
      />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
