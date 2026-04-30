import 'server-only';
import { cookies } from 'next/headers';
import {
  KRAKEN_ID,
  getMockCompany,
  listMockCompanies,
} from './mock-store';
import type { Company } from '@/db/schema';

const COOKIE_NAME = 'cos_company_id';

export async function getActiveCompanyId(): Promise<string> {
  const c = await cookies();
  const stored = c.get(COOKIE_NAME)?.value;
  if (stored && getMockCompany(stored)) return stored;
  return KRAKEN_ID;
}

export async function getActiveCompany(): Promise<Company> {
  const id = await getActiveCompanyId();
  const company = getMockCompany(id);
  if (company) return company;
  // fallback to first seeded company
  return listMockCompanies()[0];
}

export const ACTIVE_COMPANY_COOKIE = COOKIE_NAME;
