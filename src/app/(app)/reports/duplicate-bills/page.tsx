import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listDuplicateBillGroups } from '@/lib/data/duplicate-bills';
import { visibleCompanyIds } from '@/lib/data/visible-companies';

export const dynamic = 'force-dynamic';

// Duplicate supplier invoices (roadmap P4): the same vendor invoice number
// entered more than once — in one company or across Kraken and TRB — with
// the same vendor name or the same amount.
export default async function DuplicateBillsReportPage() {
  const role = await getActiveRole();
  if (!canView(role, 'receipts')) redirect('/dashboard');
  const company = await getActiveCompany();
  const groups = await listDuplicateBillGroups(await visibleCompanyIds());

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Duplicate supplier invoices
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Bills carrying the same vendor invoice number (ignoring spaces and
          punctuation) with the same vendor name or the same amount — checked
          across every company you have access to. Void the extra copy (or
          correct the invoice number if it was a typo).
        </p>
      </header>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-emerald-700">
            ✓ No duplicate supplier invoices found.
          </CardContent>
        </Card>
      ) : (
        groups.map((g) => (
          <Card key={g.map((r) => r.receiptId).join('-')}>
            <CardContent className="p-4">
              <div className="mb-2 text-sm font-medium text-slate-900">
                Invoice #{g[0].vendorInvoiceNumber}
                {new Set(g.map((r) => r.companyId)).size > 1 && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800">
                    across companies
                  </span>
                )}
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {g.map((r) => (
                    <tr key={r.receiptId}>
                      <td className="py-1 pr-3 text-slate-600">{r.companyName}</td>
                      <td className="py-1 pr-3">{r.vendorName ?? '—'}</td>
                      <td className="py-1 pr-3 font-mono text-xs">{r.receiptDate}</td>
                      <td className="py-1 pr-3 text-xs capitalize text-slate-500">
                        {r.status}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">
                        {formatMoney(r.total)}
                      </td>
                      <td className="py-1 text-right">
                        {r.companyId === company.id ? (
                          <Link
                            href={{ pathname: `/banking/receipts/${r.receiptId}` }}
                            className="text-blue-700 hover:underline"
                          >
                            Open
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-400">
                            switch to {r.companyName}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
