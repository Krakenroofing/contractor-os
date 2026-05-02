import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView, ROLE_LABELS } from '@/lib/permissions';
import {
  REPORT_DESCRIPTION,
  REPORT_LABEL,
  REPORT_TYPES,
} from '@/modules/reports/lib/filters';

export const dynamic = 'force-dynamic';

export default async function ReportsIndexPage() {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) redirect('/dashboard');
  const company = await getActiveCompany();

  return (
    <div className="p-8 max-w-[100rem] space-y-6">
      <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
        Reports — every report reads live from the data layer (Postgres in DB
        mode, in-memory store in demo mode). Use the date range and project
        filters to narrow the scope before exporting.
      </div>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {REPORT_TYPES.length} report types available · scoped to {company.name} ·
          viewing as {ROLE_LABELS[role]}
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORT_TYPES.map((type) => (
          <Card key={type}>
            <CardHeader>
              <CardTitle className="text-base">{REPORT_LABEL[type]}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600 min-h-[3rem]">
                {REPORT_DESCRIPTION[type]}
              </p>
              <Link href={{ pathname: `/reports/${type}` }}>
                <Button size="sm" variant="outline">
                  Open report →
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4 text-sm text-slate-600">
          Each report supports a start / end date, an optional project filter,
          a printable HTML view (browser print → &ldquo;Save as PDF&rdquo;), and a
          one-click CSV download. CSV exports use UTF-8 with a BOM so they open
          cleanly in Excel.
        </CardContent>
      </Card>
    </div>
  );
}
