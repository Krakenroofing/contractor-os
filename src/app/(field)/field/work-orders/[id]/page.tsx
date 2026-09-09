// Field → one of MY work orders: status, what was submitted, and the photo
// manager — the crew member can keep adding photos until the office posts
// the call. Strictly scoped to the submitting employee's own work orders.

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveEmployee } from '@/lib/active-employee';
import { getCurrentUser } from '@/lib/auth';
import {
  getWorkOrderWithDetails,
  listWorkOrderPhotos,
} from '@/lib/data/work-orders';
import { createSignedPhotoUrl } from '@/lib/storage/daily-report-photos';
import { FieldWorkOrderPhotos } from '@/modules/work-orders/components/field-work-order-photos';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, { label: string; tone: 'blue' | 'green' | 'slate' }> = {
  submitted: { label: 'With the office', tone: 'blue' },
  posted: { label: 'Logged & posted', tone: 'green' },
  void: { label: 'Voided', tone: 'slate' },
};

export default async function FieldWorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login' as never);
  const employee = await getActiveEmployee();
  if (!employee) redirect('/field/work-orders' as never);
  const companyId = await getActiveCompanyId();
  const { id } = await params;

  const wo = await getWorkOrderWithDetails(companyId, id);
  // Crew members only ever see their OWN submissions here.
  if (!wo || wo.createdByEmployeeId !== employee.id) notFound();

  const photos = await Promise.all(
    (await listWorkOrderPhotos(companyId, id)).map(async (p) => ({
      id: p.id,
      url: await createSignedPhotoUrl(p.storagePath).catch(() => null),
      caption: p.caption,
    })),
  );
  const s = STATUS_LABEL[wo.status] ?? STATUS_LABEL.submitted;

  return (
    <div className="px-4 py-5 space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">{wo.number}</h1>
        <Link
          href={{ pathname: '/field/work-orders' }}
          className="text-xs text-slate-500"
        >
          ← My work orders
        </Link>
      </header>

      <div className="flex items-center gap-2 flex-wrap text-sm text-slate-600">
        <Badge tone={s.tone}>{s.label}</Badge>
        <span>{wo.workDate}</span>
      </div>

      {wo.requestedBy && (
        <p className="text-sm text-slate-600">
          <span className="text-slate-400">Requested by:</span> {wo.requestedBy}
        </p>
      )}
      {wo.repairsDone && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
            Repairs done
          </p>
          <p className="text-sm text-slate-800 whitespace-pre-wrap">
            {wo.repairsDone}
          </p>
        </div>
      )}

      <FieldWorkOrderPhotos
        workOrderId={wo.id}
        photos={photos}
        editable={wo.status === 'submitted'}
      />
    </div>
  );
}
