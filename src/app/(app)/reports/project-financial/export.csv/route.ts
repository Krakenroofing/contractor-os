import { NextRequest } from 'next/server';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { csvFilename, csvResponse, toCsv, type CsvCell } from '@/modules/reports/lib/csv';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { taxLabel } from '@/modules/reports/lib/tax-label';
import { buildProjectFinancialReport } from '@/modules/reports/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) {
    return new Response('Forbidden', { status: 403 });
  }
  const company = await getActiveCompany();
  const tax = taxLabel(company.isVatActive);
  const filters = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  const report = await buildProjectFinancialReport(company.id, filters);

  const rows: CsvCell[][] = [
    [
      'Project name',
      'Customer',
      'Status',
      'Contract value',
      'Change orders',
      'Revised contract',
      'Revenue invoiced (net)',
      `${tax} invoiced`,
      'Total invoiced (gross)',
      'Base invoiced (gross)',
      'CO invoiced (gross)',
      'Revenue collected (net)',
      `${tax} collected`,
      'Total paid (gross)',
      'Base paid (gross)',
      'CO paid (gross)',
      'Outstanding AR (gross)',
      'Retainage held',
      'Retainage released',
      'Retainage balance',
      'Total cost',
      'Gross profit',
      'Margin %',
      'Verified',
    ],
    ...report.rows.map((r) => [
      r.projectName,
      r.customerName,
      r.status,
      r.contractValue,
      r.changeOrders,
      r.revisedContractValue,
      r.totalInvoicedNet,
      r.totalInvoicedVat,
      r.totalInvoiced,
      r.baseInvoiced,
      r.coInvoiced,
      r.totalPaidNet,
      r.totalPaidVat,
      r.totalPaid,
      r.baseInvoicedPaid,
      r.coInvoicedPaid,
      r.outstandingAR,
      r.retainageHeld,
      r.retainageReleased,
      r.retainageBalance,
      r.totalCost,
      r.grossProfit,
      r.marginPct,
      r.verifiedAt ? r.verifiedAt.toISOString().slice(0, 10) : '',
    ]),
    [],
    [
      'TOTALS',
      '',
      '',
      report.totals.contractValue,
      report.totals.changeOrders,
      report.totals.revisedContractValue,
      report.totals.totalInvoicedNet,
      report.totals.totalInvoicedVat,
      report.totals.totalInvoiced,
      report.totals.baseInvoiced,
      report.totals.coInvoiced,
      report.totals.totalPaidNet,
      report.totals.totalPaidVat,
      report.totals.totalPaid,
      report.totals.baseInvoicedPaid,
      report.totals.coInvoicedPaid,
      report.totals.outstandingAR,
      report.totals.retainageHeld,
      report.totals.retainageReleased,
      report.totals.retainageBalance,
      report.totals.totalCost,
      report.totals.grossProfit,
      report.weightedMarginPct,
      '',
    ],
  ];

  return csvResponse(
    csvFilename('project-financial', filters.from, filters.to),
    toCsv(rows),
  );
}
