import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { getProject } from '@/lib/data/projects';
import { listDailyReportsForProject } from '@/lib/data/daily-reports';
import { STATUS_LABEL, STATUS_TONE } from '@/modules/daily-reports/schema';

export const dynamic = 'force-dynamic';

export default async function DailyReportsListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'daily_reports');

  const project = await getProject(companyId, id);
  if (!project) notFound();

  const reports = await listDailyReportsForProject(companyId, project.id);

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <Breadcrumbs
        items={[
          { href: '/projects', label: 'Projects' },
          { href: `/projects/${project.id}`, label: project.number },
          { label: 'Daily Reports' },
        ]}
      />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="font-mono text-xs text-slate-500">{project.number}</p>
          <h1 className="text-2xl font-semibold text-slate-900">
            Daily Reports
          </h1>
          <p className="text-sm text-slate-600">{project.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/projects/${project.id}`}>
            <Button variant="outline" size="sm">
              ← Back to project
            </Button>
          </Link>
          {allowCreate && (
            <Link href={`/projects/${project.id}/daily-reports/new`}>
              <Button size="sm">+ New daily report</Button>
            </Link>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All reports ({reports.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {reports.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No daily reports for this project yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Foreman</TableHead>
                  <TableHead className="text-right"># Men</TableHead>
                  <TableHead>Weather</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-slate-900">
                      {r.reportDate}
                    </TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONE[r.status]}>
                        {STATUS_LABEL[r.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {r.foremanName ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-700">
                      {r.menOnSite}
                    </TableCell>
                    <TableCell className="text-slate-600 text-xs">
                      {[r.weatherCondition, r.weatherTemperatureF ? `${r.weatherTemperatureF}°F` : null]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/projects/${project.id}/daily-reports/${r.id}`}
                      >
                        <Button size="sm" variant="outline">
                          View
                        </Button>
                      </Link>
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
