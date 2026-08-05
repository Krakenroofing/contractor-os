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
import { buildCashFlow, type CashFlowSection } from '@/lib/data/general-ledger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports') || !canView(role, 'accounting_accounts')) return new Response('Forbidden', { status: 403 });
  const companyId = await getActiveCompanyId();
  const from = req.nextUrl.searchParams.get('from') || null;
  const to = req.nextUrl.searchParams.get('to') || null;
  const cf = await buildCashFlow(companyId, { from, to });

  const sectionRows = (label: string, s: CashFlowSection): CsvCell[][] => [
    ...s.lines.map((l): CsvCell[] => [label, l.name, l.amount]),
    [label, 'Total', s.total],
    [],
  ];

  const rows: CsvCell[][] = [
    [`Cash Flow${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ''}`, ''],
    [],
    ['Section', 'Account', 'Amount'],
    ...sectionRows('OPERATING', cf.operating),
    ...sectionRows('INVESTING', cf.investing),
    ...sectionRows('FINANCING', cf.financing),
    ['', 'Net change in cash', cf.netChange],
    ['', 'Opening cash', cf.openingCash],
    ['', 'Closing cash', cf.closingCash],
  ];

  return csvResponse(csvFilename('cash-flow', from ?? '', to ?? ''), toCsv(rows));
}
