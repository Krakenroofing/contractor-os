// Server-side auth helpers.
//
// Three states:
//
//   1. AUTH_ENABLED — Supabase env vars present.
//      Reads the current session from the Supabase SSR client. Routes under
//      /(app)/* are protected by middleware. getCurrentUser() returns the
//      real user or null. Never returns DEMO_USER.
//
//   2. DEMO_DEV — env vars missing AND NODE_ENV !== 'production'.
//      Returns the synthetic DEMO_USER so cookie-driven role/company
//      switching keeps working without a real auth backend. Local-only.
//
//   3. PRODUCTION_MISCONFIGURED — env vars missing AND NODE_ENV === 'production'.
//      getCurrentUser() returns null. Middleware redirects every protected
//      route to /login. We never silently fall back to a synthetic user in
//      production.

import 'server-only';
import { redirect } from 'next/navigation';
import {
  getSupabaseServerClient,
  isAuthEnabled,
  isDevDemoMode,
} from '@/lib/auth/supabase-server';

export { isAuthEnabled, isDevDemoMode };

export type AuthUser = {
  id: string;
  email: string | null;
  /** Display name, falls back to email if no metadata. */
  name: string;
};

/** UUID used for the synthetic demo user when auth is not enabled. */
export const DEMO_USER_ID = '00000000-0000-0000-0000-0000000000aa';

const DEMO_USER: AuthUser = {
  id: DEMO_USER_ID,
  email: 'demo@contractor-os.local',
  name: 'Demo User',
};

/**
 * Returns the currently authenticated user, or null if not signed in.
 *
 * Returns DEMO_USER ONLY in local dev demo mode (env vars missing AND
 * not production). In production with missing env vars, returns null —
 * the middleware will redirect to /login.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  if (isDevDemoMode()) return DEMO_USER;
  if (!isAuthEnabled()) return null;
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const meta = (data.user.user_metadata ?? {}) as { name?: string };
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    name: meta.name?.trim() || data.user.email || data.user.id,
  };
}

/**
 * Same as getCurrentUser but redirects to /login when not authenticated.
 * Use from server pages and server actions that require a logged-in user.
 */
export async function requireAuth(redirectTo = '/login'): Promise<AuthUser> {
  const user = await getCurrentUser();
  // The default '/login' is a known route, but `redirectTo` is a parameter so
  // typedRoutes can't narrow it to a literal Route — cast through unknown.
  if (!user) redirect(redirectTo as unknown as Parameters<typeof redirect>[0]);
  return user;
}

/**
 * Sign the current session out. No-op in demo mode.
 */
export async function signOut() {
  if (!isAuthEnabled()) return;
  const supabase = await getSupabaseServerClient();
  if (!supabase) return;
  await supabase.auth.signOut();
}
