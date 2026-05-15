import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import {
  csvFilename,
  csvResponse,
  toCsv,
  type CsvCell,
} from '@/modules/reports/lib/csv';

export const dynamic = 'force-dynamic';

export async function GET() {
  const role = await getActiveRole();
  if (!canView(role, 'exports')) {
    return new Response('Forbidden', { status: 403 });
  }
  const companyId = await getActiveCompanyId();
  const accounts = await listAccountingAccounts(companyId);
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const rows: CsvCell[][] = [
    [
      'Code',
      'Name',
      'Type',
      'Parent code',
      'Parent name',
      'Currency',
      'Archived',
    ],
    ...accounts.map((a) => {
      const parent = a.parentId ? accountById.get(a.parentId) : null;
      return [
        a.code ?? '',
        a.name,
        a.type,
        parent?.code ?? '',
        parent?.name ?? '',
        a.currency,
        a.isArchived ? 'yes' : 'no',
      ];
    }),
  ];

  return csvResponse(csvFilename('chart-of-accounts', '', ''), toCsv(rows));
}
