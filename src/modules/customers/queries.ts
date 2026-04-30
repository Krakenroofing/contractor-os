import 'server-only';
import { getActiveCompanyId } from '@/lib/active-company';
import { listMockCustomers } from '@/lib/mock-store';

export async function listCustomersForSelect() {
  const companyId = await getActiveCompanyId();
  return listMockCustomers(companyId).map((c) => ({ id: c.id, name: c.name }));
}
