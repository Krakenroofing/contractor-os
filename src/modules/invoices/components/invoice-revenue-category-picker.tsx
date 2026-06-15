'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AccountingAccountPicker,
  type AccountingAccountOption,
} from '@/modules/accounting/components/accounting-account-picker';
import { setInvoiceRevenueCategoryAction } from '../actions';

// Inline revenue-category picker for the invoice detail page. Sets the
// income-rollup account that this invoice's revenue lands under on the P&L
// (revenue by service type). Auto-saves on change.
export function InvoiceRevenueCategoryPicker({
  invoiceId,
  current,
  accounts,
  canEdit,
}: {
  invoiceId: string;
  current: string;
  accounts: AccountingAccountOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function change(next: string) {
    setValue(next);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await setInvoiceRevenueCategoryAction({
        invoiceId,
        accountingAccountId: next || null,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not save.');
        setValue(current);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <AccountingAccountPicker
        value={value}
        onChange={change}
        accounts={accounts}
        placeholder="— uncategorized —"
        disabled={!canEdit || pending}
      />
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : saved ? (
        <p className="text-xs text-emerald-700">Saved.</p>
      ) : null}
    </div>
  );
}
