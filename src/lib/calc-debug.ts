import 'server-only';
import { cookies } from 'next/headers';

export const CALC_DEBUG_COOKIE = 'cos_calc_debug';

export async function getCalcDebug(): Promise<boolean> {
  const c = await cookies();
  return c.get(CALC_DEBUG_COOKIE)?.value === '1';
}
