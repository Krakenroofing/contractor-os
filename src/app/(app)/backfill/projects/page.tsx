import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listCustomers } from '@/lib/data/customers';
import { listProjects } from '@/lib/data/projects';
import { BACKFILL_CUTOFF_ISO } from '@/modules/backfill/lib/backfill';
import { ProjectMiniForm } from '@/modules/backfill/components/project-mini-form';
import { StepShell } from '@/modules/backfill/components/step-shell';

export const dynamic = 'force-dynamic';

const CUTOFF = new Date(`${BACKFILL_CUTOFF_ISO}T00:00:00Z`);

export default async function BackfillProjectsPage() {
  const role = await getActiveRole();
  if (!canView(role, 'backfill')) redirect('/dashboard');
  const companyId = await getActiveCompanyId();
  const [customers, projects] = await Promise.all([
    listCustomers(companyId),
    listProjects(companyId),
  ]);
  const recent = projects.filter(
    (p) =>
      (p.startDate &&
        new Date(`${p.startDate}T00:00:00Z`).getTime() >= CUTOFF.getTime()) ||
      p.createdAt.getTime() >= CUTOFF.getTime(),
  );

  return (
    <StepShell
      step="projects"
      prevHref="/backfill/customers"
      nextHref="/backfill/proposals"
    >
      <Card>
        <CardHeader>
          <CardTitle>Add a project</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectMiniForm
            customers={customers.map((c) => ({ id: c.id, name: c.name }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Projects entered ({recent.length})</CardTitle>
            <Link href={{ pathname: '/projects' }} className="text-sm text-slate-500 hover:underline">
              Full project list →
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No projects backfilled yet.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {recent.map((p) => (
                <li
                  key={p.id}
                  className="py-2 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">
                      {p.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {p.startDate ?? '—'} · {formatMoney(p.contractValue)} contract
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="slate">{p.status.replace('_', ' ')}</Badge>
                    <Link
                      href={{ pathname: `/projects/${p.id}` }}
                      className="text-xs text-slate-600 hover:underline"
                    >
                      Open →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </StepShell>
  );
}
