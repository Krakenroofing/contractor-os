import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canResolveTeamTask, canView } from '@/lib/permissions';
import { buildTeamTasks } from '@/modules/team-tasks/lib/build-team-tasks';
import { TaskItem } from '@/modules/team-tasks/components/task-item';

export const dynamic = 'force-dynamic';

// Resolved Team Notes & Tasks — the archive. Resolving a note moves it here
// instead of deleting it (Olga's ask): the dashboard stays clear, the history
// stays intact, and anything resolved too early can be reopened.
export default async function TeamTasksArchivePage() {
  const role = await getActiveRole();
  if (!canView(role, 'team_tasks')) redirect('/dashboard');
  const user = await requireAuth();
  const company = await getActiveCompany();

  const { tasks, resolvedCount } = await buildTeamTasks(company.id, 'archive');
  const canResolve = canResolveTeamTask(role);

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/dashboard', label: 'Dashboard' },
          { label: 'Resolved notes' },
        ]}
      />

      <div className="flex items-start justify-between gap-4">
        <header>
          <h1 className="text-2xl font-semibold text-slate-900">
            Resolved notes &amp; tasks
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Everything the team has marked resolved for{' '}
            <span className="font-medium text-slate-900">{company.name}</span>{' '}
            — kept for the record, off the dashboard. Reopen anything that
            needs more work and it goes back to the inbox.
          </p>
        </header>
        <Link href={{ pathname: '/dashboard' }}>
          <Button variant="outline" size="sm">
            ← Dashboard
          </Button>
        </Link>
      </div>

      {tasks.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-500">
            Nothing resolved yet — notes land here when someone hits
            &quot;✓ Resolve&quot; on the dashboard.
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="space-y-2">
            {tasks.map((t) => (
              <TaskItem
                key={t.id}
                task={t}
                canResolve={canResolve}
                canDelete={canResolve || t.createdById === user.id}
              />
            ))}
          </ul>
          {resolvedCount > tasks.length && (
            <p className="text-xs text-slate-400">
              Showing the {tasks.length} most recently resolved of{' '}
              {resolvedCount}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
