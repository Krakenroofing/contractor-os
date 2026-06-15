'use client';

import { useEffect, useState, useTransition } from 'react';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  CustomerPicker,
  type CustomerPickerOption,
} from '@/modules/customers/components/customer-picker';
import { createProjectInlineAction, type InlineProject } from '../actions';
import { projectStatusValues } from '../schema';

const STATUS_LABEL: Record<string, string> = {
  lead: 'Lead',
  estimating: 'Estimating',
  won: 'Won',
  in_progress: 'In progress',
  closed: 'Closed',
  lost: 'Lost',
};

// Slide-over "+ Add new project" form. A project needs a customer (NOT NULL
// FK), so this nests a CustomerPicker — which itself can create a customer
// inline. Financials default to 0 and are set later on the project page.
export function QuickAddProjectDrawer({
  open,
  onClose,
  initialName = '',
  customers,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  initialName?: string;
  customers: CustomerPickerOption[];
  onCreated: (project: InlineProject) => void;
}) {
  const [name, setName] = useState(initialName);
  const [customerId, setCustomerId] = useState('');
  const [status, setStatus] = useState('lead');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setCustomerId('');
    setStatus('lead');
    setError(null);
  }, [open, initialName]);

  function save() {
    if (name.trim() === '') {
      setError('Project name is required.');
      return;
    }
    if (customerId === '') {
      setError('Pick a customer for this project.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createProjectInlineAction({ name, customerId, status });
      if (!res.ok) {
        setError(res.error ?? 'Could not create the project.');
        return;
      }
      onCreated(res.project);
      onClose();
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add project"
      description="Saves to your projects and selects it here. Your other entries are kept."
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <Label>
            Project name<span className="ml-0.5 text-red-600">*</span>
          </Label>
          <Input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="The Lodge — Capstone"
          />
        </div>

        <div className="space-y-1.5">
          <Label>
            Customer<span className="ml-0.5 text-red-600">*</span>
          </Label>
          <CustomerPicker
            value={customerId}
            customers={customers}
            allowNone={false}
            placeholder="Pick a customer"
            onChange={(id) => setCustomerId(id)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {projectStatusValues.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s] ?? s}
              </option>
            ))}
          </Select>
        </div>

        <p className="text-xs text-slate-500">
          Contract value, jobsite address, and dates can be added later on the
          project&apos;s page.
        </p>

        <div className="flex items-center gap-2 pt-2">
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Add & select'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
