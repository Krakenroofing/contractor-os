'use client';

import { useEffect, useState, useTransition } from 'react';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createEmployeeInlineAction,
  type InlineEmployee,
} from '../actions';
import { EMPLOYMENT_TYPE_LABEL, employmentTypeValues } from '../schema';

// Slide-over "+ Add new employee" form. Minimal by design — name + employment
// type + optional rate. The full record (NIB #, hire date, etc.) is filled in
// later on the Employees page; this just unblocks logging a timesheet or
// sending an invite without leaving the form.
export function QuickAddEmployeeDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (item: InlineEmployee) => void;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [employmentType, setEmploymentType] = useState<string>('hourly');
  const [payRate, setPayRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setFirstName('');
    setLastName('');
    setEmploymentType('hourly');
    setPayRate('');
    setError(null);
  }, [open]);

  function save() {
    if (firstName.trim() === '' || lastName.trim() === '') {
      setError('First and last name are required.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createEmployeeInlineAction({
        firstName,
        lastName,
        employmentType,
        payRate,
      });
      if (!res.ok) {
        setError(
          res.error ??
            res.errors?.firstName?.[0] ??
            res.errors?.lastName?.[0] ??
            'Could not create the employee.',
        );
        return;
      }
      onCreated(res.item);
      onClose();
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add employee"
      description="Creates the worker and selects them here. Finish their full profile (NIB #, hire date) later on the Employees page."
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>
              First name<span className="ml-0.5 text-red-600">*</span>
            </Label>
            <Input
              value={firstName}
              autoFocus
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              Last name<span className="ml-0.5 text-red-600">*</span>
            </Label>
            <Input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Employment type</Label>
            <Select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value)}
            >
              {employmentTypeValues.map((t) => (
                <option key={t} value={t}>
                  {EMPLOYMENT_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Pay rate (optional)</Label>
            <Input
              value={payRate}
              inputMode="decimal"
              onChange={(e) => setPayRate(e.target.value)}
              placeholder="0.00"
            />
          </div>
        </div>

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
