// Server-side Supabase client. Uses @supabase/ssr's `createServerClient` so
// the auth session is read from / written to the Next.js cookie store. Lazy
// — the client is only constructed when env vars are present.

import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/**
 * Apply hardened production cookie attributes — same logic as the
 * middleware's hardener. Force `Secure` on Vercel HTTPS so newer Chrome /
 * Safari builds actually persist the cookie. Local dev keeps Supabase's
 * defaults so http://localhost still works.
 */
function hardenCookieOptions(
  options: CookieOptions | undefined,
): CookieOptions {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    ...options,
    path: options?.path ?? '/',
    sameSite: options?.sameSite ?? 'lax',
    secure: isProduction ? true : (options?.secure ?? false),
    httpOnly: options?.httpOnly ?? false,
  };
}

export function isAuthEnabled(): boolean {
  return (
    typeof process.env.NEXT_PUBLIC_SUPABASE_URL === 'string' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL.trim() !== '' &&
    typeof process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY === 'string' &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim() !== ''
  );
}

/**
 * True only when the app is running locally without Supabase env vars.
 *
 * Demo mode is a local-development convenience: it returns a synthetic user,
 * lets the cookie-driven role/company switchers work, and skips the Supabase
 * session gate. It must never be active in production — if Supabase env vars
 * are missing on a deployed instance, that's a misconfiguration, not an
 * invitation to run as an unauthenticated synthetic user.
 *
 * The `NODE_ENV !== 'production'` check is the production fail-safe: when set
 * by Vercel (and Next's own build pipeline), demo mode collapses to off and
 * unauthenticated users get redirected to /login by middleware.
 */
export function isDevDemoMode(): boolean {
  return !isAuthEnabled() && process.env.NODE_ENV !== 'production';
}

export async function getSupabaseServerClient() {
  if (!isAuthEnabled()) return null;
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
        ) => {
          // Tolerate "Cookies can only be modified in a Server Action or
          // Route Handler" — that's expected when this client is used during
          // a server component render. The middleware refreshes the session.
          try {
            console.log(
              `[contractor-os] supabase-server setAll: ${cookiesToSet
                .map(
                  (c) =>
                    `${c.name}(len=${c.value?.length ?? 0}${
                      c.value === '' ? ',CLEAR' : ''
                    })`,
                )
                .join(', ')}`,
            );
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, hardenCookieOptions(options));
            }
          } catch {
            // ignore — server component render
          }
        },
      },
    },
  );
}
