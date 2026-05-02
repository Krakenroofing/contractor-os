'use client';

// Tiny shared scaffolding used by every backfill mini-form. Renders a
// success/error banner, a labeled-field wrapper, and a submit button.
//
// Each step's form is a simple HTML form using `useActionState` against the
// matching backfill action. This shell keeps the per-step forms terse.

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { ReactNode } from 'react';

export type FormShellState = {
  ok?: boolean;
  errors?: Record<string, string[]>;
  formError?: string;
};

export function FormShell({
  state,
  pending,
  submitLabel,
  children,
}: {
  state: FormShellState;
  pending: boolean;
  submitLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.formError}
        </div>
      )}
      {state.ok && !state.formError && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
          ✓ Saved. Add another below or move to the next step.
        </div>
      )}

      {children}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </div>
  );
}

export function Field({
  label,
  error,
  required,
  className,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <Label>
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
