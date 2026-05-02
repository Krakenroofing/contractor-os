'use client';

// Client filter bar shared across every report page. Submits via GET so the
// resulting URL is shareable / bookmarkable (and so the CSV export endpoint
// can read the same query params).

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  buildCsvUrl,
  type ReportType,
  type ReportFilters,
  REPORT_SUPPORTS_PROJECT_FILTER,
} from '@/modules/reports/lib/filters';

export function FilterBar({
  reportType,
  initial,
  projects,
}: {
  reportType: ReportType;
  initial: ReportFilters;
  projects: { id: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [projectId, setProjectId] = useState(initial.projectId);
  const [pending, startTransition] = useTransition();

  const supportsProject = REPORT_SUPPORTS_PROJECT_FILTER[reportType];

  function applyFilters() {
    const params = new URLSearchParams(searchParams);
    if (from) params.set('from', from);
    else params.delete('from');
    if (to) params.set('to', to);
    else params.delete('to');
    if (supportsProject && projectId) params.set('projectId', projectId);
    else params.delete('projectId');
    const qs = params.toString();
    startTransition(() => {
      // Cast through unknown — typedRoutes is OK with the pathname value at
      // runtime; we just lose the literal-route narrowing in the type system.
      router.push(
        `${pathname}${qs ? `?${qs}` : ''}` as unknown as Parameters<typeof router.push>[0],
      );
    });
  }

  function clearFilters() {
    setFrom('');
    setTo('');
    setProjectId('');
    startTransition(() => {
      router.push(pathname as unknown as Parameters<typeof router.push>[0]);
    });
  }

  const csvHref = buildCsvUrl(reportType, { from, to, projectId });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 print:hidden">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="space-y-1">
          <Label>From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {supportsProject && (
          <div className="space-y-1">
            <Label>Project</Label>
            <Select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="flex items-end gap-2">
          <Button type="button" onClick={applyFilters} disabled={pending}>
            {pending ? 'Applying…' : 'Apply'}
          </Button>
          <Button type="button" variant="outline" onClick={clearFilters} disabled={pending}>
            Clear
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100">
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
          Print / Save as PDF
        </Button>
        <Link href={{ pathname: csvHref }} target="_blank" rel="noopener noreferrer">
          <Button type="button" variant="outline" size="sm">
            Download CSV
          </Button>
        </Link>
        <p className="text-xs text-slate-500 ml-2">
          Print uses your browser&apos;s print dialog (choose &ldquo;Save as PDF&rdquo;
          to save). CSV is filtered to match the visible rows.
        </p>
      </div>
    </div>
  );
}
