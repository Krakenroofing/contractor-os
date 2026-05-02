// Server component — fetches the activity log for one entity and renders a
// compact timeline. Safe to drop onto any detail page.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { listActivityForEntity, type EntityType } from '@/lib/mock-store';

function formatTime(iso: Date): string {
  return iso.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

export async function ActivityLogCard({
  entityType,
  entityId,
}: {
  entityType: EntityType;
  entityId: string;
}) {
  const companyId = await getActiveCompanyId();
  const entries = listActivityForEntity(companyId, entityType, entityId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity log</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-500">
            No activity recorded yet. Status changes and key edits will appear here.
          </p>
        ) : (
          <ol className="relative border-l border-slate-200 pl-4 space-y-3">
            {entries.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-slate-300 ring-2 ring-white" />
                <p className="text-slate-800">{e.summary}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {formatTime(e.createdAt)}
                  {e.actorRole && (
                    <>
                      <span className="text-slate-400"> · </span>
                      {e.actorRole}
                    </>
                  )}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
