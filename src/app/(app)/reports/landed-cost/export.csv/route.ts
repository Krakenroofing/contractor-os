import { NextRequest } from 'next/server';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { csvFilename, csvResponse, toCsv, type CsvCell } from '@/modules/reports/lib/csv';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { taxLabel } from '@/modules/reports/lib/tax-label';
import { buildLandedCostReport } from '@/modules/reports/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) return new Response('Forbidden', { status: 403 });
  const company = await getActiveCompany();
  const tax = taxLabel(company.isVatActive);
  const filters = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  const report = await buildLandedCostReport(company.id, filters);

  const rows: CsvCell[][] = [
    [
      'Name',
      'Carrier',
      'Project',
      'Tariff code',
      'Quantity',
      'FOB',
      'CIF',
      'Duty',
      tax,
      'Brokerage',
      'Total landed',
      'Per unit',
      'Created',
    ],
    ...report.rows.map((r) => [
      r.name,
      r.carrier ?? '',
      r.projectName,
      r.tariffCode ?? '',
      r.quantity,
      r.fob,
      r.cif,
      r.dutyAmount,
      r.vatAmount,
      r.brokerage,
      r.totalLandedCost,
      r.perUnitCost,
      r.createdAt,
    ]),
    [],
    [
      'TOTALS',
      '',
      '',
      '',
      '',
      report.totals.fob,
      report.totals.cif,
      report.totals.dutyAmount,
      report.totals.vatAmount,
      report.totals.brokerage,
      report.totals.totalLandedCost,
      '',
      '',
    ],
    [],
    [`Effective duty + ${tax} vs CIF`, `${report.effectiveDutyVatPct}%`, '', '', '', '', '', '', '', '', '', '', ''],
  ];

  return csvResponse(
    csvFilename('landed-cost', filters.from, filters.to),
    toCsv(rows),
  );
}
