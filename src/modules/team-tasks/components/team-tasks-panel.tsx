import { Card, CardContent } from '@/components/ui/card';
import { canCreate, canResolveTeamTask, type Role } from '@/lib/permissions';
import { buildTeamTasks } from '../lib/build-team-tasks';
import { TaskComposer } from './task-composer';
import { TaskItem } from './task-item';

// Dashboard "Team notes & tasks" panel — a per-company shared inbox. Anyone
// who can post sees the composer; owners/accounting can resolve & reopen;
// admins or the original poster can delete.
export async function TeamTasksPanel({
  companyId,
  role,
  currentUserId,
}: {
  companyId: string;
  role: Role;
  currentUserId: string;
}) {
  const { tasks, openCount } = await buildTeamTasks(companyId);
  const canPost = canCreate(role, 'team_tasks');
  const canResolve = canResolveTeamTask(role);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xs uppercase tracking-wide font-medium text-slate-500">
          Team notes &amp; tasks
        </h2>
        <p className="text-xs text-slate-400 tabular-nums">
          {openCount === 0
            ? 'Inbox clear'
            : `${openCount} open item${openCount === 1 ? '' : 's'}`}
        </p>
      </div>
      <Card>
        <CardContent className="p-4 space-y-4">
          {canPost && <TaskComposer />}

          {tasks.length === 0 ? (
            <p className="text-sm text-slate-500">
              No notes yet. Anything the team flags for the office shows up here.
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
