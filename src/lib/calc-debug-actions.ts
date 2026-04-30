'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { CALC_DEBUG_COOKIE } from './calc-debug';

export async function setCalcDebugAction(enabled: boolean) {
  const c = await cookies();
  if (enabled) {
    c.set(CALC_DEBUG_COOKIE, '1', {
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
      sameSite: 'lax',
    });
  } else {
    c.delete(CALC_DEBUG_COOKIE);
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}
