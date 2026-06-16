'use client';

import { useState } from 'react';
import { Select } from '@/components/ui/select';
import { QuickAddEmployeeDrawer } from './quick-add-employee-drawer';
import type { InlineEmployee } from '../actions';
import type { EmploymentType } from '../schema';

export type EmployeePickerOption = {
  id: string;
  label: string;
  employmentType?: EmploymentType;
};

const ADD_NEW = '__add_new_employee__';

/**
 * Employee dropdown with an inline "+ Add new employee…" row. Picking it opens
 * a slide-over create form; the new employee is injected and selected in place.
 * Works controlled (value + onChange) or uncontrolled (name + defaultValue),
 * mirroring VendorPicker. `onChange` receives `(id, employee?)` so callers can
 * react to the selection (e.g. pay-basis hints).
 */
export function EmployeePicker({
  name,
  value,
  defaultValue = '',
  employees,
  onChange,
  allowNone = true,
  noneLabel = '— Pick an employee —',
  placeholder = '— Pick an employee —',
  addLabel = '+ Add new employee…',
  required,
  disabled,
  id,
  className,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  employees: EmployeePickerOption[];
  onChange?: (id: string, employee?: EmployeePickerOption) => void;
  allowNone?: boolean;
  noneLabel?: string;
  placeholder?: string;
  addLabel?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const [localOptions, setLocalOptions] = useState<EmployeePickerOption[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [internal, setInternal] = useState(defaultValue);

  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;

  const merged = [
    ...localOptions,
    ...employees.filter((o) => !localOptions.some((l) => l.id === o.id)),
  ];

  const emit = (id: string, employee?: EmployeePickerOption) => {
    if (!isControlled) setInternal(id);
    onChange?.(id, employee);
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
            {o.label}
          </option>
        ))}
      </Select>

      <QuickAddEmployeeDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreated={(item: InlineEmployee) => {
          const opt: EmployeePickerOption = {
            id: item.id,
            label: item.label,
            employmentType: item.employmentType,
          };
          setLocalOptions((prev) => [opt, ...prev]);
          emit(opt.id, opt);
          setDrawerOpen(false);
        }}
      />
    </>
  );
}
