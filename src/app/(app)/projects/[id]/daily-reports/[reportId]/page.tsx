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
import {
  getDailyReport,
  getManpowerForReport,
  listPhotosForReport,
} from '@/lib/data/daily-reports';
import { createSignedPhotoUrl } from '@/lib/storage/daily-report-photos';
import {
  STATUS_LABEL,
  STATUS_TONE,
} from '@/modules/daily-reports/schema';
import {
  VoidReportForm,
  DeleteReportForm,
} from '@/modules/daily-reports/components/report-actions';
import { PhotoUploader } from '@/modules/daily-reports/components/photo-uploader';
import {
  PhotoCard,
  type PhotoCardData,
} from '@/modules/daily-reports/components/photo-card';

export const dynamic = 'force-dynamic';

export default async function DailyReportViewPage({
  params,
}: {
  params: Promise<{ id: string; reportId: string }>;
}) {
  const { id, reportId } = await params;
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowEdit = canCreate(role, 'daily_reports');

  const project = await getProject(companyId, id);
  if (!project) notFound();

  const report = await getDailyReport(companyId, reportId);
  if (!report) notFound();
  const manpower = await getManpowerForReport(report.id);
  const photos = await listPhotosForReport(report.id);
  const photoCards: PhotoCardData[] = await Promise.all(
    photos.map(async (p) => ({
      id: p.id,
      caption: p.caption ?? '',
      category: p.category,
      visibleToClient: p.visibleToClient,
      fileName: p.fileName,
      signedUrl: await createSignedPhotoUrl(p.storagePath),
      uploadedAt:
        p.uploadedAt instanceof Date
          ? p.uploadedAt.toISOString()
          : String(p.uploadedAt),
    })),
  );

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <Breadcrumbs
        items={[
          { href: '/projects', label: 'Projects' },
          { href: `/projects/${project.id}`, label: project.number },
          {
            href: `/projects/${project.id}/daily-reports`,
            label: 'Daily Reports',
          },
          { label: report.reportDate },
        ]}
      />

      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p className="font-mono text-xs text-slate-500">{project.number}</p>
          <h1 className="text-2xl font-semibold text-slate-900">
            Daily Report · {report.reportDate}
          </h1>
          <p className="text-sm text-slate-600">
            {report.projectNameSnapshot ?? project.name}
            {report.projectLocationSnapshot
              ? ` · ${report.projectLocationSnapshot}`
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={STATUS_TONE[report.status]}>
            {STATUS_LABEL[report.status]}
          </Badge>
          <Link href={`/projects/${project.id}/daily-reports`}>
            <Button size="sm" variant="outline">
              ← Back
            </Button>
          </Link>
          {allowEdit && (
            <Link
              href={`/projects/${project.id}/daily-reports/${report.id}/edit`}
            >
              <Button size="sm" variant="outline">
                Edit
              </Button>
            </Link>
          )}
          {allowEdit && report.status !== 'void' && (
            <VoidReportForm projectId={project.id} reportId={report.id} />
          )}
          {allowEdit && <DeleteReportForm projectId={project.id} reportId={report.id} />}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Weather</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <Row label="Condition" value={report.weatherCondition ?? '—'} />
            <Row
              label="Temperature"
              value={
                report.weatherTemperatureF
                  ? `${report.weatherTemperatureF}°F`
                  : '—'
              }
            />
            <Row label="Precipitation" value={report.weatherPrecipitation ?? '—'} />
            <Row label="Wind" value={report.weatherWind ?? '—'} />
            <Row label="Humidity" value={report.weatherHumidity ?? '—'} />
            <Row label="Source" value={report.weatherSource} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Site & crew</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <Row label="Site conditions" value={report.siteConditions ?? '—'} />
            <Row label="Men on site" value={String(report.menOnSite)} />
            <Row label="Crew / Company" value={report.crewCompanyName ?? '—'} />
            <Row label="Foreman" value={report.foremanName ?? '—'} />
            <Row label="Prepared by" value={report.preparedByName ?? '—'} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Manpower ({manpower.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {manpower.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No manpower rows.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company / Crew</TableHead>
                  <TableHead>Trade</TableHead>
                  <TableHead className="text-right"># Men</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {manpower.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-slate-900">
                      {m.companyCrew ?? '—'}
                    </TableCell>
                    <TableCell className="text-slate-700">
                      {m.trade ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.workerCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.hours}
                    </TableCell>
                    <TableCell className="text-slate-600 text-xs">
                      {m.notes ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Photos ({photoCards.length})</CardTitle>
            <span className="text-xs text-slate-500">
              {report.includePhotosInExport
                ? 'Photos toggle is ON for client export — only photos marked client-visible will appear.'
                : 'Photos are excluded from client export.'}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {allowEdit && (
            <PhotoUploader projectId={project.id} reportId={report.id} />
          )}
          {photoCards.length === 0 ? (
            <p className="text-sm text-slate-500">
              No photos yet. Upload one above.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {photoCards.map((p) => (
                <PhotoCard
                  key={p.id}
                  projectId={project.id}
                  reportId={report.id}
                  photo={p}
                  allowEdit={allowEdit}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Block title="Work performed today" body={report.workPerformed} />
        <Block title="Materials delivered" body={report.materialsDelivered} />
        <Block title="Equipment on site" body={report.equipmentOnSite} />
        <Block title="Inspections" body={report.inspections} />
        <Block title="Delays" body={report.delays} />
        <Block title="Safety incidents" body={report.safetyIncidents} />
        <Block title="Visitors on site" body={report.visitorsOnSite} />
        <Block title="Issues / Concerns" body={report.issuesConcerns} />
        <Block title="Tomorrow's planned work" body={report.tomorrowPlan} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Block
          title="Internal notes"
          body={report.internalNotes}
          subtitle="Never appears on client export."
        />
        <Block
          title="Client-facing notes"
          body={report.clientNotes}
          subtitle={
            report.includeClientNotesInExport
              ? 'Will appear on client export.'
              : 'Currently excluded from client export.'
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Client export settings</CardTitle>
          <p className="text-xs text-slate-500 mt-1">
            Sections marked included will appear in the client PDF (Phase 3).
            Photos and PDF export ship in Phase 2/3.
          </p>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
          <ExportFlag label="Weather" on={report.includeWeatherInExport} />
          <ExportFlag label="Manpower" on={report.includeManpowerInExport} />
          <ExportFlag label="Work performed" on={report.includeWorkInExport} />
          <ExportFlag label="Materials delivered" on={report.includeMaterialsInExport} />
          <ExportFlag label="Equipment" on={report.includeEquipmentInExport} />
          <ExportFlag label="Delays" on={report.includeDelaysInExport} />
          <ExportFlag label="Safety" on={report.includeSafetyInExport} />
          <ExportFlag label="Issues / Concerns" on={report.includeIssuesInExport} />
          <ExportFlag label="Photos" on={report.includePhotosInExport} />
          <ExportFlag label="Client notes" on={report.includeClientNotesInExport} />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-900">{value}</span>
    </div>
  );
}

function Block({
  title,
  body,
  subtitle,
}: {
  title: string;
  body?: string | null;
  subtitle?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
      </CardHeader>
      <CardContent className="text-sm whitespace-pre-wrap text-slate-800">
        {body && body.trim().length > 0 ? body : <span className="text-slate-400">—</span>}
      </CardContent>
    </Card>
  );
}

function ExportFlag({ label, on }: { label: string; on: boolean }) {
  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        on
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-slate-200 bg-slate-50 text-slate-500'
      }`}
    >
      {on ? '✓' : '✕'} {label}
    </div>
  );
}
