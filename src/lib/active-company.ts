import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { KRAKEN_ID } from './mock-store';
import { getCompany, listCompanies } from '@/lib/data/companies';
import { getCurrentUser, isAuthEnabled, isDevDemoMode } from '@/lib/auth';
import { listMembershipsForUser } from '@/lib/data/memberships';
import type { Company } from '@/db/schema';

const COOKIE_NAME = 'cos_company_id';

/**
 * Resolve the active company id, in priority order:
 *
 *   Auth-enabled mode (production / staging with Supabase env vars set):
 *     1. Cookie value, if it points to a company the current user has an
 *        active membership in.
 *     2. The user's first active membership.
 *     3. Redirect to /no-access — the user has no real memberships.
 *        (The (app) layout already redirects in this case; this is a
 *        defense-in-depth fallback.)
 *
 *   Demo mode (local dev, no Supabase env vars):
 *     1. Cookie value, if it resolves to a real mock company.
 *     2. KRAKEN_ID — the canonical demo company.
 *
 *   Production-misconfigured (no env vars in production):
 *     Redirect to /login. Middleware should have already caught this.
 *
 * In auth-enabled mode this never returns the synthetic KRAKEN_ID, so
 * authenticated users only see companies they're actually members of.
 */
export async function getActiveCompanyId(): Promise<string> {
  const c = await cookies();
  const stored = c.get(COOKIE_NAME)?.value;

  if (isAuthEnabled()) {
    const user = await getCurrentUser();
    if (!user) redirect('/login' as never);
    const memberships = await listMembershipsForUser(user.id);
    const validIds = new Set(memberships.map((m) => m.companyId));
    if (stored && validIds.has(stored)) return stored;
    if (memberships[0]) return memberships[0].companyId;
    redirect('/no-access' as never);
  }

  if (isDevDemoMode()) {
    if (stored && (await getCompany(stored))) return stored;
    return KRAKEN_ID;
  }

  // Production-misconfigured. Middleware redirects protected routes to
  // /login, but if a server action somehow reached here we refuse to
  // synthesize a tenant id.
  redirect('/login' as never);
}

export async function getActiveCompany(): Promise<Company> {
  const id = await getActiveCompanyId();
  const company = await getCompany(id);
  if (company) return company;
  if (isDevDemoMode()) {
    const all = await listCompanies();
    if (all[0]) return all[0];
  }
  // Auth-enabled but the company id we resolved isn't in the DB anymore
  // (e.g. it was deleted between membership lookup and now). Bail out.
  redirect('/no-access' as never);
}

export const ACTIVE_COMPANY_COOKIE = COOKIE_NAME;
