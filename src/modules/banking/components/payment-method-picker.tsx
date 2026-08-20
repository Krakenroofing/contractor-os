'use client';

// Payment-method dropdown with QB-style "add as you go": the list is
// user-managed per company, and a new method can be created inline without
// leaving the form. The custom Select serializes to a hidden input, so this
// works inside native forms.

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { createPaymentMethodAction } from '../actions';

export type PaymentMethodOption = { id: string; name: string };

const ADD_VALUE = '__add_payment_method__';

export function PaymentMethodPicker({
  name,
  value,
  onChange,
  methods,
}: {
  /** Form field name for native serialization. */
  name?: string;
  value: string;
  onChange: (id: string) => void;
  methods: PaymentMethodOption[];
}) {
  const [local, setLocal] = useState<PaymentMethodOption[]>(methods);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function saveNew() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const res = await createPaymentMethodAction({ name: trimmed });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLocal((prev) =>
        prev.some((m) => m.id === res.id)
          ? prev
          : [...prev, { id: res.id, name: res.name }].sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
      );
      onChange(res.id);
      setAdding(false);
      setNewName('');
    });
  }

  if (adding) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                saveNew();
              }
              if (e.key === 'Escape') setAdding(false);
            }}
            placeholder="e.g. Wire, Zelle, Company card"
            className="h-9 text-xs"
          />
          <Button type="button" size="sm" disabled={pending} onClick={saveNew}>
            {pending ? '…' : 'Add'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setAdding(false)}
          >
            ✕
          </Button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <Select
      name={name}
      value={value}
      pinnedValues={[ADD_VALUE]}
      onChange={(e) => {
        if (e.target.value === ADD_VALUE) {
          setNewName(e.query ?? '');
          setAdding(true);
          return;
        }
        onChange(e.target.value);
      }}
    >
      <option value="">— no method —</option>
      {local.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
      <option value={ADD_VALUE}>＋ Add payment method…</option>
    </Select>
  );
}
