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
import { getGeneralLedgerDetail } from '@/lib/data/general-ledger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) return new Response('Forbidden', { status: 403 });
  const companyId = await getActiveCompanyId();
  const p = req.nextUrl.searchParams;
  const from = p.get('from') || null;
  const to = p.get('to') || null;
  const accountId = p.get('accountId') || null;

  const detail = await getGeneralLedgerDetail(companyId, { from, to, accountId });

  const rows: CsvCell[][] = [
    [`GL Detail${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ''}`, ''],
    [],
    ['Account', 'Date', 'Entry', 'Debit', 'Credit', 'Balance'],
  ];
  for (const a of detail.accounts) {
    const label = `${a.code ? `${a.code} ` : ''}${a.name}`;
    if (from) {
      rows.push([label, '', 'Opening balance', '', '', a.openingBalance]);
    }
    for (const l of a.lines) {
      rows.push([
        label,
        l.date,
        l.memo ?? '',
        l.debit || '',
        l.credit || '',
        l.runningBalance,
      ]);
    }
    rows.push([label, '', 'Closing', a.totalDebit, a.totalCredit, a.closingBalance]);
    rows.push([]);
  }

  return csvResponse(
    csvFilename('gl-detail', from ?? '', to ?? ''),
    toCsv(rows),
  );
}
