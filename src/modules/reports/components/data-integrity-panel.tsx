// Server component — surfaces a quick health check on the /reports index so
// users know whether the numbers they're about to export are trustworthy.
//
// The reports themselves all derive from the same data layer + canonical
// math helpers as the dashboard, reconciliation module, and project detail
// pages. So when the reconciliation module reports zero discrepancies, every
// generated report total is guaranteed to match the corresponding screen
// (within ½-cent rounding tolerance — see EPSILON in reconciliation lib).
//
// When the reconciliation module DOES find issues, the same issues will be
// reflected in the reports (which is the point — the reports are accurate to
// the data, and the data has gaps). This panel makes that explicit so users
// don't blame the report.

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney, subtract } from '@/lib/money';
import { buildReconciliationData } from '@/modules/reconciliation/lib/reconciliation';

export async function DataIntegrityPanel({ companyId }: { companyId: string }) {
  const data = await buildReconciliationData(companyId);

  const errors = data.warnings.filter((w) => w.severity === 'error').length;
  const warns = data.warnings.filter((w) => w.severity === 'warn').length;
  const infos = data.warnings.filter((w) => w.severity === 'info').length;
  const arDelta = subtract(data.expectedAR, data.observedAR);
  const committedDelta = subtract(
    data.expectedCommittedCost,
    data.observedCommittedCost,
  );

  const isClean =
    data.totalDiscrepancies === 0 &&
    Math.abs(arDelta) < 0.005 &&
    Math.abs(committedDelta) < 0.005;

  return (
    <Card className={isClean ? 'border-emerald-200' : 'border-amber-200'}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Data integrity</CardTitle>
          <Badge tone={isClean ? 'green' : errors > 0 ? 'red' : 'amber'}>
            {isClean
              ? 'All reports reconcile'
              : `${data.totalDiscrepancies} discrepanc${
                  data.totalDiscrepancies === 1 ? 'y' : 'ies'
                }`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isClean ? (
          <p className="text-slate-700">
            Cross-table totals match within ½-cent rounding tolerance. Every
            report below pulls from the same data layer as the dashboard and
            reconciliation module, so the numbers you export here will match
            the numbers your team sees on screen.
          </p>
        ) : (
          <>
            <p className="text-slate-700">
              Reports reflect the underlying data exactly — including its gaps.
              The reconciliation module flags{' '}
              <span className="font-medium">{errors}</span> error
              {errors === 1 ? '' : 's'},{' '}
              <span className="font-medium">{warns}</span> warning
              {warns === 1 ? '' : 's'}, and{' '}
              <span className="font-medium">{infos}</span> info note
              {infos === 1 ? '' : 's'} that may explain unexpected report totals.
            </p>
            <ul className="space-y-1 text-xs text-slate-700">
              {Math.abs(arDelta) >= 0.005 && (
                <li>
                  AR roll-up vs. invoice-derived: Δ{' '}
                  <span className="font-medium tabular-nums">
                    {formatMoney(arDelta)}
                  </span>
                </li>
              )}
              {Math.abs(committedDelta) >= 0.005 && (
                <li>
                  Committed cost roll-up vs. PO-derived: Δ{' '}
                  <span className="font-medium tabular-nums">
                    {formatMoney(committedDelta)}
                  </span>
                </li>
              )}
              {data.totalDiscrepancies > 0 && (
                <li>
                  See the reconciliation module for line-by-line warnings with
                  links to the offending records.
                </li>
              )}
            </ul>
          </>
        )}

        <div className="flex items-center gap-2 pt-2">
          <Link href={{ pathname: '/reconciliation' }}>
            <Button size="sm" variant="outline">
              Open reconciliation →
            </Button>
          </Link>
          <span className="text-xs text-slate-500">
            {data.verifiedProjects} of {data.verifiedProjects + data.unverifiedProjects} project
            {data.verifiedProjects + data.unverifiedProjects === 1 ? '' : 's'}{' '}
            marked reconciled
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
