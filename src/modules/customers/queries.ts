import 'server-only';
import { getActiveCompanyId } from '@/lib/active-company';
import { listCustomers } from '@/lib/data/customers';

export async function listCustomersForSelect() {
  const companyId = await getActiveCompanyId();
  const rows = await listCustomers(companyId);
  return rows.map((c) => ({ id: c.id, name: c.name }));
}
