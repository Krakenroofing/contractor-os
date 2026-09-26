import { redirect } from 'next/navigation';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canApproveReceipt, canView } from '@/lib/permissions';
import { listParkedBills } from '@/lib/data/receipts';
import { listMembersForCompany } from '@/lib/data/memberships';
import { getUserNamesByIds } from '@/lib/data/users';
import {
  ParkedBillsClient,
  type ParkedBillRow,
} from '@/modules/receipts/components/parked-bills-client';

export const dynamic = 'force-dynamic';

// Parked bills (roadmap P6): drafts and submitted bills awaiting posting,
// each with an owner and an age, so the backlog is worked, not forgotten.
export default async function ParkedBillsPage() {
  const role = await getActiveRole();
  if (!canView(role, 'receipts')) redirect('/dashboard');
  const company = await getActiveCompany();
  const [bills, members] = await Promise.all([
    listParkedBills(company.id),
    listMembersForCompany(company.id),
  ]);
  const office = members.filter((m) => m.role !== 'field_user');
  // Uploaders who aren't office members (field crew snapping receipts)
  // still need a name in the owner column.
  const extraIds = [
    ...new Set(bills.map((b) => b.ownerUserId).filter((x): x is string => Boolean(x))),
  ].filter((id) => !office.some((m) => m.userId === id));
  const extraNames = await getUserNamesByIds(extraIds);
  const now = Date.now();
  const rows: ParkedBillRow[] = bills.map((b) => ({
    ...b,
    ageDays: Math.max(0, Math.floor((now - b.createdAt.getTime()) / 86_400_000)),
  }));
  const total = bills.reduce((s, b) => s + Number(b.total), 0);

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Parked bills</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          <span className="font-medium text-slate-900">{company.name}</span> —{' '}
          {bills.length} bill{bills.length === 1 ? '' : 's'} not yet posted (
          {total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
          ). Each has an owner — whoever uploaded it unless assigned — and an
          age since it was entered. Bills over the approval limit need someone
          other than whoever entered them to post.
        </p>
      </header>
      <ParkedBillsClient
        rows={rows}
        members={[
          ...office.map((m) => ({ userId: m.userId, name: m.name })),
          ...extraIds
            .filter((id) => extraNames.has(id))
            .map((id) => ({ userId: id, name: extraNames.get(id)! })),
        ]}
        canAssign={canApproveReceipt(role)}
      />
    </div>
  );
}
