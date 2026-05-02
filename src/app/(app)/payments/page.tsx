import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { add, formatMoney, parseMoney } from '@/lib/money';
import { getInvoice } from '@/lib/data/invoices';
import { listPayments } from '@/lib/data/invoice-payments';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import {
  METHOD_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  type PaymentMethod,
  type PaymentStatus,
} from '@/modules/payments/schema';

export const dynamic = 'force-dynamic';

export default async function PaymentsPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
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

  const totalReceived = payments
    .filter((p) => p.status === 'received' || p.status === 'applied')
    .reduce((acc, p) => add(acc, parseMoney(p.amount)), 0);
  const pendingTotal = payments
    .filter((p) => p.status === 'pending')
    .reduce((acc, p) => add(acc, parseMoney(p.amount)), 0);
  const returnedTotal = payments
    .filter((p) => p.status === 'returned')
    .reduce((acc, p) => add(acc, parseMoney(p.amount)), 0);

  return (
    <div className="p-8 space-y-6 max-w-[110rem]">
      <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
        Demo mode — payments are first-class records linked to invoices. Recording a
        payment automatically updates the invoice's amount paid, balance due, and
        status.
      </div>

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Payments</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {payments.length} {payments.length === 1 ? 'payment' : 'payments'}
          </p>
        </div>
        {allowCreate && (
          <Link href="/payments/new">
            <Button>Record Payment</Button>
          </Link>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPI
          label="Received & applied"
          value={formatMoney(totalReceived)}
          valueClassName="text-emerald-700"
        />
        <KPI
          label="Pending"
          value={formatMoney(pendingTotal)}
          valueClassName={pendingTotal > 0 ? 'text-amber-700' : undefined}
        />
        <KPI
          label="Returned"
          value={formatMoney(returnedTotal)}
          valueClassName={returnedTotal > 0 ? 'text-red-600' : undefined}
        />
      </div>

      {payments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">No payments recorded yet.</p>
          {allowCreate && (
            <div className="mt-4 inline-flex">
              <Link href="/payments/new">
                <Button>Record Payment</Button>
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Bank</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paymentsWithRefs.map(({ p, invoice, project, customer }) => {
                const method = (p.method ?? 'other') as PaymentMethod;
                const status = p.status as PaymentStatus;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs text-slate-700">
                      {p.paymentNumber || '—'}
                    </TableCell>
                    <TableCell className="text-slate-600">{p.paidDate}</TableCell>
                    <TableCell className="text-slate-600">
                      {customer?.name ?? '—'}
                    </TableCell>
                    <TableCell className="font-medium text-slate-900">
                      {project?.name ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {invoice ? (
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="hover:underline text-slate-700"
                        >
                          {invoice.number}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {METHOD_LABEL[method] ?? p.method ?? '—'}
                    </TableCell>
                    <TableCell className="text-slate-600 font-mono text-xs">
                      {p.reference ?? '—'}
                    </TableCell>
                    <TableCell className="text-slate-600 text-xs">
                      {p.bankAccount ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(p.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/payments/${p.id}`}>
                        <Button size="sm" variant="outline">
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function KPI({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
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
      </CardContent>
    </Card>
  );
}
