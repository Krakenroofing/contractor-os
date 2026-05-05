// Server component — three featured reports surfaced on the dashboard so
// owners and accounting staff can jump straight into the most-used exports
// without going through the /reports index.

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  REPORT_DESCRIPTION,
  REPORT_LABEL,
  type ReportType,
} from '@/modules/reports/lib/filters';

const FEATURED: { type: ReportType; tagline: string }[] = [
  { type: 'project-financial', tagline: 'Per-project P&L' },
  { type: 'accounts-receivable', tagline: 'Aging buckets by customer' },
  { type: 'job-cost', tagline: 'Estimated vs. actual cost' },
];

export function QuickReportsCard() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Quick reports</CardTitle>
          <Link href={{ pathname: '/reports' }}>
            <Button size="sm" variant="outline">
              All reports →
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {FEATURED.map((f) => (
            <Link
              key={f.type}
              href={{ pathname: `/reports/${f.type}` }}
              className="group block rounded-lg border border-slate-200 p-3 transition-colors hover:border-slate-400 hover:bg-slate-50"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-slate-900">
                  {REPORT_LABEL[f.type]}
                </p>
                <Badge tone="slate">{f.tagline}</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {REPORT_DESCRIPTION[f.type]}
              </p>
              <p className="mt-2 text-xs text-slate-600 group-hover:text-slate-900">
                Open →
              </p>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
