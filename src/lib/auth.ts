import 'server-only';
import { MOCK_COMPANY_ID } from './mock-store';

/**
 * Auth context. In demo mode this returns the mock company id so no env vars
 * are required. Replace with a real session lookup (Clerk / Supabase / NextAuth)
 * before shipping.
 */
export async function getCurrentCompanyId(): Promise<string> {
  return process.env.DEV_COMPANY_ID ?? MOCK_COMPANY_ID;
}

export async function getCurrentUserId(): Promise<string | null> {
  return process.env.DEV_USER_ID ?? null;
}

export async function requireUserId(): Promise<string> {
  const id = await getCurrentUserId();
  if (!id) throw new Error('Not authenticated');
  return id;
}
