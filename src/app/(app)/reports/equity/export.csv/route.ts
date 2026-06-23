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
import { buildEquityStatement } from '@/lib/data/general-ledger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'reports')) return new Response('Forbidden', { status: 403 });
  const companyId = await getActiveCompanyId();
  const from = req.nextUrl.searchParams.get('from') || null;
  const to = req.nextUrl.searchParams.get('to') || null;
  const eq = await buildEquityStatement(companyId, { from, to });

  const rows: CsvCell[][] = [
    [
      `Statement of Shareholders' Equity${
        from || to ? ` — ${from ?? 'start'} to ${to ?? 'end'}` : ''
      }`,
      '',
      '',
      '',
    ],
    [],
    ['Component', 'Opening', 'Change', 'Closing'],
    ...eq.rows.map((r): CsvCell[] => [r.name, r.opening, r.movement, r.closing]),
    [
      'Retained earnings (accumulated)',
      eq.openingRetained,
      eq.netIncome,
      eq.closingRetained,
    ],
    ['Total equity', eq.openingTotal, eq.netChange, eq.closingTotal],
  ];

  return csvResponse(
    csvFilename('shareholders-equity', from ?? '', to ?? ''),
    toCsv(rows),
  );
}
