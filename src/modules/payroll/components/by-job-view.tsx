// "By Job" view: hours allocated to specific projects this week. Grouped
// by project, with employee + day breakdown inside each group. Includes a
// dedicated "Unassigned" group for entries that have no project_id — those
// are general timesheet hours that haven't been allocated yet.

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

export type ByJobRow = {
  id: string;
  workDate: string;
  employeeName: string;
  projectId: string | null;
  projectName: string; // "Unassigned" when null
  costCode: string | null;
  hours: string;
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
        <p className="text-slate-600">No time entries for this week yet.</p>
        {allowEdit && !locked && (
          <div className="mt-4 inline-flex">
            <Link href={`/payroll/entries/new?workDate=${weekStart}`}>
              <Button>Add time entry</Button>
            </Link>
          </div>
        )}
      </div>
    );
  }

  // Group rows by project so each project gets its own header band.
  const groups = new Map<string, { name: string; rows: ByJobRow[] }>();
  for (const r of rows) {
    const key = r.projectId ?? '__unassigned__';
    const g = groups.get(key);
    if (g) g.rows.push(r);
    else groups.set(key, { name: r.projectName, rows: [r] });
  }
  // Sort groups so "Unassigned" lands at the bottom.
  const ordered = Array.from(groups.entries()).sort(([ka, va], [kb, vb]) => {
    if (ka === '__unassigned__') return 1;
    if (kb === '__unassigned__') return -1;
    return va.name.localeCompare(vb.name);
  });

  return (
    <div className="space-y-4">
      {ordered.map(([key, g]) => {
        const total = g.rows.reduce((a, r) => a + Number(r.hours), 0);
        return (
          <div key={key} className="rounded-lg border border-slate-200 bg-white">
            <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900">{g.name}</h2>
                {key === '__unassigned__' && (
                  <Badge tone="amber">Not allocated to a job</Badge>
                )}
              </div>
              <span className="text-xs text-slate-500 tabular-nums">
                {g.rows.length} {g.rows.length === 1 ? 'entry' : 'entries'} ·{' '}
                <strong className="text-slate-900">{total.toFixed(2)}</strong> hrs
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Cost code</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
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
                      {Number(r.hours).toFixed(2)}
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
