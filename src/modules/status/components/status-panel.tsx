// Server component — composes the canonical status badge, key workflow
// timestamps, and the legal-next-step action buttons in a single card. Drop
// it onto any detail page just below the breadcrumbs/title.

import { Card, CardContent } from '@/components/ui/card';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { ENTITY_RESOURCE, type EntityType } from '@/lib/status-machine';
import { StatusActions } from '@/modules/status/components/status-actions';
import { StatusBadge } from '@/modules/status/components/status-badge';

function formatTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export type StatusTimestamp = {
  label: string;
  value: Date | string | null | undefined;
};

export async function StatusPanel({
  entityType,
  entityId,
  status,
  timestamps,
}: {
  entityType: EntityType;
  entityId: string;
  status: string;
  timestamps?: StatusTimestamp[];
}) {
  const role = await getActiveRole();
  const allowed = canCreate(role, ENTITY_RESOURCE[entityType]);

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Current status
            </span>
            <StatusBadge entityType={entityType} status={status} />
          </div>
          <StatusActions
            entityType={entityType}
            entityId={entityId}
            status={status}
            allowed={allowed}
          />
        </div>

        {timestamps && timestamps.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
            {timestamps.map((t) => (
              <div key={t.label}>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  {t.label}
                </p>
                <p className="mt-0.5 text-sm text-slate-800">
                  {formatTime(t.value)}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
