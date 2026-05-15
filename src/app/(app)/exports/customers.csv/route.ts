import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { listCustomers } from '@/lib/data/customers';
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
  const customers = await listCustomers(companyId);

  const rows: CsvCell[][] = [
    [
      'Name',
      'Type',
      'Primary contact',
      'Email',
      'Phone',
      'Street',
      'Street 2',
      'City',
      'State',
      'Postal code',
      'TIN',
      'Notes',
    ],
    ...customers.map((c) => [
      c.name,
      c.customerType,
      c.primaryContactName ?? '',
      c.email ?? '',
      c.phone ?? '',
      c.billingAddressLine1 ?? '',
      c.billingAddressLine2 ?? '',
      c.billingCity ?? '',
      c.billingState ?? '',
      c.billingPostalCode ?? '',
      c.tinNumber ?? '',
      c.notes ?? '',
    ]),
  ];

  return csvResponse(csvFilename('customers', '', ''), toCsv(rows));
}
