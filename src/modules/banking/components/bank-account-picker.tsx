'use client';

import { useState } from 'react';
import { Select } from '@/components/ui/select';
import { QuickAddBankAccountDrawer } from './quick-add-bank-account-drawer';
import type { InlineBankAccount } from '../actions';

// Superset of the option shapes used by the consuming forms: some pass
// {id,label}, the statement-upload form passes {id,name,type,last4}. The
// picker renders `label` when present, otherwise composes name (+ type/last4).
export type BankAccountPickerOption = {
  id: string;
  label?: string;
  name?: string;
  type?: 'bank' | 'credit_card';
  last4?: string | null;
};

const ADD_NEW = '__add_new_bank_account__';

function renderLabel(o: BankAccountPickerOption): string {
  if (o.label && o.label.trim() !== '') return o.label;
  const base = o.name ?? '';
  return `${base}${o.last4 ? ` (****${o.last4})` : ''}`;
}

/**
 * Bank/credit-card account dropdown with an inline "+ Add new bank account…"
 * row. Picking it opens a slide-over create form (which also creates the
 * paired chart-of-accounts row); the new account is injected and selected in
 * place. Works controlled (value + onChange) or uncontrolled (name +
 * defaultValue), mirroring VendorPicker.
 */
export function BankAccountPicker({
  name,
  value,
  defaultValue = '',
  accounts,
  onChange,
  allowNone = true,
  noneLabel = '— none —',
  placeholder = 'Select an account…',
  addLabel = '+ Add new bank account…',
  required,
  disabled,
  id,
  className,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  accounts: BankAccountPickerOption[];
  onChange?: (id: string, account?: BankAccountPickerOption) => void;
  allowNone?: boolean;
  noneLabel?: string;
  placeholder?: string;
  addLabel?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const [localOptions, setLocalOptions] = useState<BankAccountPickerOption[]>(
    [],
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [internal, setInternal] = useState(defaultValue);

  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;

  const merged = [
    ...localOptions,
    ...accounts.filter((o) => !localOptions.some((l) => l.id === o.id)),
  ];

  const emit = (id: string, account?: BankAccountPickerOption) => {
    if (!isControlled) setInternal(id);
    onChange?.(id, account);
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
            {renderLabel(o)}
          </option>
        ))}
      </Select>

      <QuickAddBankAccountDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreated={(item: InlineBankAccount) => {
          const opt: BankAccountPickerOption = {
            id: item.id,
            label: item.label,
            name: item.name,
            type: item.type,
            last4: item.last4,
          };
          setLocalOptions((prev) => [opt, ...prev]);
          emit(opt.id, opt);
          setDrawerOpen(false);
        }}
      />
    </>
  );
}
