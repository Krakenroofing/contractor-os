import { NextRequest } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import {
  csvFilename,
  csvResponse,
  toCsv,
  type CsvCell,
} from '@/modules/reports/lib/csv';
import { buildBalanceSheet } from '@/lib/data/general-ledger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) return new Response('Forbidden', { status: 403 });
  const companyId = await getActiveCompanyId();
  const asOf = req.nextUrl.searchParams.get('asOf') || null;
  const bs = await buildBalanceSheet(companyId, asOf);

  const rows: CsvCell[][] = [
    [`Balance Sheet${asOf ? ` — as of ${asOf}` : ''}`, ''],
    [],
    ['Section', 'Account', 'Amount'],
    ...bs.assets.map((l): CsvCell[] => ['ASSETS', l.name, l.amount]),
    ['ASSETS', 'Total assets', bs.totalAssets],
    [],
    ...bs.liabilities.map((l): CsvCell[] => ['LIABILITIES', l.name, l.amount]),
    ['LIABILITIES', 'Total liabilities', bs.totalLiabilities],
    [],
    ...bs.equity.map((l): CsvCell[] => ['EQUITY', l.name, l.amount]),
    ['EQUITY', 'Net income (current)', bs.netIncome],
    ['EQUITY', 'Total equity', bs.totalEquity],
    [],
    ['', 'Liabilities + equity', bs.totalLiabilities + bs.totalEquity],
    ['', 'Difference', bs.difference],
  ];

  return csvResponse(
    csvFilename('balance-sheet', asOf ?? '', asOf ?? ''),
    toCsv(rows),
  );
}
