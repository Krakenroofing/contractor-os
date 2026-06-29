// Field → "Note for office": a quick note (and optional photo) any signed-in
// crew member can send to the office. Posts into the same per-company team
// task inbox that shows on the dashboard. No employee link required.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { TaskComposer } from '@/modules/team-tasks/components/task-composer';

export const dynamic = 'force-dynamic';

export default async function FieldNoteNewPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login' as never);

  return (
    <div className="px-4 py-5 space-y-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Note for office</h1>
        <Link href={{ pathname: '/field' }} className="text-xs text-slate-500">
          ← Back
        </Link>
      </header>

      <p className="text-sm text-slate-500">
        Anything the office should know or handle — a delivery problem, a
        material you&apos;re short on, a question. Attach a photo if it helps.
      </p>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <TaskComposer
          tone="field"
          placeholder="What should the office know or handle?"
          submitLabel="Send to office"
        />
      </div>
    </div>
  );
}
