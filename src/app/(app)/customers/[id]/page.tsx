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
  listInvoicesForProject,
} from '@/lib/data/invoices';
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

  // Roll up invoice activity across every project for this customer.
  // computeProjectInvoiceSummary already sums payment rows (not the cached
  // amountPaid) — so this stays correct even if a status cache drifted.
  const invoiceSummaries = await Promise.all(
    linkedProjects.map(async (p) => ({
      project: p,
      summary: await computeProjectInvoiceSummary(p.id),
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
  const allInvoices = invoiceSummaries
    .flatMap((row) =>
      row.invoices.map((inv) => ({
        ...inv,
        projectName: row.project.name,
        projectNumber: row.project.number,
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
                        {inv.projectNumber} — {inv.projectName}
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
                    <div className="font-mono text-xs text-slate-500">{p.number}</div>
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
