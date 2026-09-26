'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { postManualJournalEntryAction } from '../gl-actions';
import { uploadJournalAttachments } from '../lib/journal-attachment-upload';

export type JournalAccountOption = { id: string; label: string; group: string };
type Line = { accountId: string; debit: string; credit: string; description: string };

const GROUP_ORDER = [
  'asset',
  'liability',
  'equity',
  'income',
  'cogs',
  'opex',
  'vat_tax',
];
const GROUP_LABEL: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  cogs: 'Cost of Goods Sold',
  opex: 'Operating Expense',
  vat_tax: 'VAT / Tax',
};

const emptyLine = (): Line => ({
  accountId: '',
  debit: '',
  credit: '',
  description: '',
});
const round2 = (n: number) => Math.round(n * 100) / 100;

function money(n: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

/** Starting values for a NEW entry — the "Reverse & correct" flow copies
 *  the reversed original's lines here. Posted entries are never edited. */
export type JournalEntryPrefill = {
  memo: string;
  lines: Array<{
    accountId: string;
    debit: number;
    credit: number;
    description: string | null;
  }>;
};

export function JournalEntryForm({
  accounts,
  defaultDate,
  prefill,
}: {
  accounts: JournalAccountOption[];
  defaultDate: string;
  prefill?: JournalEntryPrefill;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [entryDate, setEntryDate] = useState(defaultDate);
  const [memo, setMemo] = useState(prefill?.memo ?? '');
  const [lines, setLines] = useState<Line[]>(
    prefill && prefill.lines.length >= 2
      ? prefill.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit > 0 ? l.debit.toFixed(2) : '',
          credit: l.credit > 0 ? l.credit.toFixed(2) : '',
          description: l.description ?? '',
        }))
      : [emptyLine(), emptyLine()],
  );
  const [error, setError] = useState<string | null>(null);
  // Working papers picked while writing the entry. Storage needs an entry id,
  // so the files ride along in memory and upload the moment the post succeeds.
  const [staged, setStaged] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const grouped = useMemo(
    () =>
      GROUP_ORDER.map((g) => ({
        g,
        items: accounts.filter((a) => a.group === g),
      })).filter((x) => x.items.length > 0),
    [accounts],
  );

  const totalDebit = round2(
    lines.reduce((s, l) => s + (Number(l.debit) || 0), 0),
  );
  const totalCredit = round2(
    lines.reduce((s, l) => s + (Number(l.credit) || 0), 0),
  );
  const diff = round2(totalDebit - totalCredit);
  const balanced = Math.abs(diff) < 0.005 && totalDebit > 0;

  function setLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i: number) =>
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));

  function submit() {
    setError(null);
    const payloadLines = lines
      .filter(
        (l) =>
          l.accountId &&
          ((Number(l.debit) || 0) > 0 || (Number(l.credit) || 0) > 0),
      )
      .map((l) => ({
        accountId: l.accountId,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        description: l.description || null,
      }));
    if (payloadLines.length < 2) {
      setError('Add at least two lines, each with an account and an amount.');
      return;
    }
    if (!balanced) {
      setError('Debits must equal credits before posting.');
      return;
    }
    startTransition(async () => {
      const res = await postManualJournalEntryAction({
        entryDate,
        memo: memo || null,
        lines: payloadLines,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (staged.length > 0) {
        const problems = await uploadJournalAttachments(res.id, staged);
        if (problems.length > 0) {
          // The entry is posted — don't strand the user on the form. Land them
          // on the entry with the upload problem spelled out, so they can retry
          // the file from the entry's own attachments block.
          setStaged([]);
          setError(
            `Entry saved, but the files did not attach: ${problems.join(' ')}`,
          );
          router.push(`/accounting/journal?entry=${res.id}` as never);
          router.refresh();
          return;
        }
      }
      router.push(`/accounting/journal?entry=${res.id}` as never);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="entryDate">Date</Label>
          <Input
            id="entryDate"
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="memo">Memo</Label>
          <Input
            id="memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="e.g. Opening balances at 2026-01-01"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2 text-right">Debit</th>
              <th className="px-3 py-2 text-right">Credit</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="px-3 py-2 min-w-[220px]">
                  <Select
                    value={l.accountId}
                    onChange={(e) => setLine(i, { accountId: e.target.value })}
                  >
                    <option value="">— account —</option>
                    {grouped.map(({ g, items }) => (
                      <optgroup key={g} label={GROUP_LABEL[g] ?? g}>
                        {items.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </td>
                <td className="px-3 py-2 w-28">
                  <Input
                    inputMode="decimal"
                    value={l.debit}
                    onChange={(e) =>
                      setLine(i, {
                        debit: e.target.value,
                        credit: e.target.value ? '' : l.credit,
                      })
                    }
                    className="text-right tabular-nums"
                    placeholder="0.00"
                  />
                </td>
                <td className="px-3 py-2 w-28">
                  <Input
                    inputMode="decimal"
                    value={l.credit}
                    onChange={(e) =>
                      setLine(i, {
                        credit: e.target.value,
                        debit: e.target.value ? '' : l.debit,
                      })
                    }
                    className="text-right tabular-nums"
                    placeholder="0.00"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={l.description}
                    onChange={(e) => setLine(i, { description: e.target.value })}
                    placeholder="optional"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={lines.length <= 2}
                    onClick={() => removeLine(i)}
                  >
                    ✕
                  </Button>
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 bg-slate-50">
              <td className="px-3 py-2 font-medium text-slate-700">Totals</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {money(totalDebit)}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {money(totalCredit)}
              </td>
              <td
                className={`px-3 py-2 text-xs ${
                  balanced ? 'text-emerald-700' : 'text-amber-700'
                }`}
                colSpan={2}
              >
                {balanced
                  ? 'In balance'
                  : `Out of balance by ${money(diff)}`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="rounded-md border border-slate-200 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Supporting documents
          </span>
          {staged.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
            >
              📎 <span className="max-w-48 truncate">{f.name}</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                className="text-slate-400 hover:text-slate-700"
                onClick={() =>
                  setStaged((prev) => prev.filter((_, idx) => idx !== i))
                }
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            📎 Attach files
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length)
                setStaged((prev) => [...prev, ...picked].slice(0, 10));
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Attach the spreadsheet, screenshot, or statement behind this
          adjustment — they upload with the entry.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={addLine}>
          + Add line
        </Button>
        <div className="flex-1" />
        {error && <span className="text-xs text-red-600">{error}</span>}
        <Button type="button" onClick={submit} disabled={pending || !balanced}>
          {pending ? 'Posting…' : 'Post entry'}
        </Button>
      </div>
    </div>
  );
}
