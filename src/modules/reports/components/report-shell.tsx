// Server component that wraps every report page. Renders the screen header
// (visible on screen, hidden in print), the branded print header (hidden on
// screen, visible in print), the filter bar (hidden in print), and the
// report body (always visible).

import { Breadcrumbs } from '@/components/breadcrumbs';
import {
  REPORT_LABEL,
  REPORT_DESCRIPTION,
  describeRange,
  type ReportFilters,
  type ReportType,
} from '@/modules/reports/lib/filters';
import { BrandedPrintHeader } from './branded-print-header';
import { FilterBar } from './filter-bar';

export async function ReportShell({
  type,
  filters,
  projects,
  customers = [],
  companyName,
  children,
}: {
  type: ReportType;
  filters: ReportFilters;
  projects: { id: string; label: string }[];
  customers?: { id: string; label: string }[];
  companyName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-8 max-w-[110rem] space-y-6 print:p-0 print:max-w-none">
      <div className="print:hidden">
        <Breadcrumbs
          items={[
            { href: '/reports', label: 'Reports' },
            { label: REPORT_LABEL[type] },
          ]}
        />
      </div>

      {/* Branded header — print only. */}
      <BrandedPrintHeader type={type} filters={filters} />

      <header className="print:hidden">
        <h1 className="text-2xl font-semibold text-slate-900">
          {REPORT_LABEL[type]}
        </h1>
        <p className="text-sm text-slate-500 mt-1 max-w-3xl">
          {REPORT_DESCRIPTION[type]} · scoped to {companyName} ·{' '}
          {describeRange(filters)}
        </p>
      </header>

      <FilterBar
        reportType={type}
        initial={filters}
        projects={projects}
        customers={customers}
      />

      <div className="space-y-6">{children}</div>
    </div>
  );
}
