'use client';

import { useState } from 'react';
import { Select } from '@/components/ui/select';
import { QuickAddProductDrawer } from './quick-add-product-drawer';

export type ProductPickerOption = {
  id: string;
  name: string;
  category: string | null;
  sku: string | null;
  unit: string | null;
  defaultCost: number;
  // Phase 6.2: surfaced so the Excel/PDF upload dialogs can pre-fill the
  // matched line's cost code. The picker itself ignores this field.
  defaultCostCodeId?: string | null;
};

export type SelectedProduct = {
  id: string;
  name: string;
  unit: string | null;
  defaultCost: number;
};

// Sentinel value for the "+ Add new product" row. Selecting it opens the
// quick-add drawer instead of choosing a product.
const ADD_NEW = '__add_new_product__';

// Searchable product dropdown that fires onItemSelected when the operator
// picks something — the parent line form uses that to prefill description,
// unit, and unitCost. Empty value means "no product / free-text line."
//
// The underlying Select already supports typeahead by typing into its
// trigger, so we just feed it <option> children.
//
// "+ Add new product" opens a slide-over create form; the new item is added
// to the dropdown and selected in place, so the parent form keeps all its
// other state (no navigation away to /inventory/new and back).
export function ProductPicker({
  name,
  value,
  options,
  disabled,
  onItemSelected,
  placeholder = '— Search product —',
  defaultNewName = '',
}: {
  name?: string;
  value: string;
  options: ProductPickerOption[];
  disabled?: boolean;
  onItemSelected?: (item: SelectedProduct | null) => void;
  placeholder?: string;
  /** Seeds the quick-add form's name (typically the line description). */
  defaultNewName?: string;
}) {
  const [localOptions, setLocalOptions] = useState<ProductPickerOption[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Name typed into the dropdown's filter when "+ Add new product…" was
  // clicked — that's the product they wanted, so seed the create form with it.
  const [typedName, setTypedName] = useState('');

  // Locally-created items first so a just-added product is easy to spot.
  const merged = [
    ...localOptions,
    ...options.filter((o) => !localOptions.some((l) => l.id === o.id)),
  ];

  return (
    <>
      <Select
        name={name}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        // Keep "+ Add new product…" visible even after typing a name that
        // matches no existing product — the moment you most want to add one.
        pinnedValues={[ADD_NEW]}
        onChange={(e) => {
          const next = e.target.value;
          if (next === ADD_NEW) {
            // Don't change the selection; just open the create drawer,
            // seeded with whatever was typed in the search box.
            setTypedName(e.query?.trim() ?? '');
            setDrawerOpen(true);
            return;
          }
          if (!onItemSelected) return;
          if (next === '') {
            onItemSelected(null);
            return;
          }
          const picked = merged.find((o) => o.id === next);
          if (picked) {
            onItemSelected({
              id: picked.id,
              name: picked.name,
              unit: picked.unit,
              defaultCost: picked.defaultCost,
            });
          }
        }}
      >
        <option value="">— Free text —</option>
        {/* Kept at the top (not buried under the whole catalog) so adding a
            product is discoverable without scrolling hundreds of rows. */}
        <option value={ADD_NEW}>+ Add new product…</option>
        {merged.map((o) => (
          <option key={o.id} value={o.id}>
            {[o.category, o.name].filter(Boolean).join(' • ')}
            {o.sku ? ` (${o.sku})` : ''}
          </option>
        ))}
      </Select>

      <QuickAddProductDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        initialName={typedName || defaultNewName}
        onCreated={(item) => {
          setLocalOptions((prev) => [
            {
              id: item.id,
              name: item.name,
              category: item.category,
              sku: item.sku,
              unit: item.unit,
              defaultCost: item.defaultCost,
              defaultCostCodeId: item.defaultCostCodeId,
            },
            ...prev,
          ]);
          onItemSelected?.({
            id: item.id,
            name: item.name,
            unit: item.unit,
            defaultCost: item.defaultCost,
          });
        }}
      />
    </>
  );
}
