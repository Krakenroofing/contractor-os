import { notFound, redirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getProject } from '@/lib/data/projects';
import { DailyReportForm } from '@/modules/daily-reports/components/daily-report-form';

export const dynamic = 'force-dynamic';

export default async function NewDailyReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  if (!canCreate(role, 'daily_reports')) {
    redirect(`/projects/${id}/daily-reports`);
  }
  const project = await getProject(companyId, id);
  if (!project) notFound();

  const location = [
    project.jobsiteAddressLine1,
    project.jobsiteCity,
    project.jobsiteState,
    project.jobsitePostalCode,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <Breadcrumbs
        items={[
          { href: '/projects', label: 'Projects' },
          { href: `/projects/${project.id}`, label: project.name },
          { href: `/projects/${project.id}/daily-reports`, label: 'Daily Reports' },
          { label: 'New' },
        ]}
      />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">New daily report</h1>
        <p className="text-sm text-slate-600">{project.name}</p>
      </div>

      <DailyReportForm
        mode={{ kind: 'create', projectId: project.id }}
        projectName={project.name}
        projectLocation={location}
      />
    </div>
  );
}
