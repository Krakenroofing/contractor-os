import 'server-only';
import { cookies } from 'next/headers';
import { KRAKEN_ID } from './mock-store';
import { getCompany, listCompanies } from '@/lib/data/companies';
import { getCurrentUser, isAuthEnabled } from '@/lib/auth';
import { listMembershipsForUser } from '@/lib/data/memberships';
import type { Company } from '@/db/schema';

const COOKIE_NAME = 'cos_company_id';

/**
 * Resolve the active company id, in priority order:
 *
 *   1. Cookie value, if it points to a company the current user is a member
 *      of (auth-enabled mode) or any real company (demo mode).
 *   2. The user's first membership (auth-enabled mode).
 *   3. The first company in the database (demo mode).
 *   4. KRAKEN_ID as last-resort fallback.
 */
export async function getActiveCompanyId(): Promise<string> {
  const c = await cookies();
  const stored = c.get(COOKIE_NAME)?.value;

  if (isAuthEnabled()) {
    const user = await getCurrentUser();
    if (user) {
      const memberships = await listMembershipsForUser(user.id);
      const validIds = new Set(memberships.map((m) => m.companyId));
      if (stored && validIds.has(stored)) return stored;
      if (memberships[0]) return memberships[0].companyId;
    }
    // Auth enabled but no memberships yet (e.g. first-time signup) — fall
    // through to the demo path so the app doesn't dead-end.
  }

  if (stored && (await getCompany(stored))) return stored;
  return KRAKEN_ID;
}

export async function getActiveCompany(): Promise<Company> {
  const id = await getActiveCompanyId();
  const company = await getCompany(id);
  if (company) return company;
  const all = await listCompanies();
  return all[0];
}

export const ACTIVE_COMPANY_COOKIE = COOKIE_NAME;
