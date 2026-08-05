import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { isDevDemoMode } from '@/lib/auth';
import { canCreate, canView } from '@/lib/permissions';
import { add, formatMoney, parseMoney } from '@/lib/money';
import { getInvoice } from '@/lib/data/invoices';
import { listPayments } from '@/lib/data/invoice-payments';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import {
  PaymentsListClient,
  type PaymentRow,
} from '@/modules/payments/components/payments-list-client';
import type {
  PaymentMethod,
  PaymentStatus,
} from '@/modules/payments/schema';

export const dynamic = 'force-dynamic';

export default async function PaymentsPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  if (!canView(role, 'payments')) redirect('/dashboard');
  const allowCreate = canCreate(role, 'payments');

  const payments = await listPayments(companyId);
  const paymentsWithRefs = await Promise.all(
    payments.map(async (p) => {
      const invoice = await getInvoice(companyId, p.invoiceId);
      const project = invoice
        ? await getProject(companyId, invoice.projectId)
        : undefined;
      const customer = project
        ? await getCustomer(companyId, project.customerId)
        : undefined;
      return { p, invoice, project, customer };
    }),
  );

  const rows: PaymentRow[] = paymentsWithRefs.map(
    ({ p, invoice, project, customer }) => ({
      id: p.id,
      paymentNumber: p.paymentNumber ?? '',
      paidDate: p.paidDate,
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? '—',
      projectId: project?.id ?? null,
      projectName: project?.name ?? '—',
      invoiceId: invoice?.id ?? null,
      invoiceNumber: invoice?.number ?? null,
      method: (p.method ?? 'other') as PaymentMethod,
      reference: p.reference ?? null,
      bankAccount: p.bankAccount ?? null,
      status: p.status as PaymentStatus,
      amount: p.amount,
    }),
  );

  // KPIs always exclude payments tied to voided invoices — a void invoice
  // can never have cash that actually hit the bank, so including those rows
  // would overstate every total.
  const realPayments = paymentsWithRefs.filter(
    (row) => row.invoice?.status !== 'void',
  );
  function splitPayment(row: (typeof realPayments)[number]): {
    gross: number;
    net: number;
    vat: number;
  } {
    const gross = parseMoney(row.p.amount);
    const inv = row.invoice;
    if (!inv) return { gross, net: gross, vat: 0 };
    const sub = parseMoney(inv.subtotal);
    const tax = parseMoney(inv.taxAmount);
    const denom = sub + tax;
    const vatShare = denom > 0 ? tax / denom : 0;
    const vat = gross * vatShare;
    return { gross, net: gross - vat, vat };
  }
  const sumSplit = (rs: typeof realPayments) =>
    rs.reduce(
      (acc, row) => {
        const s = splitPayment(row);
        return {
          gross: add(acc.gross, s.gross),
          net: add(acc.net, s.net),
          vat: add(acc.vat, s.vat),
        };
      },
      { gross: 0, net: 0, vat: 0 },
    );
  const receivedRows = realPayments.filter(
    ({ p }) => p.status === 'received' || p.status === 'applied',
  );
  const pendingRows = realPayments.filter(({ p }) => p.status === 'pending');
  const returnedRows = realPayments.filter(({ p }) => p.status === 'returned');
  const receivedSplit = sumSplit(receivedRows);
  const pendingSplit = sumSplit(pendingRows);
  const returnedSplit = sumSplit(returnedRows);
  const totalReceived = receivedSplit.gross;
  const pendingTotal = pendingSplit.gross;
  const returnedTotal = returnedSplit.gross;

  return (
    <div className="p-8 space-y-6 max-w-[110rem]">
      {isDevDemoMode() && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
          Demo mode — payments are first-class records linked to invoices. Recording a
          payment automatically updates the invoice's amount paid, balance due, and
          status.
        </div>
      )}

      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Payments</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {rows.length} {rows.length === 1 ? 'payment' : 'payments'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {allowCreate && (
            <Link href="/payments/new">
              <Button>Record Payment</Button>
            </Link>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPI
          label="Received & applied (gross)"
          value={formatMoney(totalReceived)}
          valueClassName="text-emerald-700"
          sub={`revenue ${formatMoney(receivedSplit.net)} · VAT collected ${formatMoney(receivedSplit.vat)}`}
        />
        <KPI
          label="Pending (gross)"
          value={formatMoney(pendingTotal)}
          valueClassName={pendingTotal > 0 ? 'text-amber-700' : undefined}
          sub={`revenue ${formatMoney(pendingSplit.net)} · VAT ${formatMoney(pendingSplit.vat)}`}
        />
        <KPI
          label="Returned (gross)"
          value={formatMoney(returnedTotal)}
          valueClassName={returnedTotal > 0 ? 'text-red-600' : undefined}
          sub={`revenue ${formatMoney(returnedSplit.net)} · VAT ${formatMoney(returnedSplit.vat)}`}
        />
      </div>
      <p className="text-xs text-slate-500">
        <strong>Revenue</strong> = payment × (subtotal / total) of the parent
        invoice. <strong>VAT collected</strong> is the rest — a liability owed
        to the government, not income.
      </p>

      <PaymentsListClient rows={rows} />
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
