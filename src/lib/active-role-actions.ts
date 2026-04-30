'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ROLES } from './permissions';
import { ACTIVE_ROLE_COOKIE } from './active-role';

export async function setActiveRoleAction(role: string) {
  if (!(ROLES as readonly string[]).includes(role)) {
    return { error: 'Unknown role' };
  }
  const c = await cookies();
  c.set(ACTIVE_ROLE_COOKIE, role, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  revalidatePath('/', 'layout');
  return { ok: true };
}
