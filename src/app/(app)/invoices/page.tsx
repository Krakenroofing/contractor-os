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
import { add, formatMoney, parseMoney, subtract } from '@/lib/money';
import { listInvoices } from '@/lib/data/invoices';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import {
  BILLING_TYPE_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
} from '@/modules/invoices/schema';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'invoices');

  const invoices = await listInvoices(companyId);
  const invoicesWithRefs = await Promise.all(
    invoices.map(async (inv) => {
      const project = await getProject(companyId, inv.projectId);
      const customer = project
        ? await getCustomer(companyId, project.customerId)
        : undefined;
      return { inv, project, customer };
    }),
  );

  let totalInvoiced = 0;
  let totalPaid = 0;
  for (const inv of invoices) {
    if (inv.status === 'void') continue;
    totalInvoiced = add(totalInvoiced, parseMoney(inv.total));
    totalPaid = add(totalPaid, parseMoney(inv.amountPaid));
  }
  const outstanding = subtract(totalInvoiced, totalPaid);

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
        Demo mode — invoices loaded from the in-memory mock store. Project totals on
        /projects update live as invoices are created.
      </div>

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Invoices</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {invoices.length} {invoices.length === 1 ? 'invoice' : 'invoices'}
          </p>
        </div>
        {allowCreate && (
          <Link href="/invoices/new">
            <Button>New Invoice</Button>
          </Link>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPI label="Total invoiced" value={formatMoney(totalInvoiced)} />
        <KPI label="Total paid" value={formatMoney(totalPaid)} valueClassName="text-emerald-700" />
        <KPI
          label="Outstanding balance"
          value={formatMoney(outstanding)}
          valueClassName={outstanding > 0 ? 'text-amber-700' : 'text-slate-900'}
        />
      </div>

      {invoices.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">No invoices yet.</p>
          {allowCreate && (
            <div className="mt-4 inline-flex">
              <Link href="/invoices/new">
                <Button>New Invoice</Button>
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
                <TableHead>Project</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invoice date</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoicesWithRefs.map(({ inv, project, customer }) => {
                const balance = subtract(parseMoney(inv.total), parseMoney(inv.amountPaid));
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-xs text-slate-700">
                      {inv.number}
                    </TableCell>
                    <TableCell className="font-medium text-slate-900">
                      {project?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {customer?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {BILLING_TYPE_LABEL[inv.billingType]}
                    </TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONE[inv.status]}>
                        {STATUS_LABEL[inv.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-600">{inv.invoiceDate}</TableCell>
                    <TableCell className="text-slate-600">{inv.dueDate ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(inv.total)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        balance <= 0 ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {formatMoney(balance)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/invoices/${inv.id}`}>
                        <Button size="sm" variant="outline">
                          View Invoice
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
