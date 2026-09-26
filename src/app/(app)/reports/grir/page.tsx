import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { grirGlBalance, listGrirOpenItems } from '@/lib/data/po-receipts';
import { listVendors } from '@/lib/data/vendors';

export const dynamic = 'force-dynamic';

const qty = (n: number) =>
  n.toLocaleString('en-US', { maximumFractionDigits: 4 });

// GR/IR open items (roadmap P3): per purchase-order line, what's been
// received vs what bills have cleared. Received-not-billed is an accrued
// liability waiting for the vendor's invoice; billed-not-received is a bill
// ahead of the goods (it sits payment-blocked until they arrive).
export default async function GrirReportPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'accounting_accounts')) redirect('/dashboard');
  const company = await getActiveCompany();
  const { all } = await searchParams;
  const includeSettled = all === '1';
  const [items, glBalance, vendors] = await Promise.all([
    listGrirOpenItems(company.id, { includeSettled }),
    grirGlBalance(company.id),
    listVendors(company.id),
  ]);
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  const receivedNotBilled = items.filter((i) => i.open > 0);
  const billedNotReceived = items.filter((i) => i.open < 0);
  const settled = items.filter((i) => i.open === 0);
  const rnbTotal = receivedNotBilled.reduce((s, i) => s + i.open, 0);
  const bnrTotal = billedNotReceived.reduce((s, i) => s + i.open, 0);
  const openTotal = Math.round((rnbTotal + bnrTotal) * 100) / 100;
  const ties =
    glBalance === null ? openTotal === 0 : Math.abs(glBalance - openTotal) < 0.01;

  const Table = ({ rows }: { rows: typeof items }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2 pr-3">PO</th>
            <th className="py-2 pr-3">Vendor</th>
            <th className="py-2 pr-3">Line</th>
            <th className="py-2 pr-3 text-right">Ordered</th>
            <th className="py-2 pr-3 text-right">Received</th>
            <th className="py-2 pr-3 text-right">Billed</th>
            <th className="py-2 pr-3 text-right">Received value</th>
            <th className="py-2 pr-3 text-right">Cleared by bills</th>
            <th className="py-2 text-right">Open</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((i) => (
            <tr key={i.poLineId}>
              <td className="py-1.5 pr-3">
                <Link
                  href={{ pathname: `/purchase-orders/${i.purchaseOrderId}` }}
                  className="text-blue-700 hover:underline"
                >
                  {i.poNumber}
                </Link>
              </td>
              <td className="py-1.5 pr-3 text-slate-700">
                {vendorName.get(i.vendorId) ?? '—'}
              </td>
              <td className="py-1.5 pr-3 text-slate-700">{i.description}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">
                {qty(i.quantityOrdered)}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">
                {qty(i.quantityReceived)}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">
                {qty(i.quantityBilled)}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">
                {formatMoney(i.receivedValue)}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">
                {formatMoney(i.clearedValue)}
              </td>
              <td className="py-1.5 text-right font-medium tabular-nums">
                {formatMoney(i.open)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          GR/IR open items
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          <span className="font-medium text-slate-900">{company.name}</span> —
          goods received vs vendor bills, per purchase-order line, for orders
          under goods-receipt accounting
          {company.grirCutoverDate
            ? ` (POs dated ${company.grirCutoverDate} or later)`
            : ' (currently switched off in Settings → Accounting)'}
          . Values are at the PO price.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Received, not billed
            </div>
            <div className="mt-1 text-xl font-semibold tabular-nums">
              {formatMoney(rnbTotal)}
            </div>
            <div className="text-xs text-slate-500">
              {receivedNotBilled.length} line
              {receivedNotBilled.length === 1 ? '' : 's'} awaiting a vendor bill
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Billed, not received
            </div>
            <div className="mt-1 text-xl font-semibold tabular-nums">
              {formatMoney(-bnrTotal)}
            </div>
            <div className="text-xs text-slate-500">
              {billedNotReceived.length} line
              {billedNotReceived.length === 1 ? '' : 's'} billed ahead of the
              goods
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              GR/IR clearing in the ledger
            </div>
            <div className="mt-1 text-xl font-semibold tabular-nums">
              {glBalance === null ? '—' : formatMoney(glBalance)}
            </div>
            <div
              className={`text-xs ${ties ? 'text-emerald-700' : 'text-red-700'}`}
            >
              {ties
                ? '✓ Ties to the open items'
                : `⚠ Open items total ${formatMoney(openTotal)} — run Rebuild GL, then re-check`}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Received, not billed</CardTitle>
        </CardHeader>
        <CardContent>
          {receivedNotBilled.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing waiting on a bill.</p>
          ) : (
            <Table rows={receivedNotBilled} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billed, not received</CardTitle>
        </CardHeader>
        <CardContent>
          {billedNotReceived.length === 0 ? (
            <p className="text-sm text-slate-500">No bills ahead of the goods.</p>
          ) : (
            <Table rows={billedNotReceived} />
          )}
        </CardContent>
      </Card>

      {includeSettled ? (
        settled.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Settled (received = billed)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table rows={settled} />
            </CardContent>
          </Card>
        )
      ) : (
        <p className="text-sm">
          <a href="/reports/grir?all=1" className="text-blue-700 hover:underline">
            Show settled lines too
          </a>
        </p>
      )}
    </div>
  );
}
