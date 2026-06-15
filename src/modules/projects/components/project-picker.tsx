'use client';

import { useState } from 'react';
import { Select } from '@/components/ui/select';
import type { CustomerPickerOption } from '@/modules/customers/components/customer-picker';
import { QuickAddProjectDrawer } from './quick-add-project-drawer';
import type { InlineProject } from '../actions';

export type ProjectPickerOption = { id: string; name: string };

const ADD_NEW = '__add_new_project__';

/**
 * Project dropdown with an inline "+ Add new project…" row (rendered first).
 * Picking it opens a slide-over create form (which collects the required
 * customer); the new project is injected and selected in place. Works
 * controlled (pass `value` + `onChange`) or uncontrolled (omit both, give a
 * `name` to submit via FormData). `customers` feeds the quick-add drawer.
 */
export function ProjectPicker({
  name,
  value,
  defaultValue = '',
  projects,
  customers,
  onChange,
  allowNone = true,
  noneLabel = '— no project —',
  placeholder = 'Select a project…',
  addLabel = '+ Add new project…',
  required,
  disabled,
  id,
  className,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  projects: ProjectPickerOption[];
  customers: CustomerPickerOption[];
  onChange?: (id: string, project?: ProjectPickerOption) => void;
  allowNone?: boolean;
  noneLabel?: string;
  placeholder?: string;
  addLabel?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const [localOptions, setLocalOptions] = useState<ProjectPickerOption[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [internal, setInternal] = useState(defaultValue);

  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;

  const merged = [
    ...localOptions,
    ...projects.filter((o) => !localOptions.some((l) => l.id === o.id)),
  ];

  const emit = (id: string, project?: ProjectPickerOption) => {
    if (!isControlled) setInternal(id);
    onChange?.(id, project);
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

      <QuickAddProjectDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        customers={customers}
        onCreated={(p: InlineProject) => {
          const opt: ProjectPickerOption = { id: p.id, name: p.name };
          setLocalOptions((prev) => [opt, ...prev]);
          emit(opt.id, opt);
          setDrawerOpen(false);
        }}
      />
    </>
  );
}
