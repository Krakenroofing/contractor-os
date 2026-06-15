'use client';

import { useState } from 'react';
import { Select } from '@/components/ui/select';
import { QuickAddCustomerDrawer } from './quick-add-customer-drawer';
import type { InlineCustomer } from '../actions';

export type CustomerPickerOption = { id: string; name: string };

const ADD_NEW = '__add_new_customer__';

/**
 * Customer dropdown with an inline "+ Add new customer…" row (rendered first).
 * Picking it opens a slide-over create form; the new customer is injected and
 * selected in place, so the surrounding form keeps all its state. Works
 * controlled (pass `value` + `onChange`) or uncontrolled (omit both, give it a
 * `name` to submit via FormData like a plain <Select>).
 */
export function CustomerPicker({
  name,
  value,
  defaultValue = '',
  customers,
  onChange,
  allowNone = true,
  noneLabel = '— no customer —',
  placeholder = 'Select a customer…',
  addLabel = '+ Add new customer…',
  required,
  disabled,
  id,
  className,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  customers: CustomerPickerOption[];
  onChange?: (id: string, customer?: CustomerPickerOption) => void;
  allowNone?: boolean;
  noneLabel?: string;
  placeholder?: string;
  addLabel?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const [localOptions, setLocalOptions] = useState<CustomerPickerOption[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [internal, setInternal] = useState(defaultValue);

  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;

  const merged = [
    ...localOptions,
    ...customers.filter((o) => !localOptions.some((l) => l.id === o.id)),
  ];

  const emit = (id: string, customer?: CustomerPickerOption) => {
    if (!isControlled) setInternal(id);
    onChange?.(id, customer);
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

      <QuickAddCustomerDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreated={(c: InlineCustomer) => {
          const opt: CustomerPickerOption = { id: c.id, name: c.name };
          setLocalOptions((prev) => [opt, ...prev]);
          emit(opt.id, opt);
          setDrawerOpen(false);
        }}
      />
    </>
  );
}
