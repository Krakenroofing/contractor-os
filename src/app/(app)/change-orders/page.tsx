import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney } from '@/lib/money';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  getMockCustomer,
  getMockProject,
  getMockProposal,
  listMockChangeOrders,
} from '@/lib/mock-store';
import { STATUS_LABEL, STATUS_TONE } from '@/modules/change-orders/schema';

export const dynamic = 'force-dynamic';

export default async function ChangeOrdersPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'change_orders');
  const cos = listMockChangeOrders(companyId);

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
        Demo mode — change orders loaded from the in-memory mock store
        (<code className="font-mono">src/lib/mock-store.ts</code>). Approved COs roll
        into the project's contract value and approved-CO summary on /projects.
      </div>

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Change Orders</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {cos.length} {cos.length === 1 ? 'change order' : 'change orders'}
          </p>
        </div>
        {allowCreate && (
          <Link href="/change-orders/new">
            <Button>New Change Order</Button>
          </Link>
        )}
      </header>

      {cos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">No change orders yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            Document scope changes and adjust contract value in one motion.
          </p>
          <div className="mt-4 inline-flex">
            <Link href="/change-orders/new">
              <Button>New Change Order</Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Proposal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {cos.map((c) => {
                const project = getMockProject(companyId, c.projectId);
                const customer = project
                  ? getMockCustomer(companyId, project.customerId)
                  : undefined;
                const proposal = c.proposalId
                  ? getMockProposal(companyId, c.proposalId)
                  : undefined;
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs text-slate-700">
                      {c.number}
                    </TableCell>
                    <TableCell className="font-medium text-slate-900">
                      {project?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-slate-600">{customer?.name ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {proposal?.number ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {c.submittedAt ?? '—'}
                    </TableCell>
                    <TableCell className="text-slate-600">{c.approvedAt ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {c.scheduleImpactDays}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(c.total)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/change-orders/${c.id}`}>
                        <Button size="sm" variant="outline">
                          View Change Order
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
