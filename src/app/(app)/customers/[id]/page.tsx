import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArchiveCustomerForm } from '@/modules/customers/components/archive-customer-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getCustomer } from '@/lib/data/customers';
import { listProjects } from '@/lib/data/projects';
import {
  computeProjectInvoiceSummary,
  computeProjectInvoicesByContractSource,
  listInvoicesForProject,
} from '@/lib/data/invoices';
import {
  computeCustomerOpenCredit,
  listCreditMemosForCustomer,
} from '@/lib/data/credit-memos';
import { IssueCreditMemoDialog } from '@/modules/credit-memos/components/issue-credit-memo-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatMoney } from '@/lib/money';
import type { Customer } from '@/db/schema';

export const dynamic = 'force-dynamic';

const TYPE_TONE: Record<Customer['customerType'], 'slate' | 'blue'> = {
  residential: 'slate',
  commercial: 'blue',
};

const TYPE_LABEL: Record<Customer['customerType'], string> = {
  residential: 'Residential',
  commercial: 'Commercial',
};

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ showVoid?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const showVoid = sp.showVoid === '1';
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'customers');
  const customer = await getCustomer(companyId, id);
  if (!customer) notFound();

  const billingAddress = [
    customer.billingAddressLine1,
    customer.billingCity,
    customer.billingState,
    customer.billingPostalCode,
  ]
    .filter(Boolean)
    .join(', ');

  const linkedProjects = (await listProjects(companyId)).filter(
    (p) => p.customerId === customer.id,
  );

  // Customer-level credit memos: full list (for the table) + open
  // balance (sum of amount − applied across non-void credits).
  const creditMemos = await listCreditMemosForCustomer(companyId, customer.id);
  const openCredit = await computeCustomerOpenCredit(companyId, customer.id);

  // Roll up invoice activity across every project for this customer.
  // computeProjectInvoiceSummary already sums payment rows (not the cached
  // amountPaid) — so this stays correct even if a status cache drifted.
  // We pair it with computeProjectInvoicesByContractSource so the
  // customer-level tiles can show a base-vs-change-order sub-split.
  const invoiceSummaries = await Promise.all(
    linkedProjects.map(async (p) => ({
      project: p,
      summary: await computeProjectInvoiceSummary(p.id),
      bySource: await computeProjectInvoicesByContractSource(p.id),
      invoices: await listInvoicesForProject(p.id),
    })),
  );
  const rolledUp = invoiceSummaries.reduce(
    (acc, row) => ({
      invoiceCount: acc.invoiceCount + row.summary.invoiceCount,
      totalInvoiced: acc.totalInvoiced + row.summary.totalInvoiced,
      totalInvoicedNet: acc.totalInvoicedNet + row.summary.totalInvoicedNet,
      totalInvoicedVat: acc.totalInvoicedVat + row.summary.totalInvoicedVat,
      totalPaid: acc.totalPaid + row.summary.totalPaid,
      totalPaidNet: acc.totalPaidNet + row.summary.totalPaidNet,
      totalPaidVat: acc.totalPaidVat + row.summary.totalPaidVat,
      outstandingBalance: acc.outstandingBalance + row.summary.outstandingBalance,
      outstandingBalanceNet:
        acc.outstandingBalanceNet + row.summary.outstandingBalanceNet,
      outstandingBalanceVat:
        acc.outstandingBalanceVat + row.summary.outstandingBalanceVat,
      retainageHeld: acc.retainageHeld + row.summary.retainageHeld,
    }),
    {
      invoiceCount: 0,
      totalInvoiced: 0,
      totalInvoicedNet: 0,
      totalInvoicedVat: 0,
      totalPaid: 0,
      totalPaidNet: 0,
      totalPaidVat: 0,
      outstandingBalance: 0,
      outstandingBalanceNet: 0,
      outstandingBalanceVat: 0,
      retainageHeld: 0,
    },
  );
  // Sum the base-bucket and the change-order-buckets across every project
  // so the customer-level tiles can show a "base $X · CO $Y" sub-line in
  // the same unit as the headline figure.
  const sourceTotals = invoiceSummaries.reduce(
    (acc, row) => {
      const co = row.bySource.byChangeOrder.reduce(
        (sum, b) => ({
          invoicedNet: sum.invoicedNet + b.totalInvoicedNet,
          paidNet: sum.paidNet + b.totalPaidNet,
          outstanding: sum.outstanding + b.outstandingBalance,
          retainage: sum.retainage + (b.retainageHeld - b.retainageReleased),
        }),
        { invoicedNet: 0, paidNet: 0, outstanding: 0, retainage: 0 },
      );
      const base = row.bySource.base;
      return {
        baseInvoicedNet: acc.baseInvoicedNet + base.totalInvoicedNet,
        coInvoicedNet: acc.coInvoicedNet + co.invoicedNet,
        basePaidNet: acc.basePaidNet + base.totalPaidNet,
        coPaidNet: acc.coPaidNet + co.paidNet,
        baseOutstanding: acc.baseOutstanding + base.outstandingBalance,
        coOutstanding: acc.coOutstanding + co.outstanding,
        baseRetainage:
          acc.baseRetainage + (base.retainageHeld - base.retainageReleased),
        coRetainage: acc.coRetainage + co.retainage,
      };
    },
    {
      baseInvoicedNet: 0,
      coInvoicedNet: 0,
      basePaidNet: 0,
      coPaidNet: 0,
      baseOutstanding: 0,
      coOutstanding: 0,
      baseRetainage: 0,
      coRetainage: 0,
    },
  );
  const allInvoices = invoiceSummaries
    .flatMap((row) =>
      row.invoices.map((inv) => ({
        ...inv,
        projectName: row.project.name,
      })),
    )
    .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
  const voidInvoiceCount = allInvoices.filter((i) => i.status === 'void').length;
  const visibleInvoices = showVoid
    ? allInvoices
    : allInvoices.filter((i) => i.status !== 'void');

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <Breadcrumbs
        items={[
          { href: '/customers', label: 'Customers' },
          { label: customer.name },
        ]}
      />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link href="/customers">
          <Button variant="outline" size="sm">
            ← Back to Customers
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          {allowCreate && (
            <Link href={{ pathname: `/customers/${customer.id}/edit` }}>
              <Button size="sm" variant="outline">
                Edit
              </Button>
            </Link>
          )}
          {allowCreate && <ArchiveCustomerForm id={customer.id} />}
          {allowCreate && (
            <Link href="/customers/new">
              <Button size="sm">New Customer</Button>
            </Link>
          )}
        </div>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{customer.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-600">
            {customer.primaryContactName && <span>{customer.primaryContactName}</span>}
            {customer.email && <span className="text-slate-400">·</span>}
            {customer.email && <span>{customer.email}</span>}
            {customer.phone && <span className="text-slate-400">·</span>}
            {customer.phone && <span>{customer.phone}</span>}
          </div>
        </div>
        <Badge tone={TYPE_TONE[customer.customerType]}>
          {TYPE_LABEL[customer.customerType]}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <Row label="Company name" value={customer.name} />
            <Row label="Primary contact" value={customer.primaryContactName ?? '—'} />
            <Row label="Email" value={customer.email ?? '—'} />
            <Row label="Phone" value={customer.phone ?? '—'} />
            <Row label="Type" value={TYPE_LABEL[customer.customerType]} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Billing address</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {billingAddress ? (
              <div className="space-y-1">
                {customer.billingAddressLine1 && (
                  <div className="text-slate-900">{customer.billingAddressLine1}</div>
                )}
                {(customer.billingCity ||
                  customer.billingState ||
                  customer.billingPostalCode) && (
                  <div className="text-slate-700">
                    {[
                      customer.billingCity,
                      customer.billingState,
                      customer.billingPostalCode,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-slate-500">No billing address on file</span>
            )}
          </CardContent>
        </Card>
      </div>

      {customer.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap">{customer.notes}</CardContent>
        </Card>
      )}

      {/* AR rollup across every project for this customer */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Revenue invoiced (net)
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
              {formatMoney(rolledUp.totalInvoicedNet)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              base {formatMoney(sourceTotals.baseInvoicedNet)} · CO{' '}
              {formatMoney(sourceTotals.coInvoicedNet)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              VAT {formatMoney(rolledUp.totalInvoicedVat)} · gross{' '}
              {formatMoney(rolledUp.totalInvoiced)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {rolledUp.invoiceCount} invoice
              {rolledUp.invoiceCount === 1 ? '' : 's'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Revenue collected (net)
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">
              {formatMoney(rolledUp.totalPaidNet)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              base {formatMoney(sourceTotals.basePaidNet)} · CO{' '}
              {formatMoney(sourceTotals.coPaidNet)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              VAT collected {formatMoney(rolledUp.totalPaidVat)} · gross{' '}
              {formatMoney(rolledUp.totalPaid)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Outstanding AR (gross)
            </p>
            <p
              className={`mt-1 text-xl font-semibold tabular-nums ${
                rolledUp.outstandingBalance > 0
                  ? 'text-amber-700'
                  : 'text-emerald-700'
              }`}
            >
              {formatMoney(rolledUp.outstandingBalance)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              base {formatMoney(sourceTotals.baseOutstanding)} · CO{' '}
              {formatMoney(sourceTotals.coOutstanding)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              net {formatMoney(rolledUp.outstandingBalanceNet)} · VAT{' '}
              {formatMoney(rolledUp.outstandingBalanceVat)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Retainage held
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
              {formatMoney(rolledUp.retainageHeld)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              base {formatMoney(sourceTotals.baseRetainage)} · CO{' '}
              {formatMoney(sourceTotals.coRetainage)}
            </p>
          </CardContent>
        </Card>
      </div>

      {allInvoices.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>
                Invoices ({visibleInvoices.length})
                {!showVoid && voidInvoiceCount > 0 && (
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    · {voidInvoiceCount} void hidden
                  </span>
                )}
              </CardTitle>
              {voidInvoiceCount > 0 && (
                <Link
                  href={{
                    pathname: `/customers/${customer.id}`,
                    query: showVoid ? {} : { showVoid: '1' },
                  }}
                >
                  <Button size="sm" variant="outline">
                    {showVoid ? 'Hide void' : 'Show void'}
                  </Button>
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-100">
              {visibleInvoices.map((inv) => {
                const balance =
                  Number(inv.total) - Number(inv.amountPaid);
                return (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-slate-500">
                        {inv.number} · {inv.invoiceDate}
                      </div>
                      <div className="text-slate-900 truncate">
                        {inv.projectName}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="text-xs text-slate-500 capitalize">
                          {inv.status}
                        </div>
                        <div className="tabular-nums text-sm">
                          {formatMoney(inv.total)}
                        </div>
                        {balance > 0 && (
                          <div className="text-xs tabular-nums text-amber-700">
                            {formatMoney(balance)} due
                          </div>
                        )}
                      </div>
                      <Link href={`/invoices/${inv.id}`}>
                        <Button size="sm" variant="outline">
                          View
                        </Button>
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Projects ({linkedProjects.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {linkedProjects.length === 0 ? (
            <span className="text-slate-500">No projects yet for this customer.</span>
          ) : (
            <ul className="divide-y divide-slate-100">
              {linkedProjects.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2">
                  <div>
                    <div className="text-slate-900">{p.name}</div>
                  </div>
                  <Link href={`/projects/${p.id}`}>
                    <Button size="sm" variant="outline">
                      View Project
                    </Button>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Credit memos for this customer */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>
              Credit memos ({creditMemos.length})
              {openCredit > 0 && (
                <span className="ml-2 text-xs font-normal text-amber-700">
                  · {formatMoney(openCredit)} open balance
                </span>
              )}
            </CardTitle>
            {allowCreate && (
              <IssueCreditMemoDialog
                scope={{
                  customerId: customer.id,
                  customerName: customer.name,
                  projectId: null,
                  projectName: null,
                  invoiceId: null,
                  invoiceNumber: null,
                  suggestDeductCO: false,
                }}
                triggerLabel="Issue credit memo"
              />
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {creditMemos.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No credit memos for this customer.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creditMemos.map((cm) => {
                  const open = Number(cm.amount) - Number(cm.appliedAmount);
                  return (
                    <TableRow key={cm.id}>
                      <TableCell className="font-mono text-xs text-slate-700">
                        {cm.number}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {cm.issueDate}
                      </TableCell>
                      <TableCell className="text-slate-700 text-xs capitalize">
                        {cm.status.replace('_', ' ')}
                      </TableCell>
                      <TableCell className="text-slate-700 text-xs">
                        {cm.reason}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(cm.amount)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          open > 0 ? 'text-amber-700 font-medium' : 'text-slate-400'
                        }`}
                      >
                        {formatMoney(open)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-900">{value}</span>
    </div>
  );
}
