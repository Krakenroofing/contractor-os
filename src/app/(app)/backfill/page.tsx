import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView, ROLE_LABELS } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import {
  BACKFILL_STEPS,
  STEP_DESCRIPTION,
  STEP_LABEL,
  getBackfillKPIs,
  getBackfillStepCounts,
  getBackfillWarnings,
  getProjectBackfillStatuses,
} from '@/modules/backfill/lib/backfill';
import { StepShell } from '@/modules/backfill/components/step-shell';

export const dynamic = 'force-dynamic';

export default async function BackfillOverviewPage() {
  const role = await getActiveRole();
  if (!canView(role, 'backfill')) redirect('/dashboard');
  const company = await getActiveCompany();
  const [counts, kpis, warnings, projectStatuses] = await Promise.all([
    getBackfillStepCounts(company.id),
    getBackfillKPIs(company.id),
    getBackfillWarnings(company.id),
    getProjectBackfillStatuses(company.id),
  ]);

  const totalEntered = Object.values(counts).reduce((a, n) => a + n, 0);
  const incompleteProjects = projectStatuses.filter((p) => !p.complete);
  const warningCount = warnings.filter((w) => w.severity === 'warn').length;

  return (
    <StepShell step="overview">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SummaryStat
          label="Records entered (since 2026-01-01)"
          value={String(totalEntered)}
          hint={`for ${company.name}`}
        />
        <SummaryStat
          label="Incomplete projects"
          value={String(incompleteProjects.length)}
          hint="missing estimate or invoice"
          tone={incompleteProjects.length > 0 ? 'amber' : 'green'}
        />
        <SummaryStat
          label="Data warnings"
          value={String(warningCount)}
          hint="overdue or missing links"
          tone={warningCount > 0 ? 'red' : 'green'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Steps</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="divide-y divide-slate-200">
            {BACKFILL_STEPS.map((step, i) => {
              const c = counts[step];
              const isComplete = c > 0;
              return (
                <li
                  key={step}
                  className="py-3 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-500">
                        Step {i + 1}
                      </span>
                      <span className="font-medium text-slate-900">
                        {STEP_LABEL[step]}
                      </span>
                      {isComplete ? (
                        <Badge tone="green">{c} entered</Badge>
                      ) : (
                        <Badge tone="slate">empty</Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {STEP_DESCRIPTION[step]}
                    </p>
                  </div>
                  <Link href={{ pathname: `/backfill/${step}` }}>
                    <Button size="sm" variant={isComplete ? 'outline' : 'default'}>
                      {isComplete ? 'Continue' : 'Start'}
                    </Button>
                  </Link>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Live KPIs (entered so far)</CardTitle>
            <Link href={{ pathname: '/backfill/review' }}>
              <Button size="sm" variant="outline">
                Open review →
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Stat label="Contract value" value={formatMoney(kpis.totalContractValue)} />
            <Stat label="Invoiced" value={formatMoney(kpis.totalInvoiced)} />
            <Stat
              label="Paid"
              value={formatMoney(kpis.totalPaid)}
              valueClassName="text-emerald-700"
            />
            <Stat
              label="Outstanding AR"
              value={formatMoney(kpis.outstandingAR)}
              valueClassName={kpis.outstandingAR > 0 ? 'text-amber-700' : undefined}
            />
            <Stat label="Retainage held" value={formatMoney(kpis.retainageHeld)} />
            <Stat
              label="Retainage outstanding"
              value={formatMoney(kpis.retainageOutstanding)}
              valueClassName={
                kpis.retainageOutstanding > 0 ? 'text-amber-700' : undefined
              }
            />
            <Stat
              label="Open POs"
              value={String(kpis.openPurchaseOrders)}
              hint={formatMoney(kpis.openPurchaseOrderValue)}
            />
            <Stat
              label="Approved COs total"
              value={formatMoney(kpis.changeOrdersApprovedTotal)}
            />
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Viewing as {ROLE_LABELS[role]} · scoped to {company.name}.
          </p>
        </CardContent>
      </Card>
    </StepShell>
  );
}

function SummaryStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'green' | 'amber' | 'red';
}) {
  const valueClass =
    tone === 'green'
      ? 'text-emerald-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'red'
          ? 'text-red-600'
          : 'text-slate-900';
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>
          {value}
        </p>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  valueClassName,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-0.5 text-base font-medium tabular-nums ${
          valueClassName ?? 'text-slate-900'
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
