'use client';

// Reclassify a POSTED bill without unposting it.
//
// Unposting a bill that's already matched to a bank payment costs the whole
// chain — unmatch, unpost, edit, repost, rematch. The corrections that come up
// after the fact (wrong category, wrong bill date, wrong job) don't move any
// money, so they're safe to make in place. Amounts are deliberately NOT here:
// changing one changes AP and the bank match, and that still needs a real
// unpost.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { reclassifyPostedReceiptAction } from '../actions';

export type ReclassifyLine = {
  id: string;
  description: string;
  total: number;
  projectId: string;
  costCodeId: string;
  accountingAccountId: string;
};

export type ReclassifyOption = { id: string; label: string };
export type ReclassifyAccountOption = ReclassifyOption & { group?: string };

const money = (n: number) =>
  n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export function ReclassifyPanel({
  receiptId,
  receiptDate,
  lines: initialLines,
  projects,
  costCodes,
  accountingAccounts,
}: {
  receiptId: string;
  receiptDate: string;
  lines: ReclassifyLine[];
  projects: ReclassifyOption[];
  costCodes: ReclassifyOption[];
  accountingAccounts: ReclassifyAccountOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [date, setDate] = useState(receiptDate);
  const [lines, setLines] = useState(initialLines);

  function setLine(id: string, patch: Partial<ReclassifyLine>) {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  }

  const groups = Array.from(
    new Set(accountingAccounts.map((a) => a.group ?? '')),
  );

  function submit() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await reclassifyPostedReceiptAction({
        id: receiptId,
        receiptDate: date,
        lines: lines.map((l) => ({
          lineId: l.id,
          projectId: l.projectId || null,
          costCodeId: l.costCodeId || null,
          accountingAccountId: l.accountingAccountId || null,
          description: l.description || null,
        })),
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not save the changes.');
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
        >
          Reclassify without unposting
        </Button>
        <p className="mt-1 text-xs text-slate-500">
          Change the bill date, the job, the cost code, or the accounting
          category on a posted bill — the job costs and the ledger follow. The
          bank match stays intact. Amounts still need an unpost.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-blue-900">
          Reclassify posted bill
        </h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setError(null);
            setSaved(false);
          }}
        >
          Close
        </Button>
      </div>

      <div className="max-w-xs">
        <label className="block text-xs font-medium text-slate-600">
          Bill date
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1"
          />
        </label>
      </div>

      <div className="space-y-2">
        {lines.map((l) => (
          <div
            key={l.id}
            className="space-y-2 rounded border border-slate-200 bg-white p-2"
          >
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate font-medium text-slate-800">
                {l.description || '(no description)'}
              </span>
              <span className="shrink-0 tabular-nums text-slate-600">
                ${money(l.total)}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <label className="block text-[11px] uppercase tracking-wide text-slate-500">
                Job
                <Select
                  value={l.projectId}
                  onChange={(e) => setLine(l.id, { projectId: e.target.value })}
                >
                  <option value="">— overhead (no job) —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block text-[11px] uppercase tracking-wide text-slate-500">
                Cost code
                <Select
                  value={l.costCodeId}
                  onChange={(e) => setLine(l.id, { costCodeId: e.target.value })}
                >
                  <option value="">— none —</option>
                  {costCodes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block text-[11px] uppercase tracking-wide text-slate-500">
                Accounting category
                <Select
                  value={l.accountingAccountId}
                  onChange={(e) =>
                    setLine(l.id, { accountingAccountId: e.target.value })
                  }
                >
                  <option value="">— none —</option>
                  {groups.map((g) =>
                    g ? (
                      <optgroup key={g} label={g}>
                        {accountingAccounts
                          .filter((a) => (a.group ?? '') === g)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.label}
                            </option>
                          ))}
                      </optgroup>
                    ) : (
                      accountingAccounts
                        .filter((a) => !a.group)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))
                    ),
                  )}
                </Select>
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? 'Saving…' : 'Save reclassification'}
        </Button>
        {saved && !error && (
          <span className="text-xs text-emerald-700">
            Saved — job costs and the ledger have been updated.
          </span>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      <p className="text-xs text-slate-500">
        Each line needs either a job + cost code (it becomes a job cost) or an
        accounting category (it stays overhead). Amounts, vendor, and VAT are
        not editable here — those change what the bill owes, so they still need
        Unpost.
      </p>
    </div>
  );
}
