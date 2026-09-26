'use client';

// Parked-bill queue (roadmap P6): every bill not yet posted, with an owner
// responsible for it and its age, so the backlog gets worked down instead
// of piling up unowned.

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';
import { assignParkedOwnerAction } from '../actions';

export type ParkedBillRow = {
  id: string;
  status: string;
  vendorName: string | null;
  vendorInvoiceNumber: string | null;
  receiptDate: string;
  total: string;
  currency: string;
  ageDays: number;
  ownerUserId: string | null;
  assigned: boolean;
  notes: string | null;
};

const BUCKETS = [
  { key: '0-7', label: '0–7 days', min: 0, max: 7 },
  { key: '8-30', label: '8–30 days', min: 8, max: 30 },
  { key: '31-90', label: '31–90 days', min: 31, max: 90 },
  { key: '90+', label: 'Over 90 days', min: 91, max: Infinity },
] as const;

const bucketOf = (age: number) =>
  BUCKETS.find((b) => age >= b.min && age <= b.max)!.key;

export function ParkedBillsClient({
  rows,
  members,
  canAssign,
}: {
  rows: ParkedBillRow[];
  members: Array<{ userId: string; name: string }>;
  canAssign: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [owner, setOwner] = useState<string>('all');
  const [bucket, setBucket] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const nameOf = new Map(members.map((m) => [m.userId, m.name]));

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (owner === 'all' ||
            (owner === 'none' ? !r.ownerUserId : r.ownerUserId === owner)) &&
          (bucket === 'all' || bucketOf(r.ageDays) === bucket),
      ),
    [rows, owner, bucket],
  );

  // Owner × age matrix for the header.
  const matrix = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const k = r.ownerUserId ?? 'none';
      const rec = m.get(k) ?? {};
      const b = bucketOf(r.ageDays);
      rec[b] = (rec[b] ?? 0) + 1;
      m.set(k, rec);
    }
    return [...m.entries()].sort(
      (a, b) =>
        Object.values(b[1]).reduce((s, n) => s + n, 0) -
        Object.values(a[1]).reduce((s, n) => s + n, 0),
    );
  }, [rows]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function assign() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setMsg(null);
    start(async () => {
      const res = await assignParkedOwnerAction({
        ids,
        ownerUserId: assignTo || null,
      });
      if (!res.ok) setMsg(res.error ?? 'Could not assign.');
      else {
        setMsg(`Assigned ${res.updated} bill${res.updated === 1 ? '' : 's'}.`);
        setSelected(new Set());
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Owner</th>
              {BUCKETS.map((b) => (
                <th key={b.key} className="px-3 py-2 text-right">
                  {b.label}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {matrix.map(([k, rec]) => (
              <tr key={k}>
                <td className="px-3 py-1.5">
                  <button
                    type="button"
                    className="text-blue-700 hover:underline"
                    onClick={() => setOwner(k)}
                  >
                    {k === 'none' ? 'Unowned' : (nameOf.get(k) ?? 'Former user')}
                  </button>
                </td>
                {BUCKETS.map((b) => (
                  <td
                    key={b.key}
                    className={`px-3 py-1.5 text-right tabular-nums ${
                      b.key === '90+' && rec[b.key] ? 'font-medium text-red-700' : ''
                    }`}
                  >
                    {rec[b.key] ?? ''}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                  {Object.values(rec).reduce((s, n) => s + n, 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          className="h-9 rounded-md border border-slate-300 bg-white px-2"
        >
          <option value="all">All owners</option>
          <option value="none">Unowned</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
        <select
          value={bucket}
          onChange={(e) => setBucket(e.target.value)}
          className="h-9 rounded-md border border-slate-300 bg-white px-2"
        >
          <option value="all">Any age</option>
          {BUCKETS.map((b) => (
            <option key={b.key} value={b.key}>
              {b.label}
            </option>
          ))}
        </select>
        <span className="text-slate-500">
          {filtered.length} bill{filtered.length === 1 ? '' : 's'}
        </span>
        {canAssign && (
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="text-xs text-blue-700 hover:underline"
              onClick={() => setSelected(new Set(filtered.map((r) => r.id)))}
            >
              Select all shown
            </button>
            <select
              value={assignTo}
              onChange={(e) => setAssignTo(e.target.value)}
              className="h-9 rounded-md border border-slate-300 bg-white px-2"
            >
              <option value="">— Uploader (clear) —</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              disabled={pending || selected.size === 0}
              onClick={assign}
            >
              Assign {selected.size || ''}
            </Button>
          </span>
        )}
      </div>
      {msg && <p className="text-xs text-slate-600">{msg}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {canAssign && <th className="w-8 px-3 py-2" />}
              <th className="px-3 py-2">Age</th>
              <th className="px-3 py-2">Vendor</th>
              <th className="px-3 py-2">Invoice #</th>
              <th className="px-3 py-2">Bill date</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? 'bg-blue-50' : ''}>
                {canAssign && (
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                )}
                <td
                  className={`px-3 py-1.5 tabular-nums ${
                    r.ageDays > 90
                      ? 'font-medium text-red-700'
                      : r.ageDays > 30
                        ? 'text-amber-700'
                        : 'text-slate-600'
                  }`}
                >
                  {r.ageDays}d
                </td>
                <td className="px-3 py-1.5">
                  <Link
                    href={{ pathname: `/banking/receipts/${r.id}` }}
                    className="text-blue-700 hover:underline"
                  >
                    {r.vendorName ?? r.notes?.slice(0, 40) ?? '(no vendor)'}
                  </Link>
                </td>
                <td className="px-3 py-1.5 font-mono text-xs">
                  {r.vendorInvoiceNumber ?? '—'}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs">{r.receiptDate}</td>
                <td className="px-3 py-1.5 text-xs capitalize text-slate-500">
                  {r.status}
                </td>
                <td className="px-3 py-1.5 text-xs">
                  {r.ownerUserId ? (nameOf.get(r.ownerUserId) ?? 'Former user') : (
                    <span className="text-amber-700">Unowned</span>
                  )}
                  {r.ownerUserId && !r.assigned ? (
                    <span className="text-slate-400"> (uploader)</span>
                  ) : null}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {formatMoney(r.total, r.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
