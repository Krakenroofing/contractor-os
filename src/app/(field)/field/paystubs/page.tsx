// Field → "My pay slips": a crew member's own finalized pay slips. Reads the
// frozen paystub snapshots (written when the office locks a period), so a
// worker only ever sees finalized pay — never an in-progress period. Each slip
// links to the same PDF the office can download, scoped to this employee by
// the /api/exports route.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveEmployee } from '@/lib/active-employee';
import { listPaystubSnapshots } from '@/lib/data/period-paystub-snapshots';
import { listPayPeriods } from '@/lib/data/pay-periods';
import { formatPeriodLabel } from '@/modules/payroll/lib/periods';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function FieldPaystubsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login' as never);
  const employee = await getActiveEmployee();

  return (
    <div className="px-4 py-5 space-y-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">My pay slips</h1>
        <Link href={{ pathname: '/field' }} className="text-xs text-slate-500">
          ← Back
        </Link>
      </header>

      {!employee ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">
            No employee record is linked to this account.
          </p>
          <p className="text-xs text-amber-800 mt-1">
            Ask your administrator to link your login to your employee record so
            your pay slips show here.
          </p>
        </div>
      ) : (
        <PaystubList employeeId={employee.id} />
      )}
    </div>
  );
}

async function PaystubList({ employeeId }: { employeeId: string }) {
  const companyId = await getActiveCompanyId();
  const [snapshots, periods] = await Promise.all([
    listPaystubSnapshots(companyId, { employeeId }),
    listPayPeriods(companyId),
  ]);
  const periodById = new Map(periods.map((p) => [p.id, p]));

  const rows = snapshots
    .map((s) => {
      const period = periodById.get(s.payPeriodId);
      return {
        periodId: s.payPeriodId,
        startDate: period?.startDate ?? '',
        endDate: period?.endDate ?? '',
        label:
          period != null
            ? formatPeriodLabel(period.startDate, period.endDate)
            : 'Pay period',
        gross: Number(s.gross),
        net: Number(s.net),
        employeeNib: Number(s.employeeNib),
        deductions: Number(s.deductionsTotal),
        additions: Number(s.additionsTotal),
      };
    })
    // Newest period first.
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center">
        <p className="text-sm text-slate-700">No pay slips yet.</p>
        <p className="text-xs text-slate-500 mt-1">
          A pay slip appears here once the office closes (locks) a pay period
          you were paid in.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li
          key={r.periodId}
          className="rounded-xl border border-slate-200 bg-white px-4 py-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{r.label}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {r.startDate} → {r.endDate}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">
                Net pay
              </p>
              <p className="text-lg font-semibold tabular-nums text-emerald-700">
                {formatMoney(r.net)}
              </p>
            </div>
          </div>

          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-600">
            <Row label="Gross" value={formatMoney(r.gross)} />
            <Row label="NIB (employee)" value={`− ${formatMoney(r.employeeNib)}`} />
            {r.deductions > 0 && (
              <Row label="Deductions" value={`− ${formatMoney(r.deductions)}`} />
            )}
            {r.additions > 0 && (
              <Row
                label="Reimb. / per-diem"
                value={`+ ${formatMoney(r.additions)}`}
              />
            )}
          </dl>

          <a
            href={`/api/exports/payslip/${employeeId}__${r.periodId}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 text-white text-sm font-medium px-4 h-11 w-full hover:bg-slate-800"
          >
            ⬇ Download pay slip (PDF)
          </a>
        </li>
      ))}
    </ul>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right tabular-nums text-slate-800">{value}</dd>
    </>
  );
}
