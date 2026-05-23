'use client';

import { Select } from '@/components/ui/select';

export type ProductPickerOption = {
  id: string;
  name: string;
  category: string | null;
  sku: string | null;
  unit: string | null;
  defaultCost: number;
};

export type SelectedProduct = {
  id: string;
  name: string;
  unit: string | null;
  defaultCost: number;
};

// Searchable product dropdown that fires onItemSelected when the operator
// picks something — the parent line form uses that to prefill description,
// unit, and unitCost. Empty value means "no product / free-text line."
//
// The underlying Select already supports typeahead by typing into its
// trigger, so we just feed it <option> children.
export function ProductPicker({
  name,
  value,
  options,
  disabled,
  onItemSelected,
  placeholder = '— Search product —',
}: {
  name?: string;
  value: string;
  options: ProductPickerOption[];
  disabled?: boolean;
  onItemSelected?: (item: SelectedProduct | null) => void;
  placeholder?: string;
}) {
  return (
    <Select
      name={name}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value;
        if (!onItemSelected) return;
        if (next === '') {
          onItemSelected(null);
          return;
        }
        const picked = options.find((o) => o.id === next);
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
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {[o.category, o.name].filter(Boolean).join(' • ')}
          {o.sku ? ` (${o.sku})` : ''}
        </option>
      ))}
    </Select>
  );
}
