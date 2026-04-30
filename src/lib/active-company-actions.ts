'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getMockCompany } from './mock-store';
import { ACTIVE_COMPANY_COOKIE } from './active-company';

export async function setActiveCompanyAction(companyId: string) {
  if (!getMockCompany(companyId)) {
    return { error: 'Unknown company' };
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
