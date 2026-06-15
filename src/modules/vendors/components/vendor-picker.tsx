'use client';

import { useState } from 'react';
import { Select } from '@/components/ui/select';
import { QuickAddVendorDrawer } from './quick-add-vendor-drawer';
import type { InlineVendor } from '../actions';

// Superset of the fields the various call sites prefill from the selected
// vendor. Only `id` + `name` are required; the rest are passed through to the
// onChange callback so forms that prefill (receipt cost code, banking GL
// account, vendor VAT rate) keep working — including for a just-created vendor.
export type VendorPickerOption = {
  id: string;
  name: string;
  vatRatePercent?: number | null;
  defaultAccountingAccountId?: string | null;
  defaultCostCodeId?: string | null;
  defaultCostType?: string | null;
};

// Sentinel for the "+ Add new vendor" row. Selecting it opens the quick-add
// drawer instead of choosing a vendor.
const ADD_NEW = '__add_new_vendor__';

/**
 * Vendor dropdown with an inline "+ Add new vendor…" row (rendered first).
 * Picking it opens a slide-over create form; the new vendor is injected into
 * the list and selected in place, so the surrounding form keeps all its state.
 *
 * Works controlled (pass `value` + `onChange`) or uncontrolled (omit both and
 * just give it a `name` to submit via FormData, like a plain <Select>). In
 * uncontrolled mode it still selects a just-created vendor in place. `onChange`
 * receives `(id, vendor?)` where `vendor` is the full picked option (including
 * a just-created one) so callers can prefill dependent fields.
 */
export function VendorPicker({
  name,
  value,
  defaultValue = '',
  vendors,
  onChange,
  allowNone = true,
  noneLabel = '— no vendor —',
  placeholder = 'Select a vendor…',
  addLabel = '+ Add new vendor…',
  required,
  disabled,
  id,
  className,
}: {
  name?: string;
  /** Controlled selected id. Omit for uncontrolled (FormData) usage. */
  value?: string;
  /** Seeds the selection in uncontrolled mode. */
  defaultValue?: string;
  vendors: VendorPickerOption[];
  onChange?: (id: string, vendor?: VendorPickerOption) => void;
  /** When false the empty "no vendor" option is omitted (required pickers). */
  allowNone?: boolean;
  noneLabel?: string;
  /** Shown as the disabled empty row when `allowNone` is false. */
  placeholder?: string;
  addLabel?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const [localOptions, setLocalOptions] = useState<VendorPickerOption[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [internal, setInternal] = useState(defaultValue);

  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;

  // Locally-created vendors first so a just-added one is easy to spot.
  const merged = [
    ...localOptions,
    ...vendors.filter((o) => !localOptions.some((l) => l.id === o.id)),
  ];

  const emit = (id: string, vendor?: VendorPickerOption) => {
    if (!isControlled) setInternal(id);
    onChange?.(id, vendor);
  };

  return (
    <>
      <Select
        id={id}
        name={name}
        value={current}
        required={required}
        disabled={disabled}
        className={className}
        onChange={(e) => {
          const next = e.target.value;
          if (next === ADD_NEW) {
            // Don't change the selection; just open the create drawer.
            setDrawerOpen(true);
            return;
          }
          emit(next, merged.find((o) => o.id === next));
        }}
      >
        <option value={ADD_NEW}>{addLabel}</option>
        {allowNone ? (
          <option value="">{noneLabel}</option>
        ) : (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {merged.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>

      <QuickAddVendorDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreated={(v: InlineVendor) => {
          const opt: VendorPickerOption = {
            id: v.id,
            name: v.name,
            vatRatePercent: v.vatRatePercent,
            defaultAccountingAccountId: v.defaultAccountingAccountId,
            defaultCostCodeId: v.defaultCostCodeId,
            defaultCostType: v.defaultCostType,
          };
          setLocalOptions((prev) => [opt, ...prev]);
          emit(opt.id, opt);
          setDrawerOpen(false);
        }}
      />
    </>
  );
}
