import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney, parseMoney, subtract } from '@/lib/money';
import { listInvoices } from '@/lib/data/invoices';
import { listPayments } from '@/lib/data/invoice-payments';
import { BACKFILL_CUTOFF_ISO } from '@/modules/backfill/lib/backfill';
import { PaymentMiniForm } from '@/modules/backfill/components/payment-mini-form';
import { StepShell } from '@/modules/backfill/components/step-shell';

export const dynamic = 'force-dynamic';

const CUTOFF = new Date(`${BACKFILL_CUTOFF_ISO}T00:00:00Z`);

export default async function BackfillPaymentsPage() {
  const role = await getActiveRole();
  if (!canView(role, 'backfill')) redirect('/dashboard');
  const companyId = await getActiveCompanyId();
  const [invoices, payments] = await Promise.all([
    listInvoices(companyId),
    listPayments(companyId),
  ]);

  // Build the dropdown of invoices that still have a balance.
  const options = invoices
    .filter((i) => i.status !== 'void')
    .filter((i) => subtract(parseMoney(i.total), parseMoney(i.amountPaid)) > 0)
    .map((i) => ({
      id: i.id,
      label: `${i.number} · ${formatMoney(
        subtract(parseMoney(i.total), parseMoney(i.amountPaid)),
      )} due`,
    }));

  const recent = payments.filter(
    (p) => new Date(`${p.paidDate}T00:00:00Z`).getTime() >= CUTOFF.getTime(),
  );

  return (
    <StepShell
      step="payments"
      prevHref="/backfill/invoices"
      nextHref="/backfill/purchase-orders"
    >
      <Card>
        <CardHeader>
          <CardTitle>Record a payment</CardTitle>
        </CardHeader>
        <CardContent>
          <PaymentMiniForm invoices={options} />
          <p className="text-xs text-slate-500 mt-3">
            Recording a received/applied payment automatically updates the invoice&apos;s
            amount paid and status. Partial payments are allowed.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Payments entered ({recent.length})</CardTitle>
            <Link href={{ pathname: '/payments' }} className="text-sm text-slate-500 hover:underline">
              Full payment list →
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No payments backfilled yet.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {recent.map((p) => {
                const inv = invoices.find((i) => i.id === p.invoiceId);
                return (
                  <li
                    key={p.id}
                    className="py-2 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">
                        <span className="font-mono text-xs text-slate-500 mr-2">
                          {p.paymentNumber || 'PAY'}
                        </span>
                        {formatMoney(p.amount)} via {p.method ?? '—'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {p.paidDate}
                        {inv ? ` · invoice ${inv.number}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone="slate">{p.status}</Badge>
                      <Link
                        href={{ pathname: `/payments/${p.id}` }}
                        className="text-xs text-slate-600 hover:underline"
                      >
                        Open →
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </StepShell>
  );
}
