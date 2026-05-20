import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { formatMoney, parseMoney, subtract } from '@/lib/money';
import { getInvoice } from '@/lib/data/invoices';
import { getPayment } from '@/lib/data/invoice-payments';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import {
  METHOD_LABEL,
  STATUS_LABEL,
  type PaymentMethod,
  type PaymentStatus,
} from '@/modules/payments/schema';
import { ActivityLogCard } from '@/modules/status/components/activity-log-card';
import { StatusBadge } from '@/modules/status/components/status-badge';
import { StatusPanel } from '@/modules/status/components/status-panel';

export const dynamic = 'force-dynamic';

export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'payments');

  const payment = await getPayment(companyId, id);
  if (!payment) notFound();

  const invoice = await getInvoice(companyId, payment.invoiceId);
  const project = invoice ? await getProject(companyId, invoice.projectId) : undefined;
  const customer = project ? await getCustomer(companyId, project.customerId) : undefined;

  const method = (payment.method ?? 'other') as PaymentMethod;
  const status = payment.status as PaymentStatus;

  const balanceAfter = invoice
    ? subtract(parseMoney(invoice.total), parseMoney(invoice.amountPaid))
    : 0;

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/payments', label: 'Payments' },
          { label: payment.paymentNumber || 'Payment' },
        ]}
      />

      <div className="flex items-center justify-between">
        <Link href="/payments">
          <Button variant="outline" size="sm">
            ← Back to Payments
          </Button>
        </Link>
        {allowCreate && (
          <Link href="/payments/new">
            <Button size="sm">Record Payment</Button>
          </Link>
        )}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-slate-500">
            {payment.paymentNumber || 'Payment'}
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">
            {formatMoney(payment.amount)} via {METHOD_LABEL[method] ?? payment.method}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-600">
            <span>{payment.paidDate}</span>
            {customer && (
              <>
                <span className="text-slate-400">·</span>
                <span>{customer.name}</span>
              </>
            )}
            {project && (
              <>
                <span className="text-slate-400">·</span>
                <Link href={`/projects/${project.id}`} className="hover:underline">
                  {project.name}
                </Link>
              </>
            )}
            {invoice && (
              <>
                <span className="text-slate-400">·</span>
                <Link href={`/invoices/${invoice.id}`} className="hover:underline">
                  {invoice.number}
                </Link>
              </>
            )}
          </div>
        </div>
        <StatusBadge entityType="payment" status={payment.status} />
      </div>

      <StatusPanel
        entityType="payment"
        entityId={payment.id}
        status={payment.status}
        timestamps={[
          { label: 'Recorded', value: payment.createdAt },
          { label: 'Paid date', value: payment.paidDate },
        ]}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="Amount" value={formatMoney(payment.amount)} highlight />
        <KPI label="Method" value={METHOD_LABEL[method] ?? payment.method ?? '—'} />
        <KPI label="Reference" value={payment.reference ?? '—'} />
        <KPI label="Paid date" value={payment.paidDate} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Receipt</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <Row label="Payment number" value={payment.paymentNumber || '—'} />
          <Row label="Status" value={STATUS_LABEL[status]} />
          <Row label="Method" value={METHOD_LABEL[method] ?? payment.method ?? '—'} />
          <Row label="Reference" value={payment.reference ?? '—'} />
          <Row label="Bank / account" value={payment.bankAccount ?? '—'} />
        </CardContent>
      </Card>

      {invoice && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Applied to invoice</CardTitle>
              <Link href={`/invoices/${invoice.id}`}>
                <Button size="sm" variant="outline">
                  View invoice →
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Invoice" value={invoice.number} />
              <Stat label="Total" value={formatMoney(invoice.total)} />
              <Stat
                label="Amount paid"
                value={formatMoney(invoice.amountPaid)}
                valueClassName="text-emerald-700"
              />
              <Stat
                label="Balance due"
                value={formatMoney(balanceAfter)}
                valueClassName={
                  balanceAfter <= 0 ? 'text-emerald-700' : 'text-amber-700'
                }
              />
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Invoice status is now{' '}
              <span className="font-medium text-slate-800">{invoice.status}</span> based
              on the cumulative received & applied payments.
            </p>
          </CardContent>
        </Card>
      )}

      {payment.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap text-slate-800">
            {payment.notes}
          </CardContent>
        </Card>
      )}

      <ActivityLogCard entityType="payment" entityId={payment.id} />
    </div>
  );
}

function KPI({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${
            highlight ? 'text-emerald-700' : 'text-slate-900'
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
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

function Stat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-0.5 text-base font-medium tabular-nums ${
          valueClassName ?? 'text-slate-900'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
