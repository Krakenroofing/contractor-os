import { NextRequest } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { csvFilename, csvResponse, toCsv, type CsvCell } from '@/modules/reports/lib/csv';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { buildProjectFinancialReport } from '@/modules/reports/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) {
    return new Response('Forbidden', { status: 403 });
  }
  const companyId = await getActiveCompanyId();
  const filters = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  const report = await buildProjectFinancialReport(companyId, filters);

  const rows: CsvCell[][] = [
    [
      'Project number',
      'Project name',
      'Customer',
      'Status',
      'Contract value',
      'Change orders',
      'Revised contract',
      'Total invoiced',
      'Total paid',
      'Outstanding AR',
      'Retainage held',
      'Retainage released',
      'Retainage balance',
      'Total cost',
      'Gross profit',
      'Margin %',
    ],
    ...report.rows.map((r) => [
      r.projectNumber,
      r.projectName,
      r.customerName,
      r.status,
      r.contractValue,
      r.changeOrders,
      r.revisedContractValue,
      r.totalInvoiced,
      r.totalPaid,
      r.outstandingAR,
      r.retainageHeld,
      r.retainageReleased,
      r.retainageBalance,
      r.totalCost,
      r.grossProfit,
      r.marginPct,
    ]),
    [],
    [
      'TOTALS',
      '',
      '',
      '',
      report.totals.contractValue,
      report.totals.changeOrders,
      report.totals.revisedContractValue,
      report.totals.totalInvoiced,
      report.totals.totalPaid,
      report.totals.outstandingAR,
      report.totals.retainageHeld,
      report.totals.retainageReleased,
      report.totals.retainageBalance,
      report.totals.totalCost,
      report.totals.grossProfit,
      report.weightedMarginPct,
    ],
  ];

  return csvResponse(
    csvFilename('project-financial', filters.from, filters.to),
    toCsv(rows),
  );
}
