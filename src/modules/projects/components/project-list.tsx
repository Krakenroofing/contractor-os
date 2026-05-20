import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney, parseMoney } from '@/lib/money';
import type { ProjectListRow } from '../queries';
import { ProjectStatusBadge } from './status-badge';

export function ProjectList({ projects }: { projects: ProjectListRow[] }) {
  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
        <p className="text-slate-600">No projects yet.</p>
        <p className="mt-1 text-sm text-slate-500">
          Create your first project to start tracking job profitability.
        </p>
        <div className="mt-4 inline-flex">
          <Link href="/projects/new">
            <Button>New Project</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Contract</TableHead>
            <TableHead className="text-right">Projected GP</TableHead>
            <TableHead className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((p) => {
            const profit = parseMoney(p.contractValue) - parseMoney(p.currentBudget);
            return (
              <TableRow key={p.id}>
                <TableCell className="font-medium text-slate-900">{p.name}</TableCell>
                <TableCell className="text-slate-600">{p.customerName}</TableCell>
                <TableCell>
                  <ProjectStatusBadge status={p.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(p.contractValue)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${
                    profit < 0 ? 'text-red-600' : 'text-slate-900'
                  }`}
                >
                  {formatMoney(profit)}
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/projects/${p.id}`}>
                    <Button size="sm" variant="outline">
                      View Project
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
