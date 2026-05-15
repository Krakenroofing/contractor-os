import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate, canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listReceipts } from '@/lib/data/receipts';
import { listProjects } from '@/lib/data/projects';
import { listVendors } from '@/lib/data/vendors';
import { RECEIPT_STATUS_LABEL } from '@/modules/receipts/schema';

export const dynamic = 'force-dynamic';

export default async function ReceiptsPage() {
  const role = await getActiveRole();
  if (!canView(role, 'receipts')) redirect('/banking' as never);
  const company = await getActiveCompany();
  const [receipts, projects, vendors] = await Promise.all([
    listReceipts(company.id, { limit: 200 }),
    listProjects(company.id),
    listVendors(company.id),
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p.number + ' — ' + p.name]));
  const vendorById = new Map(vendors.map((v) => [v.id, v.name]));
  const canAdd = canCreate(role, 'receipts');

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={{ pathname: '/banking' }}
            className="text-xs text-slate-500 hover:text-slate-900"
          >
            ← Back to Banking
          </Link>
          <h1 className="text-xl font-semibold text-slate-900 mt-1">
            Receipts
          </h1>
          <p className="text-sm text-slate-500">
            Upload receipts, assign to a project + cost code, post to job costs
            when ready.{' '}
            {company.isVatActive
              ? 'VAT split on TRB.'
              : 'No VAT — Kraken posts gross.'}
          </p>
        </div>
        {canAdd && (
          <Link href={{ pathname: '/banking/receipts/new' }}>
            <Button>New receipt</Button>
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent receipts</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {receipts.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm text-slate-600">
                No receipts yet. Add one to start tracking field spend.
              </p>
              {canAdd && (
                <Link href={{ pathname: '/banking/receipts/new' }}>
                  <Button>Add your first receipt</Button>
                </Link>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead className="text-right">VAT</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs font-mono">
                      <Link
                        href={{ pathname: `/banking/receipts/${r.id}` }}
                        className="hover:underline"
                      >
                        {r.receiptDate}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.vendorId ? vendorById.get(r.vendorId) ?? '—' : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      {r.projectId ? projectById.get(r.projectId) ?? '—' : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(r.subtotal, r.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-amber-700">
                      {Number(r.vatAmount) > 0
                        ? formatMoney(r.vatAmount, r.currency)
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(r.total, r.currency)}
                    </TableCell>
                    <TableCell className="text-xs">
                      <span
                        className={
                          r.status === 'posted'
                            ? 'inline-block rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5'
                            : r.status === 'void'
                              ? 'inline-block rounded bg-slate-200 text-slate-700 px-1.5 py-0.5'
                              : 'inline-block rounded bg-amber-100 text-amber-800 px-1.5 py-0.5'
                        }
                      >
                        {RECEIPT_STATUS_LABEL[r.status]}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
