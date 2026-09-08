// Office → Work Orders: every field-submitted service call, with its review
// status. Submitted ones need Chris: review → client → invoice → post.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canView } from '@/lib/permissions';
import { listWorkOrders } from '@/lib/data/work-orders';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, { label: string; tone: 'amber' | 'green' | 'slate' }> = {
  submitted: { label: 'To review', tone: 'amber' },
  posted: { label: 'Posted', tone: 'green' },
  void: { label: 'Void', tone: 'slate' },
};

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  await requireAuth();
  const role = await getActiveRole();
  if (!canView(role, 'projects')) redirect('/dashboard' as never);
  const companyId = await getActiveCompanyId();
  const sp = (await searchParams) ?? {};
  const statusFilter =
    sp.status === 'submitted' || sp.status === 'posted' || sp.status === 'void'
      ? sp.status
      : undefined;
  const rows = await listWorkOrders(companyId, { status: statusFilter });

  const filterLink = (status: string | undefined, label: string) => (
    <Link
      href={{
        pathname: '/work-orders',
        query: status ? { status } : undefined,
      }}
      className={`rounded-md border px-2.5 py-1 text-xs ${
        statusFilter === status || (!statusFilter && !status)
          ? 'border-slate-800 bg-slate-900 text-white'
          : 'border-slate-300 text-slate-700 hover:bg-slate-50'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="p-8 space-y-5 max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Work orders</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Service calls submitted from the field. Review → record the client →
          invoice → post to job costing.
        </p>
      </header>

      <div className="flex items-center gap-2">
        {filterLink(undefined, 'All')}
        {filterLink('submitted', 'To review')}
        {filterLink('posted', 'Posted')}
        {filterLink('void', 'Void')}
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>WO #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Submitted by</TableHead>
                <TableHead>Requested by</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-sm text-slate-500">
                    No work orders{statusFilter ? ' with this status' : ' yet'}
                    . Crews submit them from the field app (Work order card).
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((wo) => {
                  const s = STATUS_BADGE[wo.status] ?? STATUS_BADGE.submitted;
                  return (
                    <TableRow key={wo.id}>
                      <TableCell>
                        <Link
                          href={{ pathname: `/work-orders/${wo.id}` }}
                          className="font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900"
                        >
                          {wo.number}
                        </Link>
                      </TableCell>
                      <TableCell className="tabular-nums text-slate-700">
                        {wo.workDate}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {wo.employeeName}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {wo.requestedBy ?? '—'}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {wo.customerName ?? (
                          <span className="text-amber-700">needs client</span>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {wo.projectId ? (
                          <Link
                            href={{ pathname: `/projects/${wo.projectId}` }}
                            className="hover:underline"
                          >
                            {wo.projectName}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {wo.invoiceId ? (
                          <Link
                            href={{ pathname: `/invoices/${wo.invoiceId}` }}
                            className="hover:underline"
                          >
                            #{wo.invoiceNumber}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
