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
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  getSupabaseServerClient,
  isAuthEnabled,
  isDevDemoMode,
} from '@/lib/auth/supabase-server';
import {
  SUPABASE_USER_EMAIL_HEADER,
  SUPABASE_USER_ID_HEADER,
} from '@/middleware';

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
 * The middleware (src/middleware.ts) is the SOLE caller of
 * supabase.auth.getUser() in the server tree. It validates the session
 * (and refreshes the access token via the rotating refresh token if
 * needed), then forwards the resulting user identity to the page render
 * via the SUPABASE_USER_ID_HEADER / SUPABASE_USER_EMAIL_HEADER request
 * headers. This function just reads those headers — no Supabase call,
 * no network roundtrip, no possibility of consuming the refresh token
 * a second time from a server component and losing it.
 *
 * Why the indirection? Earlier versions called getUser() directly here.
 * Layout + active-company + active-role + page each issued an
 * independent getUser() per render. Whenever the access token was near
 * expiry, those parallel calls all raced to refresh the (single-use,
 * rotating) Supabase refresh token; whichever lost the race received
 * null, the layout's `if (!currentUser) redirect('/login')` fired, and
 * the user was bounced to login on roughly every sidebar nav. Centralising
 * the validation in middleware and passing a header downstream eliminates
 * that race entirely.
 *
 * Returns DEMO_USER ONLY in local-dev demo mode. In production-misconfigured
 * mode (env vars missing on a deployed instance), returns null and the
 * middleware redirects every protected route to /login.
 */
export const getCurrentUser = cache(async function getCurrentUser(): Promise<AuthUser | null> {
  if (isDevDemoMode()) return DEMO_USER;
  if (!isAuthEnabled()) return null;
  const h = await headers();
  const id = h.get(SUPABASE_USER_ID_HEADER);
  if (!id) return null;
  const email = h.get(SUPABASE_USER_EMAIL_HEADER) || null;
  return {
    id,
    email,
    name: email || id,
  };
});

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
