import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { formatMoney } from '@/lib/money';
import { listControlExceptions } from '@/lib/data/approvals';
import { getUserNamesByIds } from '@/lib/data/users';
import { ReviewExceptionButton } from '@/modules/approvals/components/review-exception-button';

export const dynamic = 'force-dynamic';

// Control exceptions (roadmap P6): approvals that bypassed separation of
// duties — an owner approving a PO or bill they entered themselves, with
// the reason they gave. The other owner reviews and signs each one off.
export default async function ControlExceptionsPage() {
  const role = await getActiveRole();
  if (role !== 'owner' && role !== 'accounting') redirect('/dashboard');
  const company = await getActiveCompany();
  const rows = await listControlExceptions(company.id);
  const names = await getUserNamesByIds(
    [
      ...new Set(
        rows
          .flatMap((r) => [r.userId, r.reviewedByUserId])
          .filter((x): x is string => Boolean(x)),
      ),
    ],
  );
  const open = rows.filter((r) => !r.reviewedAt);

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Control exceptions</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          <span className="font-medium text-slate-900">{company.name}</span> —
          purchase orders over{' '}
          {company.poApprovalLimit
            ? formatMoney(company.poApprovalLimit)
            : 'the limit (off)'}{' '}
          and bills over{' '}
          {company.billApprovalLimit
            ? formatMoney(company.billApprovalLimit)
            : 'the limit (off)'}{' '}
          need an approver other than whoever entered them. When an owner
          approves their own, it lands here with their reason for the other
          owner to review.
        </p>
      </header>

      <Card>
        <CardContent className="p-4">
          <p className="mb-3 text-sm">
            {open.length === 0 ? (
              <span className="text-emerald-700">✓ Nothing waiting for review.</span>
            ) : (
              <span className="font-medium text-amber-800">
                {open.length} waiting for review
              </span>
            )}
          </p>
          {rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Document</th>
                  <th className="py-2 pr-3">Approved by</th>
                  <th className="py-2 pr-3">Reason</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                  <th className="py-2 text-right">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className={r.reviewedAt ? 'text-slate-400' : ''}>
                    <td className="py-1.5 pr-3 font-mono text-xs">
                      {r.createdAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="py-1.5 pr-3">
                      <Link
                        href={
                          (r.entityType === 'purchase_order'
                            ? `/purchase-orders/${r.entityId}`
                            : `/banking/receipts/${r.entityId}`) as never
                        }
                        className="text-blue-700 hover:underline"
                      >
                        {r.entityLabel ?? r.entityType}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3">
                      {r.userId ? (names.get(r.userId) ?? '—') : '—'}
                    </td>
                    <td className="py-1.5 pr-3">{r.reason}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {r.amount ? formatMoney(r.amount) : ''}
                    </td>
                    <td className="py-1.5 text-right">
                      {r.reviewedAt ? (
                        <span className="text-xs">
                          ✓ {r.reviewedByUserId ? names.get(r.reviewedByUserId) : ''}{' '}
                          {r.reviewedAt.toISOString().slice(0, 10)}
                        </span>
                      ) : role === 'owner' ? (
                        <ReviewExceptionButton id={r.id} />
                      ) : (
                        <span className="text-xs text-amber-700">open</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
