'use client';

// "New jobs named by the crew" — each row is a job name typed at the
// field clock that has no real project yet. The office picks (or
// quick-creates, via the picker's "+ Add new project…" drawer) the real
// project; resolving back-fills every matching punch and posted hour.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ProjectPicker } from '@/modules/projects/components/project-picker';
import type { CustomerPickerOption } from '@/modules/customers/components/customer-picker';
import { resolvePendingJobAction } from '../actions';

type PendingRow = {
  name: string;
  punchCount: number;
  entryHours: number;
  employees: string[];
};
type Option = { id: string; name: string };

export function PendingJobsPanel({
  pending,
  projects,
  customers,
}: {
  pending: PendingRow[];
  projects: Option[];
  customers: CustomerPickerOption[];
}) {
  const router = useRouter();
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (pending.length === 0) return null;

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 space-y-3">
      <p className="text-sm font-semibold text-sky-900">
        New jobs named by the crew ({pending.length})
      </p>
      <p className="text-xs text-sky-800">
        Hours are waiting on these. Pick the real project (or create it right
        in the dropdown) — resolving assigns every punch and posted hour with
        that name.
      </p>
      <div className="space-y-2">
        {pending.map((p) => (
          <div
            key={p.name}
            className="rounded-md bg-white border border-sky-200 px-3 py-2 space-y-2"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-medium text-slate-900">
                  🆕 {p.name}
                </p>
                <p className="text-[11px] text-slate-500">
                  {p.employees.join(', ')}
                  {p.entryHours > 0 &&
                    ` · ${p.entryHours.toFixed(2)}h posted`}{' '}
                  · {p.punchCount} punch{p.punchCount === 1 ? '' : 'es'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ProjectPicker
                  projects={projects.map((x) => ({ id: x.id, name: x.name }))}
                  customers={customers}
                  allowNone={false}
                  placeholder="Assign to project…"
                  value={picks[p.name] ?? ''}
                  onChange={(id) =>
                    setPicks((prev) => ({ ...prev, [p.name]: id }))
                  }
                  className="min-w-[220px]"
                />
                <Button
                  size="sm"
                  disabled={busy === p.name || !picks[p.name]}
                  onClick={() => {
                    setErrors((prev) => ({ ...prev, [p.name]: '' }));
                    setBusy(p.name);
                    startTransition(async () => {
                      const res = await resolvePendingJobAction({
                        pendingName: p.name,
                        projectId: picks[p.name],
                      });
                      setBusy(null);
                      if (res.error) {
                        setErrors((prev) => ({ ...prev, [p.name]: res.error! }));
                        return;
                      }
                      router.refresh();
                    });
                  }}
                >
                  {busy === p.name ? 'Assigning…' : 'Assign'}
                </Button>
              </div>
            </div>
            {errors[p.name] && (
              <p className="text-xs text-red-600">{errors[p.name]}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
