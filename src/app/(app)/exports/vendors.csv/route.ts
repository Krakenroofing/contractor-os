import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { listVendors } from '@/lib/data/vendors';
import { listCostCodes } from '@/lib/data/cost-codes';
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
  const [vendors, costCodes, accountingAccounts] = await Promise.all([
    listVendors(companyId),
    listCostCodes(companyId),
    listAccountingAccounts(companyId),
  ]);
  const costCodeById = new Map(costCodes.map((c) => [c.id, c]));
  const acctById = new Map(accountingAccounts.map((a) => [a.id, a]));

  const rows: CsvCell[][] = [
    [
      'Name',
      'Type',
      'Primary contact',
      'Email',
      'Phone',
      'Street',
      'City',
      'State',
      'Postal code',
      'TIN last 4',
      'W-9 on file',
      'Subcontractor',
      'Payment terms',
      'Default cost code',
      'Default cost type',
      'Default accounting account',
      'Notes',
    ],
    ...vendors.map((v) => {
      const defaultCC = v.defaultCostCodeId
        ? costCodeById.get(v.defaultCostCodeId)
        : null;
      const defaultAcct = v.defaultAccountingAccountId
        ? acctById.get(v.defaultAccountingAccountId)
        : null;
      return [
        v.name,
        v.isSubcontractor ? 'subcontractor' : 'supplier',
        v.primaryContactName ?? '',
        v.email ?? '',
        v.phone ?? '',
        v.addressLine1 ?? '',
        v.city ?? '',
        v.state ?? '',
        v.postalCode ?? '',
        v.taxIdLast4 ?? '',
        v.w9OnFile ? 'yes' : 'no',
        v.isSubcontractor ? 'yes' : 'no',
        v.defaultTerms ?? '',
        defaultCC ? `${defaultCC.code} ${defaultCC.description}` : '',
        v.defaultCostType ?? '',
        defaultAcct
          ? defaultAcct.code
            ? `${defaultAcct.code} ${defaultAcct.name}`
            : defaultAcct.name
          : '',
        v.notes ?? '',
      ];
    }),
  ];

  return csvResponse(csvFilename('vendors', '', ''), toCsv(rows));
}
