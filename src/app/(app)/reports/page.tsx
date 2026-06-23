import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView, ROLE_LABELS } from '@/lib/permissions';
import {
  REPORT_DESCRIPTION,
  REPORT_LABEL,
  REPORT_TYPES,
  type ReportType,
} from '@/modules/reports/lib/filters';
import { DataIntegrityPanel } from '@/modules/reports/components/data-integrity-panel';

export const dynamic = 'force-dynamic';

// Three reports surfaced as primary "quick access" cards. The other four
// remain available in the full grid below.
const FEATURED: ReportType[] = [
  'project-financial',
  'customer-summary',
  'accounts-receivable',
];

// Double-entry financial statements + ledgers. These read from the general
// ledger (not the operational tables) and have their own as-of / period
// filters, so they live outside the ReportShell grid above.
const ACCOUNTING_REPORTS: { href: string; label: string; description: string }[] =
  [
    {
      href: '/reports/balance-sheet',
      label: 'Balance Sheet',
      description:
        'Financial position as of a date — assets, liabilities, and equity, straight from the general ledger.',
    },
    {
      href: '/reports/cash-flow',
      label: 'Cash Flow Statement',
      description:
        'Cash movements for a period split into operating, investing, and financing activities.',
    },
    {
      href: '/reports/equity',
      label: "Statement of Shareholders' Equity",
      description:
        'Changes in equity over a period: opening balance + net income + owner contributions − draws = closing.',
    },
    {
      href: '/reports/trial-balance',
      label: 'Trial Balance',
      description:
        'Every ledger account with its debit / credit balance — proves the books balance.',
    },
    {
      href: '/reports/general-ledger',
      label: 'General Ledger',
      description:
        'Account-by-account detail of every posted journal entry behind the statements.',
    },
  ];

export default async function ReportsIndexPage() {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) redirect('/dashboard');
  const company = await getActiveCompany();
  // VAT reports are meaningless for a non-VAT company (e.g. Kraken Roofing
  // LLC, US) — hide them from the grid.
  const VAT_REPORTS: ReportType[] = ['vat-quarterly', 'vendor-vat'];
  const others = REPORT_TYPES.filter(
    (r) =>
      !FEATURED.includes(r) &&
      (company.isVatActive || !VAT_REPORTS.includes(r)),
  );

  return (
    <div className="p-8 max-w-[100rem] space-y-6">
      <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
        Reports — every report reads live from the data layer (Postgres in DB
        mode, in-memory store in demo mode). Use the date range and project
        filters on each report to narrow scope before exporting.
      </div>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {REPORT_TYPES.length} report types available · scoped to {company.name} ·
          viewing as {ROLE_LABELS[role]}
        </p>
      </header>

      {/* ===== Data integrity ===== */}
      <DataIntegrityPanel companyId={company.id} />

      {/* ===== Featured / quick-access ===== */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wide font-medium text-slate-500">
          Quick access
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {FEATURED.map((type) => (
            <Card
              key={type}
              className="border-slate-300 hover:border-slate-400 transition-colors"
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">
                    {REPORT_LABEL[type]}
                  </CardTitle>
                  <Badge tone="blue">Featured</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-slate-600 min-h-[3rem]">
                  {REPORT_DESCRIPTION[type]}
                </p>
                <Link href={{ pathname: `/reports/${type}` }}>
                  <Button size="sm">Open report →</Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ===== Accounting reports (GL-based financial statements) ===== */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wide font-medium text-slate-500">
          Accounting reports
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {ACCOUNTING_REPORTS.map((r) => (
            <Card key={r.href}>
              <CardHeader>
                <CardTitle className="text-base">{r.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-slate-600 min-h-[3rem]">
                  {r.description}
                </p>
                <Link href={{ pathname: r.href }}>
                  <Button size="sm" variant="outline">
                    Open report →
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          These statements read from the double-entry general ledger. If recent
          activity is missing, open the General Ledger and run “Rebuild from
          invoices &amp; payments”.
        </p>
      </section>

      {/* ===== Full report grid ===== */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wide font-medium text-slate-500">
          More reports
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {others.map((type) => (
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
      </section>

      <Card>
        <CardContent className="p-4 text-sm text-slate-600">
          Each report supports a start / end date, an optional project filter,
          a printable HTML view (browser print → &ldquo;Save as PDF&rdquo;), and a
          one-click CSV download. CSV exports use UTF-8 with a BOM so they open
          cleanly in Excel. The print layout adds a branded header with the
          active company&apos;s name, address, license, and contact info.
        </CardContent>
      </Card>
    </div>
  );
}
