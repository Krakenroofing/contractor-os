import { NextRequest } from 'next/server';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import {
  csvFilename,
  csvResponse,
  toCsv,
  type CsvCell,
} from '@/modules/reports/lib/csv';
import { parseReportFilters } from '@/modules/reports/lib/filters';
import { exTaxLabel } from '@/modules/reports/lib/tax-label';
import { buildProfitLossReport } from '@/lib/data/profit-loss';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports') || !canView(role, 'accounting_accounts')) return new Response('Forbidden', { status: 403 });
  const company = await getActiveCompany();
  const exTax = exTaxLabel(company.isVatActive);
  const filters = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  const report = await buildProfitLossReport(company.id, filters);

  const rows: CsvCell[][] = [
    [
      `Profit & Loss — ${report.from ?? '—'} to ${report.to ?? '—'}`,
      '',
      '',
    ],
    [],
    ['Section', 'Category', 'Amount'],

    // Income block — split by revenue category (ex-VAT).
    ...report.income.accounts.map((a): CsvCell[] => [
      'INCOME',
      a.accountName,
      a.amount,
    ]),
    ...(report.income.uncategorized.total > 0
      ? ([['INCOME', 'Uncategorized revenue', report.income.uncategorized.total]] as CsvCell[][])
      : []),
    ...(report.income.creditMemos.total > 0
      ? ([[
          'INCOME',
          `Less credit memos (${report.income.creditMemos.count})`,
          -report.income.creditMemos.total,
        ]] as CsvCell[][])
      : []),
    ...report.income.contraBills.accounts.map(
      (c) =>
        [
          'INCOME',
          `Less bills — ${c.accountName} (contra)`,
          -c.amount,
        ] as CsvCell[],
    ),
    ['INCOME', 'Total', report.income.total],
    [],

    // COGS block
    ...report.cogs.accounts.map((a): CsvCell[] => [
      'COGS',
      a.accountName,
      a.amount,
    ]),
    ['COGS', 'Total', report.cogs.total],
    [],

    // Gross profit line
    ['GROSS PROFIT', '', report.grossProfit],
    [
      'GROSS PROFIT',
      `Margin: ${report.grossMarginPercent.toFixed(1)}%`,
      '',
    ],
    [],

    // OpEx block
    ...report.opex.accounts.map((a): CsvCell[] => [
      'OPEX',
      a.accountName,
      a.amount,
    ]),
    ['OPEX', 'Total', report.opex.total],
    [],

    // Net income
    ['NET INCOME', '', report.netIncome],
    [],

    // Revenue recognition (WIP, % complete) — cumulative as of today across
    // all contracts; intentionally NOT bounded by the date range above.
    [
      'WIP (% COMPLETE)',
      `As of ${report.wip.asOf.slice(0, 10)} · ${report.wip.projectCount} contract(s)`,
      '',
    ],
    ...(report.wip.costBasisAvailable
      ? ([
          ['WIP (% COMPLETE)', 'Earned to date', report.wip.earnedRevenue],
          ['WIP (% COMPLETE)', `Billed to date (${exTax})`, report.wip.billedToDate],
          [
            'WIP (% COMPLETE)',
            report.wip.overUnderBilled >= 0
              ? 'Under-billed (contract asset)'
              : 'Over-billed (deferred revenue)',
            report.wip.overUnderBilled,
          ],
        ] as CsvCell[][])
      : ([
          [
            'WIP (% COMPLETE)',
            'No cost basis (no job costs / estimates) — earned revenue not computable',
            '',
          ],
        ] as CsvCell[][])),
  ];

  // Uncategorized footer (warning) if any.
  if (report.uncategorized.total > 0) {
    rows.push([], [
      'UNCATEGORIZED',
      `${report.uncategorized.entryCount} job-cost entries (excluded from COGS/OpEx)`,
      report.uncategorized.total,
    ]);
  }

  return csvResponse(
    csvFilename('profit-loss', filters.from, filters.to),
    toCsv(rows),
  );
}
