'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getCompany } from '@/lib/data/companies';
import { getMembership } from '@/lib/data/memberships';
import { getCurrentUser, isAuthEnabled } from '@/lib/auth';
import { ACTIVE_COMPANY_COOKIE } from './active-company';

export async function setActiveCompanyAction(companyId: string) {
  if (!(await getCompany(companyId))) {
    return { error: 'Unknown company' };
  }

  // In auth-enabled mode, require the user to be an active member of the
  // target company. Without this check, a client could POST any company id
  // and the cookie would be set even though getActiveCompanyId would later
  // reject it — confusing UX, and a tenant-id leak surface.
  if (isAuthEnabled()) {
    const user = await getCurrentUser();
    if (!user) return { error: 'Not authenticated' };
    const membership = await getMembership(user.id, companyId);
    if (!membership) return { error: 'Not a member of this company' };
  }

  const c = await cookies();
  c.set(ACTIVE_COMPANY_COOKIE, companyId, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  revalidatePath('/', 'layout');
  return { ok: true };
}
