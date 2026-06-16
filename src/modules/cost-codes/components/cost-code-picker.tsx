'use client';

import { useState } from 'react';
import { Select } from '@/components/ui/select';
import { QuickAddCostCodeDrawer } from './quick-add-cost-code-drawer';
import type { InlineCostCode } from '../actions';

// Option shape is a superset so callers can keep passing whatever they
// already build: line-item forms pass {id,code,description}; allocation /
// payroll forms pass {id,label}. The picker renders `label` when present,
// otherwise "code — description".
export type CostCodePickerOption = {
  id: string;
  code?: string;
  description?: string;
  label?: string;
  defaultCost?: number | null;
};

// Sentinel for the "+ Add new cost code" row. Selecting it opens the
// quick-add drawer instead of choosing a code.
const ADD_NEW = '__add_new_cost_code__';

function renderLabel(o: CostCodePickerOption): string {
  if (o.label && o.label.trim() !== '') return o.label;
  return [o.code, o.description].filter(Boolean).join(' — ');
}

// Cost-code dropdown with an inline "+ Add new cost code…" that opens a
// slide-over create form. The new code is added to the dropdown and selected
// in place, so the parent form keeps all its other state (no navigating away
// to /cost-codes/new and back).
//
// Works controlled (pass `value` + `onValueChange`) or uncontrolled (omit
// `value`, optionally seed with `defaultValue`, and submit via FormData with
// `name=`) — mirroring VendorPicker.
export function CostCodePicker({
  name,
  value,
  defaultValue = '',
  options,
  disabled,
  required,
  className,
  placeholder = 'Select code',
  emptyLabel,
  onValueChange,
  onItemSelected,
  onCreated,
  seedDescription = '',
}: {
  name?: string;
  /** Controlled selected id. Omit for uncontrolled (FormData) usage. */
  value?: string;
  /** Seeds the selection in uncontrolled mode. */
  defaultValue?: string;
  options: CostCodePickerOption[];
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** Text for the placeholder row. Disabled (non-selectable) when required. */
  placeholder?: string;
  /** When set, renders a selectable empty row (e.g. "— None —"). */
  emptyLabel?: string;
  onValueChange?: (id: string) => void;
  onItemSelected?: (item: CostCodePickerOption | null) => void;
  /** Lets a multi-line parent capture a newly-created code so it can surface
   *  it on sibling rows too. The picker already selects it on this row. */
  onCreated?: (item: InlineCostCode) => void;
  /** Seeds the quick-add form's name field (typically the row description). */
  seedDescription?: string;
}) {
  const [localOptions, setLocalOptions] = useState<CostCodePickerOption[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [internal, setInternal] = useState(defaultValue);

  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;

  // Locally-created codes first so a just-added one is easy to spot. Deduped
  // against the incoming options (a parent may also have merged it in).
  const merged = [
    ...localOptions,
    ...options.filter((o) => !localOptions.some((l) => l.id === o.id)),
  ];

  const emit = (next: string) => {
    if (!isControlled) setInternal(next);
    onValueChange?.(next);
    if (onItemSelected) {
      if (next === '') onItemSelected(null);
      else {
        const picked = merged.find((o) => o.id === next);
        if (picked) onItemSelected(picked);
      }
    }
  };

  return (
    <>
      <Select
        name={name}
        value={current}
        disabled={disabled}
        required={required}
        className={className}
        onChange={(e) => {
          const next = e.target.value;
          if (next === ADD_NEW) {
            // Don't change the selection; just open the create drawer.
            setDrawerOpen(true);
            return;
          }
          emit(next);
        }}
      >
        {emptyLabel !== undefined ? (
          <option value="">{emptyLabel}</option>
        ) : (
          <option value="" disabled={required}>
            {placeholder}
          </option>
        )}
        {merged.map((o) => (
          <option key={o.id} value={o.id}>
            {renderLabel(o)}
          </option>
        ))}
        <option value={ADD_NEW}>+ Add new cost code…</option>
      </Select>

      <QuickAddCostCodeDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        initialDescription={seedDescription}
        onCreated={(item) => {
          const opt: CostCodePickerOption = {
            id: item.id,
            code: item.code,
            description: item.description,
            label: item.label,
            defaultCost: item.defaultCost,
          };
          setLocalOptions((prev) => [opt, ...prev]);
          if (!isControlled) setInternal(item.id);
          onValueChange?.(item.id);
          onItemSelected?.(opt);
          onCreated?.(item);
        }}
      />
    </>
  );
}
