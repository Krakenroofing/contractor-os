'use client';

// Inline expense re-categorization for the P&L cost drill-down. Picking a new
// category moves this job cost entry to another P&L line (COGS/OpEx) without a
// void + re-post; the row then drops off the current category's list.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AccountingAccountPicker } from '@/modules/accounting/components/accounting-account-picker';
import type { AccountingAccountOption } from '@/modules/accounting/lib/account-options';
import { recategorizeJobCostEntryAction } from '@/modules/job-costing/actions';

export function RecategorizeCell({
  entryId,
  currentAccountId,
  accounts,
}: {
  entryId: string;
  currentAccountId: string;
  accounts: AccountingAccountOption[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentAccountId);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(next: string) {
    if (next === '' || next === value) return;
    const prev = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await recategorizeJobCostEntryAction(entryId, next);
      if (res.error) {
        setValue(prev);
        setError(res.error);
      } else {
        // The entry left this category — refresh so the row drops off.
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-1">
      <AccountingAccountPicker
        value={value}
        onChange={onChange}
        accounts={accounts}
        disabled={pending}
        placeholder="— Move to category —"
      />
      {pending && <p className="text-xs text-slate-400">Saving…</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
