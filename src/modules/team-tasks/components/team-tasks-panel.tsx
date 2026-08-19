import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { canCreate, canResolveTeamTask, type Role } from '@/lib/permissions';
import { buildTeamTasks } from '../lib/build-team-tasks';
import { TaskComposer } from './task-composer';
import { TaskItem } from './task-item';

// Dashboard "Team notes & tasks" panel — a per-company shared inbox. Anyone
// who can post sees the composer; owners/accounting can resolve & reopen;
// admins or the original poster can delete. Resolved notes leave the
// dashboard and live in the archive (nothing needs deleting).
export async function TeamTasksPanel({
  companyId,
  role,
  currentUserId,
}: {
  companyId: string;
  role: Role;
  currentUserId: string;
}) {
  const { tasks, openCount, resolvedCount } = await buildTeamTasks(companyId);
  const canPost = canCreate(role, 'team_tasks');
  const canResolve = canResolveTeamTask(role);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xs uppercase tracking-wide font-medium text-slate-500">
          Team notes &amp; tasks
        </h2>
        <div className="flex items-baseline gap-3">
          <p className="text-xs text-slate-400 tabular-nums">
            {openCount === 0
              ? 'Inbox clear'
              : `${openCount} open item${openCount === 1 ? '' : 's'}`}
          </p>
          {resolvedCount > 0 && (
            <Link
              href={{ pathname: '/dashboard/tasks/archive' }}
              className="text-xs text-blue-700 hover:underline whitespace-nowrap"
            >
              Archive ({resolvedCount}) →
            </Link>
          )}
        </div>
      </div>
      <Card>
        <CardContent className="p-4 space-y-4">
          {canPost && <TaskComposer />}

          {tasks.length === 0 ? (
            <p className="text-sm text-slate-500">
              No open notes. Anything the team flags for the office shows up
              here; resolved notes live in the archive.
            </p>
          ) : (
            <ul className="space-y-2">
              {tasks.map((t) => (
                <TaskItem
                  key={t.id}
                  task={t}
                  canResolve={canResolve}
                  canDelete={canResolve || t.createdById === currentUserId}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
