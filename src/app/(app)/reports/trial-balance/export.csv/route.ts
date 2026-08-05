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
import { getTrialBalance } from '@/lib/data/general-ledger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports') || !canView(role, 'accounting_accounts')) return new Response('Forbidden', { status: 403 });
  const companyId = await getActiveCompanyId();
  const asOf = req.nextUrl.searchParams.get('asOf') || null;
  const tb = await getTrialBalance(companyId, asOf);

  const rows: CsvCell[][] = [
    [`Trial Balance${asOf ? ` — as of ${asOf}` : ''}`, '', '', ''],
    [],
    ['Group', 'Account', 'Debit', 'Credit'],
    ...tb.rows.map((r): CsvCell[] => [
      r.rollupGroup,
      `${r.code ? `${r.code} ` : ''}${r.name}`,
      r.debit,
      r.credit,
    ]),
    [],
    ['', 'Total', tb.totalDebit, tb.totalCredit],
    ['', 'Difference', tb.difference, ''],
  ];

  return csvResponse(
    csvFilename('trial-balance', asOf ?? '', asOf ?? ''),
    toCsv(rows),
  );
}
