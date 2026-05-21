// "By Job" view: hours + variable-pay allocated to projects this week.
// Grouped by project, with employee + day + value per row. Includes a
// dedicated "Unassigned" group for entries with no project_id. Same
// rows can be hours (timesheet) or $ amount (piecework / commission /
// contract / lump-sum) — entry_type drives the display.

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

export type ByJobRow = {
  id: string;
  workDate: string;
  employeeName: string;
  projectId: string | null;
  projectName: string; // "Overhead" or "Unassigned" when projectId is null
  isOverhead: boolean;
  costCode: string | null;
  entryType: 'hours' | 'amount';
  hours: string;
  amount: string;
  notes: string | null;
  canEdit: boolean;
};

export function ByJobView({
  rows,
  allowEdit,
  locked,
  weekStart,
}: {
  rows: ByJobRow[];
  allowEdit: boolean;
  locked: boolean;
  weekStart: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
        <p className="text-slate-600">No entries for this week yet.</p>
        {allowEdit && !locked && (
          <div className="mt-4 inline-flex">
            <Link href={`/payroll/entries/new?workDate=${weekStart}`}>
              <Button>Add entry</Button>
            </Link>
          </div>
        )}
      </div>
    );
  }

  // Group rows by project so each project gets its own header band.
  // Three special bucket keys land at the bottom:
  //   __overhead__   — intentional non-project labor.
  //   __unassigned__ — project_id null AND not flagged overhead (needs
  //                    allocation).
  const groups = new Map<string, { name: string; rows: ByJobRow[] }>();
  for (const r of rows) {
    const key = r.projectId
      ? r.projectId
      : r.isOverhead
        ? '__overhead__'
        : '__unassigned__';
    const g = groups.get(key);
    if (g) g.rows.push(r);
    else groups.set(key, { name: r.projectName, rows: [r] });
  }
  // Sort groups so real projects come first, then Overhead, then
  // Unassigned at the very bottom.
  const orderRank = (k: string) =>
    k === '__unassigned__' ? 2 : k === '__overhead__' ? 1 : 0;
  const ordered = Array.from(groups.entries()).sort(([ka, va], [kb, vb]) => {
    const ra = orderRank(ka);
    const rb = orderRank(kb);
    if (ra !== rb) return ra - rb;
    return va.name.localeCompare(vb.name);
  });

  return (
    <div className="space-y-4">
      {ordered.map(([key, g]) => {
        const totalHours = g.rows
          .filter((r) => r.entryType !== 'amount')
          .reduce((a, r) => a + Number(r.hours), 0);
        const totalAmount = g.rows
          .filter((r) => r.entryType === 'amount')
          .reduce((a, r) => a + Number(r.amount), 0);
        return (
          <div key={key} className="rounded-lg border border-slate-200 bg-white">
            <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900">{g.name}</h2>
                {key === '__overhead__' && (
                  <Badge tone="purple">Overhead</Badge>
                )}
                {key === '__unassigned__' && (
                  <Badge tone="amber">Not allocated to a job</Badge>
                )}
              </div>
              <span className="text-xs text-slate-500 tabular-nums">
                {g.rows.length} {g.rows.length === 1 ? 'entry' : 'entries'}
                {totalHours > 0 && (
                  <>
                    {' · '}
                    <strong className="text-slate-900">
                      {totalHours.toFixed(2)}
                    </strong>{' '}
                    hrs
                  </>
                )}
                {totalAmount > 0 && (
                  <>
                    {' · '}
                    <strong className="text-slate-900">
                      {formatMoney(totalAmount)}
                    </strong>{' '}
                    pay
                  </>
                )}
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Cost code</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-slate-600 whitespace-nowrap">
                      {r.workDate}
                    </TableCell>
                    <TableCell className="font-medium text-slate-900">
                      {r.employeeName}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {r.costCode ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {r.entryType === 'amount' ? (
                        <>
                          {formatMoney(r.amount)}
                          <span className="ml-1 text-[10px] text-slate-400">
                            pay
                          </span>
                        </>
                      ) : (
                        <>
                          {Number(r.hours).toFixed(2)}
                          <span className="ml-1 text-[10px] text-slate-400">
                            hrs
                          </span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-600 text-xs">
                      {r.notes ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.canEdit && (
                        <Link href={`/payroll/entries/${r.id}/edit`}>
                          <Button size="sm" variant="outline">
                            Edit
                          </Button>
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      })}
    </div>
  );
}
