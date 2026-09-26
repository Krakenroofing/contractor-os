'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  mirrorIntercompanyItemAction,
  saveIntercompanyLinkAction,
} from '../intercompany-actions';

export function IntercompanyLinkForm({
  partnerCompanyId,
  partnerName,
  accounts,
  accountId,
  clearingAccountId,
}: {
  partnerCompanyId: string;
  partnerName: string;
  accounts: Array<{ id: string; label: string }>;
  accountId: string | null;
  clearingAccountId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [acct, setAcct] = useState(accountId ?? '');
  const [clearing, setClearing] = useState(clearingAccountId ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <label className="space-y-1">
        <span className="block text-xs text-slate-500">
          Our intercompany account for {partnerName}
        </span>
        <select
          value={acct}
          onChange={(e) => setAcct(e.target.value)}
          className="h-9 w-72 rounded-md border border-slate-300 bg-white px-2"
        >
          <option value="">— Pick account —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-slate-500">
          Clearing account for {partnerName}&apos;s mirrors
        </span>
        <select
          value={clearing}
          onChange={(e) => setClearing(e.target.value)}
          className="h-9 w-72 rounded-md border border-slate-300 bg-white px-2"
        >
          <option value="">Create “Intercompany Clearing” on first use</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        size="sm"
        disabled={pending || !acct}
        onClick={() =>
          start(async () => {
            const res = await saveIntercompanyLinkAction({
              partnerCompanyId,
              accountId: acct,
              clearingAccountId: clearing || null,
            });
            setMsg(res.ok ? 'Saved.' : (res.error ?? 'Could not save.'));
            router.refresh();
          })
        }
      >
        Save
      </Button>
      {msg && <span className="text-xs text-slate-600">{msg}</span>}
    </div>
  );
}

export function MirrorItemButton({
  partnerCompanyId,
  entryId,
  partnerName,
}: {
  partnerCompanyId: string;
  entryId: string;
  partnerName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              `Post the mirror of this entry in ${partnerName}'s books?\n\nIt lands on their intercompany account with the offset in Intercompany Clearing, for their accountant to reclassify.`,
            )
          )
            return;
          start(async () => {
            const res = await mirrorIntercompanyItemAction({ partnerCompanyId, entryId });
            if (!res.ok) setError(res.error ?? 'Could not post.');
            router.refresh();
          });
        }}
      >
        Mirror in {partnerName}
      </Button>
    </span>
  );
}
