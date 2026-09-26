import { redirect } from 'next/navigation';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canView } from '@/lib/permissions';
import { TeamTasksPanel } from '@/modules/team-tasks/components/team-tasks-panel';

export const dynamic = 'force-dynamic';

// Requests (roadmap P8): the team's notes and asks to the office, off the
// dashboard and on their own page — with priority and stage.
export default async function RequestsPage() {
  const role = await getActiveRole();
  if (!canView(role, 'team_tasks')) redirect('/dashboard');
  const [company, user] = await Promise.all([getActiveCompany(), requireAuth()]);
  return (
    <div className="p-8 max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Requests</h1>
        <p className="mt-1 text-sm text-slate-500">
          Notes and asks from the team to the office for{' '}
          <span className="font-medium text-slate-900">{company.name}</span> —
          most urgent first. Set a priority and stage as you work them;
          resolved requests move to the archive.
        </p>
      </header>
      <TeamTasksPanel companyId={company.id} role={role} currentUserId={user.id} />
    </div>
  );
}
