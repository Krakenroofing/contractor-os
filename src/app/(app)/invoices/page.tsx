import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { isDevDemoMode } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { add, formatMoney, parseMoney } from '@/lib/money';
import { listInvoices } from '@/lib/data/invoices';
import { listInvoicePaymentsForCompany } from '@/lib/data/invoice-payments';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import {
  computeInvoiceFinancials,
  computeInvoiceVatSplit,
  groupPaymentsByInvoice,
} from '@/modules/invoices/lib/financials';
import { ReconcileButton } from '@/modules/invoices/components/reconcile-button';
import {
  InvoicesListClient,
  type InvoiceListRow,
} from '@/modules/invoices/components/invoices-list-client';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'invoices');

  const allInvoices = await listInvoices(companyId);
  const allPayments = await listInvoicePaymentsForCompany(companyId);
  const paymentsByInvoice = groupPaymentsByInvoice(allPayments);

  const rows: InvoiceListRow[] = await Promise.all(
    allInvoices.map(async (inv) => {
      const project = await getProject(companyId, inv.projectId);
      const customer = project
        ? await getCustomer(companyId, project.customerId)
        : undefined;
      const invPayments = paymentsByInvoice.get(inv.id) ?? [];
      const fin = computeInvoiceFinancials(inv, invPayments);
      // Date paid = the settle date — the latest received/applied payment date
      // once the invoice is fully paid. Blank while a balance remains. This is
      // the date that lines up against QuickBooks' payment date.
      const settled = fin.balance <= 0.005 && invPayments.length > 0;
      const datePaid = settled
        ? (invPayments
            .filter((p) => p.status === 'received' || p.status === 'applied')
            .map((p) => p.paidDate)
            .sort()
            .at(-1) ?? null)
        : null;
      return {
        id: inv.id,
        number: inv.number,
        projectId: inv.projectId,
        projectName: project?.name ?? '—',
        customerId: project?.customerId ?? null,
        customerName: customer?.name ?? '—',
        billingType: inv.billingType,
        status: inv.status,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate ?? null,
        datePaid,
        total: parseMoney(inv.total),
        subtotal: parseMoney(inv.subtotal),
        taxAmount: parseMoney(inv.taxAmount),
        balance: fin.balance,
      };
    }),
  );

  // KPIs stay company-wide — they're computed from the full non-void set
  // and never react to the in-table filters. Net/VAT split: revenue is
  // subtotal; VAT is a liability collected on the government's behalf —
  // never income. Paid amounts split proportionally per invoice's tax/total
  // ratio.
  let totalInvoiced = 0;
  let totalInvoicedNet = 0;
  let totalInvoicedVat = 0;
  let totalPaid = 0;
  let totalPaidNet = 0;
  let totalPaidVat = 0;
  let outstanding = 0;
  let outstandingNet = 0;
  let outstandingVat = 0;
  for (const inv of allInvoices) {
    if (inv.status === 'void') continue;
    const split = computeInvoiceVatSplit(
      inv,
      paymentsByInvoice.get(inv.id) ?? [],
    );
    totalInvoiced = add(totalInvoiced, split.gross);
    totalInvoicedNet = add(totalInvoicedNet, split.net);
    totalInvoicedVat = add(totalInvoicedVat, split.vat);
    totalPaid = add(totalPaid, split.paidGross);
    totalPaidNet = add(totalPaidNet, split.paidNet);
    totalPaidVat = add(totalPaidVat, split.paidVat);
    outstanding = add(outstanding, split.balanceGross);
    outstandingNet = add(outstandingNet, split.balanceNet);
    outstandingVat = add(outstandingVat, split.balanceVat);
  }

  // Header count excludes voids — they're hidden in the list by default
  // and never count toward any total, so showing them here would just
  // inflate the number the operator scans against QuickBooks.
  const totalCount = rows.filter((r) => r.status !== 'void').length;

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      {isDevDemoMode() && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
          Demo mode — invoices loaded from the in-memory mock store. Project totals on
          /projects update live as invoices are created.
        </div>
      )}

      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Invoices</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {totalCount} {totalCount === 1 ? 'invoice' : 'invoices'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {allowCreate && <ReconcileButton />}
          {allowCreate && (
            <Link href="/invoices/new">
              <Button>New Invoice</Button>
            </Link>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPI
          label="Revenue invoiced (net)"
          value={formatMoney(totalInvoicedNet)}
          sub={`VAT ${formatMoney(totalInvoicedVat)} · gross ${formatMoney(totalInvoiced)}`}
        />
        <KPI
          label="Revenue collected (net)"
          value={formatMoney(totalPaidNet)}
          valueClassName="text-emerald-700"
          sub={`VAT collected ${formatMoney(totalPaidVat)} · gross ${formatMoney(totalPaid)}`}
        />
        <KPI
          label="Outstanding balance (gross)"
          value={formatMoney(outstanding)}
          valueClassName={outstanding > 0 ? 'text-amber-700' : 'text-slate-900'}
          sub={`net ${formatMoney(outstandingNet)} · VAT ${formatMoney(outstandingVat)}`}
        />
      </div>

      <InvoicesListClient rows={rows} allowCreate={allowCreate} />
    </div>
  );
}

function KPI({
  label,
  value,
  valueClassName,
  sub,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${
            valueClassName ?? 'text-slate-900'
          }`}
        >
          {value}
        </p>
        {sub && (
          <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}
