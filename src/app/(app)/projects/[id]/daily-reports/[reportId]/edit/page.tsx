import { notFound, redirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getProject } from '@/lib/data/projects';
import {
  getDailyReport,
  getManpowerForReport,
} from '@/lib/data/daily-reports';
import { DailyReportForm } from '@/modules/daily-reports/components/daily-report-form';
import type { DailyReportFormInitial } from '@/modules/daily-reports/components/daily-report-form';

export const dynamic = 'force-dynamic';

export default async function EditDailyReportPage({
  params,
}: {
  params: Promise<{ id: string; reportId: string }>;
}) {
  const { id, reportId } = await params;
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  if (!canCreate(role, 'daily_reports')) {
    redirect(`/projects/${id}/daily-reports/${reportId}`);
  }

  const project = await getProject(companyId, id);
  if (!project) notFound();
  const report = await getDailyReport(companyId, reportId);
  if (!report) notFound();
  const manpower = await getManpowerForReport(report.id);

  const location =
    report.projectLocationSnapshot ??
    [
      project.jobsiteAddressLine1,
      project.jobsiteCity,
      project.jobsiteState,
      project.jobsitePostalCode,
    ]
      .filter(Boolean)
      .join(', ');

  const initial: DailyReportFormInitial = {
    reportDate: report.reportDate,
    status: report.status,
    weatherCondition: report.weatherCondition ?? '',
    weatherTemperatureF: report.weatherTemperatureF ?? '',
    weatherPrecipitation: report.weatherPrecipitation ?? '',
    weatherWind: report.weatherWind ?? '',
    weatherHumidity: report.weatherHumidity ?? '',
    weatherSource: (report.weatherSource as 'manual' | 'auto') ?? 'manual',
    siteConditions: report.siteConditions ?? '',
    crewCompanyName: report.crewCompanyName ?? '',
    foremanName: report.foremanName ?? '',
    workPerformed: report.workPerformed ?? '',
    materialsDelivered: report.materialsDelivered ?? '',
    equipmentOnSite: report.equipmentOnSite ?? '',
    inspections: report.inspections ?? '',
    delays: report.delays ?? '',
    safetyIncidents: report.safetyIncidents ?? '',
    visitorsOnSite: report.visitorsOnSite ?? '',
    issuesConcerns: report.issuesConcerns ?? '',
    tomorrowPlan: report.tomorrowPlan ?? '',
    internalNotes: report.internalNotes ?? '',
    clientNotes: report.clientNotes ?? '',
    preparedByName: report.preparedByName ?? '',
    includeWeatherInExport: report.includeWeatherInExport,
    includeManpowerInExport: report.includeManpowerInExport,
    includeWorkInExport: report.includeWorkInExport,
    includeMaterialsInExport: report.includeMaterialsInExport,
    includeEquipmentInExport: report.includeEquipmentInExport,
    includeDelaysInExport: report.includeDelaysInExport,
    includeSafetyInExport: report.includeSafetyInExport,
    includeIssuesInExport: report.includeIssuesInExport,
    includePhotosInExport: report.includePhotosInExport,
    includeClientNotesInExport: report.includeClientNotesInExport,
    manpower: manpower.map((m) => ({
      companyCrew: m.companyCrew ?? '',
      trade: m.trade ?? '',
      workerCount: String(m.workerCount),
      hours: m.hours,
      notes: m.notes ?? '',
    })),
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <Breadcrumbs
        items={[
          { href: '/projects', label: 'Projects' },
          { href: `/projects/${project.id}`, label: project.number },
          {
            href: `/projects/${project.id}/daily-reports`,
            label: 'Daily Reports',
          },
          {
            href: `/projects/${project.id}/daily-reports/${report.id}`,
            label: report.reportDate,
          },
          { label: 'Edit' },
        ]}
      />
      <div>
        <p className="font-mono text-xs text-slate-500">{project.number}</p>
        <h1 className="text-2xl font-semibold text-slate-900">
          Edit daily report
        </h1>
        <p className="text-sm text-slate-600">
          {project.name} · {report.reportDate}
        </p>
      </div>

      <DailyReportForm
        mode={{ kind: 'edit', projectId: project.id, reportId: report.id }}
        projectName={report.projectNameSnapshot ?? project.name}
        projectLocation={location}
        initial={initial}
      />
    </div>
  );
}
