// Snap-a-receipt for the field crew. A photo becomes a DRAFT receipt in
// the office queue (with the image attached and, when OCR is configured,
// vendor / date / total prefilled) — the office codes and assigns it from
// /banking/receipts like any other draft. Crew never sees the banking side.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { ReceiptSnap } from '@/modules/field/components/receipt-snap';

export const dynamic = 'force-dynamic';

export default async function FieldReceiptsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login' as never);
  const role = await getActiveRole();
  // field_user / pm / owner / accounting all carry receipts:create.
  if (!canCreate(role, 'receipts')) redirect('/field' as never);

  return (
    <div className="px-4 py-5 space-y-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">
          Snap a receipt
        </h1>
        <Link href={{ pathname: '/field' }} className="text-xs text-slate-500">
          ← Home
        </Link>
      </header>

      <p className="text-sm text-slate-600">
        Bought something for a job? Photograph the receipt right at the
        counter — it goes straight to the office to be coded. Keep the paper
        copy in the truck just in case.
      </p>

      <ReceiptSnap />
    </div>
  );
}
