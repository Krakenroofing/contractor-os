import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/money';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { getVendor } from '@/lib/data/vendors';
import { getPurchaseOrder } from '@/lib/data/purchase-orders';
import {
  listReceiptLinesForReceiptIds,
  listReceipts,
} from '@/lib/data/receipts';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import {
  listApplicationsForReceipts,
  listVendorCredits,
} from '@/lib/data/vendor-credits';

export const dynamic = 'force-dynamic';

// Invoice review (Chris, 2026-09-22): supplier statements are a pile of
// invoices plus later tax reimbursements / adjustments. This page keys
// everything on the VENDOR INVOICE NUMBER — per invoice: which PO it came
// from, its items, the sales tax it charged, and the credits/adjustments
// that reference it — so "did they credit back all the tax?" is a column,
// not an archaeology project.
//
// A credit relates to an invoice three ways, strongest first:
//   1. a vendor-credit APPLICATION on that bill (explicit link),
//   2. a negative sales-tax line on the bill itself,
//   3. text: a credit or another bill's negative tax line whose
//      reference/description mentions the invoice number.

const r2 = (n: number) => Math.round(n * 100) / 100;

export default async function VendorInvoiceReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const role = await getActiveRole();
  if (!canView(role, 'receipts')) redirect('/vendors');
  const companyId = await getActiveCompanyId();
  const vendor = await getVendor(companyId, id);
  if (!vendor) notFound();

  const [posted, drafts, accounts, credits] = await Promise.all([
    listReceipts(companyId, { vendorId: vendor.id, status: 'posted' }),
    listReceipts(companyId, { vendorId: vendor.id, status: 'draft' }),
    listAccountingAccounts(companyId),
    listVendorCredits(companyId, { vendorId: vendor.id }),
  ]);
  const bills = [...posted, ...drafts];
  const lines = await listReceiptLinesForReceiptIds(
    companyId,
    bills.map((b) => b.id),
  );
  const appliedCredits = await listApplicationsForReceipts(
    companyId,
    bills.map((b) => b.id),
  );
  const accountName = new Map(accounts.map((a) => [a.id, a.name.toLowerCase()]));

  const isTaxLine = (l: (typeof lines)[number]) => {
    const acct = l.accountingAccountId
      ? (accountName.get(l.accountingAccountId) ?? '')
      : '';
    return acct.includes('sales tax') || /^sales tax/i.test(l.description ?? '');
  };
  const isShippingLine = (l: (typeof lines)[number]) => {
    const acct = l.accountingAccountId
      ? (accountName.get(l.accountingAccountId) ?? '')
      : '';
    return (
      acct.includes('shipping') ||
      acct.includes('freight') ||
      /^shipping/i.test(l.description ?? '')
    );
  };

  const linesByBill = new Map<string, typeof lines>();
  for (const l of lines) {
    if (!l.receiptId) continue;
    const arr = linesByBill.get(l.receiptId) ?? [];
    arr.push(l);
    linesByBill.set(l.receiptId, arr);
  }
  const appliedByBill = new Map<string, number>();
  for (const a of appliedCredits) {
    if (!a.receiptId) continue;
    appliedByBill.set(
      a.receiptId,
      r2((appliedByBill.get(a.receiptId) ?? 0) + Number(a.amount)),
    );
  }

  // Known invoice numbers, longest first so "1234-001" matches before "1234".
  const knownNumbers = bills
    .map((b) => b.vendorInvoiceNumber?.trim())
    .filter((n): n is string => Boolean(n))
    .sort((a, b) => b.length - a.length);
  // Suffix-tolerant: ABC writes "1234567-001" on the invoice but the
  // credit memo may say "1234567-1" or just "1234567" — when no full
  // number matches, fall back to the base (before the dash), which maps
  // to the invoice(s) of that ABC order.
  const baseOf = (n: string) => n.split('-')[0];
  const numbersByBase = new Map<string, string[]>();
  for (const n of knownNumbers) {
    const b = baseOf(n);
    if (b.length < 6) continue;
    const arr = numbersByBase.get(b) ?? [];
    arr.push(n);
    numbersByBase.set(b, arr);
  }
  const mentionsOf = (text: string, excludeNumber?: string): string[] => {
    const t = text.toLowerCase();
    const hits: string[] = [];
    for (const n of knownNumbers) {
      if (n === excludeNumber) continue;
      if (t.includes(n.toLowerCase()) && !hits.includes(n)) hits.push(n);
    }
    if (hits.length > 0) return hits;
    for (const [base, nums] of numbersByBase) {
      if (!t.includes(base.toLowerCase())) continue;
      for (const n of nums) {
        if (n !== excludeNumber && !hits.includes(n)) hits.push(n);
      }
    }
    return hits;
  };

  type BillRow = {
    id: string;
    number: string | null;
    date: string;
    status: string;
    poId: string | null;
    total: number;
    items: number;
    shipping: number;
    taxCharged: number;
    creditedBack: number;
    creditNotes: string[];
    detail: Array<{ description: string; quantity: string | null; amount: number }>;
  };

  const rows: BillRow[] = bills.map((b) => {
    const bl = linesByBill.get(b.id) ?? [];
    let items = 0;
    let shipping = 0;
    let taxCharged = 0;
    let creditedBack = appliedByBill.get(b.id) ?? 0;
    const creditNotes: string[] = [];
    if (creditedBack > 0.005) {
      creditNotes.push(`${formatMoney(creditedBack)} vendor credit applied`);
    }
    for (const l of bl) {
      const amt = Number(l.subtotal);
      if (isTaxLine(l)) {
        // Positive tax only — negative tax lines are credits, attributed
        // in the matching pass below (self, mentioned invoice, or
        // unmatched — exactly one of the three).
        if (amt >= 0) taxCharged = r2(taxCharged + amt);
      } else if (isShippingLine(l)) {
        shipping = r2(shipping + amt);
      } else {
        items = r2(items + amt);
      }
    }
    return {
      id: b.id,
      number: b.vendorInvoiceNumber?.trim() || null,
      date: String(b.receiptDate),
      status: b.status,
      poId: b.purchaseOrderId ?? null,
      total: Number(b.total),
      items,
      shipping,
      taxCharged,
      creditedBack,
      creditNotes,
      detail: bl.map((l) => ({
        description: l.description ?? '(no description)',
        quantity: l.quantity ? String(Number(l.quantity)) : null,
        amount: Number(l.subtotal),
      })),
    };
  });
  const rowByNumber = new Map(rows.filter((x) => x.number).map((x) => [x.number!, x]));
  const rowById = new Map(rows.map((x) => [x.id, x]));

  // Text matches: negative tax lines on OTHER bills + unapplied credit
  // remainders whose text names an invoice. Split across mentions when a
  // credit covers several invoices.
  const unmatched: Array<{ label: string; amount: number; href?: string }> = [];
  for (const b of bills) {
    for (const l of linesByBill.get(b.id) ?? []) {
      const amt = Number(l.subtotal);
      if (!isTaxLine(l) || amt >= 0) continue;
      const hits = mentionsOf(l.description ?? '', b.vendorInvoiceNumber?.trim() || undefined);
      if (hits.length === 0) {
        // Names no OTHER invoice: treat as a self-credit when this bill
        // charged tax; flag it otherwise.
        const self = rowById.get(b.id);
        if (self && self.taxCharged > 0.005) {
          self.creditedBack = r2(self.creditedBack + -amt);
          self.creditNotes.push(`${formatMoney(-amt)} credit line on this bill`);
        } else {
          unmatched.push({
            label: `Credit line "${(l.description ?? '').slice(0, 60)}" on bill ${b.vendorInvoiceNumber ?? b.receiptDate}`,
            amount: -amt,
            href: `/banking/receipts/${b.id}`,
          });
        }
        continue;
      }
      const share = r2(-amt / hits.length);
      for (const n of hits) {
        const row = rowByNumber.get(n);
        if (!row) continue;
        // Move it: mentioned another invoice, so it belongs there, not here.
        row.creditedBack = r2(row.creditedBack + share);
        row.creditNotes.push(
          `${formatMoney(share)} credit on bill ${b.vendorInvoiceNumber ?? b.receiptDate}`,
        );
      }
    }
  }
  for (const c of credits) {
    const remainder = r2(Number(c.amount) - c.appliedTotal);
    if (remainder <= 0.005) continue;
    const hits = mentionsOf(`${c.reference ?? ''} ${c.notes ?? ''}`);
    if (hits.length === 0) {
      unmatched.push({
        label: `Open vendor credit ${c.reference ? `"${c.reference}"` : `dated ${c.creditDate}`}`,
        amount: remainder,
      });
      continue;
    }
    const share = r2(remainder / hits.length);
    for (const n of hits) {
      const row = rowByNumber.get(n);
      if (!row) continue;
      row.creditedBack = r2(row.creditedBack + share);
      row.creditNotes.push(
        `${formatMoney(share)} open credit ${c.reference ? `(${c.reference})` : ''}`,
      );
    }
  }

  // Group by PO for the "invoice number connects PO vs invoice" reading.
  const poIds = [...new Set(rows.map((x) => x.poId).filter((x): x is string => Boolean(x)))];
  const poById = new Map<string, { number: string; taxAmount: number }>();
  for (const pid of poIds) {
    const po = await getPurchaseOrder(companyId, pid);
    if (po) poById.set(pid, { number: po.number, taxAmount: Number(po.taxAmount) });
  }
  const groups = new Map<string, BillRow[]>();
  for (const rrow of rows) {
    const key = rrow.poId ?? '__none__';
    const arr = groups.get(key) ?? [];
    arr.push(rrow);
    groups.set(key, arr);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => (a.number ?? a.date).localeCompare(b.number ?? b.date));
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const an = a[0] === '__none__' ? 'zzzz' : (poById.get(a[0])?.number ?? a[0]);
    const bn = b[0] === '__none__' ? 'zzzz' : (poById.get(b[0])?.number ?? b[0]);
    return an.localeCompare(bn, undefined, { numeric: true });
  });

  const totals = rows.reduce(
    (acc, x) => ({
      taxCharged: r2(acc.taxCharged + x.taxCharged),
      creditedBack: r2(acc.creditedBack + x.creditedBack),
      total: r2(acc.total + x.total),
    }),
    { taxCharged: 0, creditedBack: 0, total: 0 },
  );
  const stillOwed = (x: { taxCharged: number; creditedBack: number }) =>
    r2(x.taxCharged - x.creditedBack);

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/vendors', label: 'Vendors' },
          { href: `/vendors/${vendor.id}`, label: vendor.name },
          { label: 'Invoice review' },
        ]}
      />
      <div className="flex items-start justify-between gap-4">
        <header>
          <h1 className="text-2xl font-semibold text-slate-900">
            Invoice review — {vendor.name}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            One row per vendor invoice, keyed by their invoice number:
            the PO it bills, its items, the sales tax charged, and the
            credits / adjustments that reference it. Amber = tax not yet
            credited back.
          </p>
        </header>
        <Link href={{ pathname: `/vendors/${vendor.id}` }}>
          <Button variant="outline" size="sm">
            ← Back to vendor
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Invoices" value={String(rows.length)} />
        <Stat label="Tax charged" value={formatMoney(totals.taxCharged)} />
        <Stat label="Credited back" value={formatMoney(totals.creditedBack)} />
        <Stat
          label="Still owed back"
          value={formatMoney(r2(totals.taxCharged - totals.creditedBack))}
          tone={
            totals.taxCharged - totals.creditedBack > 0.005 ? 'amber' : 'green'
          }
        />
      </div>

      {sortedGroups.map(([key, groupRows]) => {
        const po = key === '__none__' ? null : (poById.get(key) ?? null);
        return (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-baseline gap-2 text-base">
                {po ? (
                  <>
                    <Link
                      href={{ pathname: `/purchase-orders/${key}` }}
                      className="text-blue-700 hover:underline"
                    >
                      {po.number}
                    </Link>
                    {po.taxAmount !== 0 && (
                      <span className="text-xs font-normal text-slate-500">
                        PO tax {formatMoney(po.taxAmount)}
                      </span>
                    )}
                  </>
                ) : (
                  'Not billed from a PO'
                )}
                <span className="text-xs font-normal text-slate-500">
                  {groupRows.length} invoice{groupRows.length === 1 ? '' : 's'}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2">Invoice #</th>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2 text-right">Items</th>
                    <th className="px-4 py-2 text-right">Shipping</th>
                    <th className="px-4 py-2 text-right">Tax charged</th>
                    <th className="px-4 py-2 text-right">Credited back</th>
                    <th className="px-4 py-2 text-right">Still owed back</th>
                    <th className="px-4 py-2 text-right">Bill total</th>
                  </tr>
                </thead>
                <tbody>
                  {groupRows.map((x) => {
                    const owed = stillOwed(x);
                    return (
                      <tr key={x.id} className="border-b border-slate-100 align-top">
                        <td className="px-4 py-2">
                          <Link
                            href={{ pathname: `/banking/receipts/${x.id}` }}
                            className="font-mono text-xs text-blue-700 hover:underline"
                          >
                            {x.number ?? '(no number)'}
                          </Link>
                          {x.status === 'draft' && (
                            <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-500">
                              draft
                            </span>
                          )}
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-600">
                              {x.detail.length} line{x.detail.length === 1 ? '' : 's'}
                            </summary>
                            <ul className="mt-1 space-y-0.5 text-[11px] text-slate-600">
                              {x.detail.map((d, i) => (
                                <li key={i} className="flex justify-between gap-2">
                                  <span className="truncate" title={d.description}>
                                    {d.quantity ? `${d.quantity} × ` : ''}
                                    {d.description}
                                  </span>
                                  <span className="tabular-nums shrink-0">
                                    {formatMoney(d.amount)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">
                          {x.date.slice(0, 10)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatMoney(x.items)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                          {x.shipping !== 0 ? formatMoney(x.shipping) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {x.taxCharged !== 0 ? formatMoney(x.taxCharged) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {x.creditedBack !== 0 ? (
                            <span title={x.creditNotes.join('; ')}>
                              {formatMoney(x.creditedBack)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td
                          className={`px-4 py-2 text-right tabular-nums font-medium ${
                            owed > 0.005
                              ? 'text-amber-700'
                              : owed < -0.005
                                ? 'text-blue-700'
                                : 'text-emerald-700'
                          }`}
                        >
                          {x.taxCharged !== 0 || x.creditedBack !== 0
                            ? formatMoney(owed)
                            : '—'}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatMoney(x.total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}

      {unmatched.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Credits not matched to an invoice ({unmatched.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-slate-500">
              These credits / adjustments don&apos;t name any known invoice
              number. Add the invoice number to the credit&apos;s reference (or
              apply it to the bill) and they&apos;ll line up above.
            </p>
            <ul className="space-y-1 text-sm">
              {unmatched.map((u, i) => (
                <li key={i} className="flex justify-between gap-3">
                  {u.href ? (
                    <Link
                      href={{ pathname: u.href }}
                      className="text-blue-700 hover:underline"
                    >
                      {u.label}
                    </Link>
                  ) : (
                    <span className="text-slate-700">{u.label}</span>
                  )}
                  <span className="tabular-nums">{formatMoney(u.amount)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'amber' | 'green';
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === 'amber'
            ? 'text-amber-700'
            : tone === 'green'
              ? 'text-emerald-700'
              : 'text-slate-900'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
