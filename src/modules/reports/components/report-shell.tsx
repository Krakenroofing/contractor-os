// Server component that wraps every report page. Renders the print-aware
// header (which is hidden when printing), the filter bar, and the report
// body. The body is the only thing that ends up on a printed page.

import { Breadcrumbs } from '@/components/breadcrumbs';
import {
  REPORT_LABEL,
  REPORT_DESCRIPTION,
  describeRange,
  type ReportFilters,
  type ReportType,
} from '@/modules/reports/lib/filters';
import { FilterBar } from './filter-bar';

export function ReportShell({
  type,
  filters,
  projects,
  companyName,
  children,
}: {
  type: ReportType;
  filters: ReportFilters;
  projects: { id: string; label: string }[];
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

      {/* Print-only header: appears on the printed page only. */}
      <div className="hidden print:block mb-4">
        <p className="text-xs text-slate-500">{companyName}</p>
        <h1 className="text-xl font-semibold text-slate-900">
          {REPORT_LABEL[type]}
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          {describeRange(filters)} · generated {new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      </div>

      <header className="print:hidden">
        <h1 className="text-2xl font-semibold text-slate-900">
          {REPORT_LABEL[type]}
        </h1>
        <p className="text-sm text-slate-500 mt-1 max-w-3xl">
          {REPORT_DESCRIPTION[type]} · scoped to {companyName} · {describeRange(filters)}
        </p>
      </header>

      <FilterBar reportType={type} initial={filters} projects={projects} />

      <div className="space-y-6">{children}</div>
    </div>
  );
}
