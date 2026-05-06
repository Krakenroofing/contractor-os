// Browser-side Supabase client. Used by the login form to call
// signInWithPassword. Returns null when env vars are missing (demo mode).

'use client';

import { createBrowserClient } from '@supabase/ssr';

export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  // Force `Secure` and explicit SameSite/Path on production HTTPS. Supabase's
  // defaults omit the Secure flag, and recent Chrome / Safari builds silently
  // drop newly-set session cookies that lack Secure on HTTPS pages — symptom
  // is "no sb-…-auth-token cookie in DevTools after a successful sign-in".
  // Local dev (http://localhost) keeps the default so cookies still work
  // without TLS.
  const isProduction = process.env.NODE_ENV === 'production';
  return createBrowserClient(url, anon, {
    cookieOptions: {
      path: '/',
      sameSite: 'lax',
      secure: isProduction,
    },
  });
}
