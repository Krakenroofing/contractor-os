import { Card, CardContent } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { isDevDemoMode } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import {
  buildAgingRowsForCompany,
  calcCashCollectedThisMonth,
  formatMonthYear,
  summarizeAging,
} from '@/modules/accounts-receivable/lib/ar';
import { ARListClient } from '@/modules/accounts-receivable/components/ar-list-client';

export const dynamic = 'force-dynamic';

export default async function AccountsReceivablePage() {
  const company = await getActiveCompany();
  const companyId = company.id;
  const asOf = new Date();
  const rows = await buildAgingRowsForCompany(companyId, asOf);
  const summary = summarizeAging(rows);
  const cashThisMonth = await calcCashCollectedThisMonth(companyId, asOf);
  const monthLabel = formatMonthYear(asOf);

  return (
    <div className="p-8 space-y-6 max-w-[110rem]">
      {isDevDemoMode() && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
          Demo mode — accounts receivable derived live from invoices and payment history.
          Aging buckets are calculated against today's date.
        </div>
      )}

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Accounts Receivable / Aging
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {summary.invoiceCount} {summary.invoiceCount === 1 ? 'open invoice' : 'open invoices'}
          {summary.overdueCount > 0
            ? ` · ${summary.overdueCount} overdue`
            : ' · all current'}
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPI
          label={company.isVatActive ? 'Total AR (gross)' : 'Total AR'}
          value={formatMoney(summary.totalAR)}
          highlight
          sub={
            company.isVatActive
              ? `revenue ${formatMoney(summary.totalARNet)} · VAT ${formatMoney(summary.totalARVat)}`
              : undefined
          }
        />
        <KPI
          label="Current"
          value={formatMoney(summary.current)}
          valueClassName="text-emerald-700"
        />
        <KPI
          label="1–30 days"
          value={formatMoney(summary.b1_30)}
          valueClassName={summary.b1_30 > 0 ? 'text-amber-700' : undefined}
        />
        <KPI
          label="31–60 days"
          value={formatMoney(summary.b31_60)}
          valueClassName={summary.b31_60 > 0 ? 'text-amber-700' : undefined}
        />
        <KPI
          label="61–90 days"
          value={formatMoney(summary.b61_90)}
          valueClassName={summary.b61_90 > 0 ? 'text-red-600' : undefined}
        />
        <KPI
          label="90+ days"
          value={formatMoney(summary.b90_plus)}
          valueClassName={summary.b90_plus > 0 ? 'text-red-600' : undefined}
        />
      </div>

      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Cash collected
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">
              {formatMoney(cashThisMonth)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{monthLabel}</p>
          </div>
          <p className="text-xs text-slate-500 max-w-md">
            Live total of invoice payments dated within the current month for the active
            company. Click any invoice number below to drill into payment history and
            template-rendered detail.
          </p>
        </CardContent>
      </Card>

      <ARListClient rows={rows} />
    </div>
  );
}

function KPI({
  label,
  value,
  highlight,
  valueClassName,
  sub,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  valueClassName?: string;
  sub?: string;
}) {
  return (
    <Card className={highlight ? 'border-slate-300' : undefined}>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${
            valueClassName ?? 'text-slate-900'
          }`}
        >
          {value}
        </p>
        {sub && (
          <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}
