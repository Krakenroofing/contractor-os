import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listProjects } from '@/lib/data/projects';
import { listInvoices } from '@/lib/data/invoices';
import { BACKFILL_CUTOFF_ISO } from '@/modules/backfill/lib/backfill';
import { InvoiceMiniForm } from '@/modules/backfill/components/invoice-mini-form';
import { StepShell } from '@/modules/backfill/components/step-shell';

export const dynamic = 'force-dynamic';

const CUTOFF = new Date(`${BACKFILL_CUTOFF_ISO}T00:00:00Z`);

export default async function BackfillInvoicesPage() {
  const role = await getActiveRole();
  if (!canView(role, 'backfill')) redirect('/dashboard');
  const companyId = await getActiveCompanyId();
  const [projects, invoices] = await Promise.all([
    listProjects(companyId),
    listInvoices(companyId),
  ]);
  const recent = invoices.filter(
    (i) =>
      i.invoiceDate &&
      new Date(`${i.invoiceDate}T00:00:00Z`).getTime() >= CUTOFF.getTime(),
  );

  return (
    <StepShell
      step="invoices"
      prevHref="/backfill/change-orders"
      nextHref="/backfill/payments"
    >
      <Card>
        <CardHeader>
          <CardTitle>Add an invoice</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoiceMiniForm
            projects={projects.map((p) => ({
              id: p.id,
              label: p.name,
            }))}
          />
          <p className="text-xs text-slate-500 mt-3">
            If you set a retainage %, the held amount is auto-derived from the
            subtotal. Net amount due = subtotal + tax − retainage held.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Invoices entered ({recent.length})</CardTitle>
            <Link href={{ pathname: '/invoices' }} className="text-sm text-slate-500 hover:underline">
              Full invoice list →
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No invoices backfilled yet.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {recent.map((inv) => (
                <li
                  key={inv.id}
                  className="py-2 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">
                      <span className="font-mono text-xs text-slate-500 mr-2">
                        {inv.number}
                      </span>
                      {formatMoney(inv.total)}
                      {Number(inv.retainageAmount) > 0 && (
                        <span className="ml-2 text-xs text-amber-700">
                          retainage {formatMoney(inv.retainageAmount)}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {inv.invoiceDate}
                      {inv.dueDate ? ` · due ${inv.dueDate}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="slate">{inv.status}</Badge>
                    <Link
                      href={{ pathname: `/invoices/${inv.id}` }}
                      className="text-xs text-slate-600 hover:underline"
                    >
                      Open →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </StepShell>
  );
}
