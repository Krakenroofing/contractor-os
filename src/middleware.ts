// Edge middleware. Three behaviors:
//
//   1. AUTH_ENABLED (NEXT_PUBLIC_SUPABASE_URL + ANON_KEY set):
//      Refresh the Supabase session cookie on every request and redirect
//      unauthenticated visitors to /login if they're trying to load any
//      app route.
//
//   2. DEMO_DEV (env vars missing AND NODE_ENV !== 'production'):
//      Do nothing — fall through to cookie-driven role/company switchers.
//      Local development only.
//
//   3. PRODUCTION_MISCONFIGURED (env vars missing AND NODE_ENV === 'production'):
//      Treat as auth-required-but-broken. Redirect every non-public route
//      to /login. The /login page itself shows a clear "Auth not configured"
//      error since the browser Supabase client also returns null. This is
//      the failure mode that prevents a deployed instance from silently
//      running as the synthetic demo user.
//
// Excluded paths: static assets (handled by the matcher), the public auth
// routes (/login, /logout, /accept-invite, /no-access).

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

const PUBLIC_PATHS = ['/login', '/logout', '/accept-invite', '/no-access'];

/**
 * Names of the request headers middleware uses to forward the validated
 * Supabase user identity to the page render. Server components read from
 * these instead of calling supabase.auth.getUser() themselves — middleware
 * is the single source of truth for "is there a session, and who is it?"
 *
 * Stripped from inbound requests before validation so an attacker cannot
 * impersonate a user by sending these headers from the outside.
 */
export const SUPABASE_USER_ID_HEADER = 'x-supabase-user-id';
export const SUPABASE_USER_EMAIL_HEADER = 'x-supabase-user-email';

function isAuthEnabled() {
  return (
    typeof process.env.NEXT_PUBLIC_SUPABASE_URL === 'string' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL.trim() !== '' &&
    typeof process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY === 'string' &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim() !== ''
  );
}

function isDevDemoMode() {
  return !isAuthEnabled() && process.env.NODE_ENV !== 'production';
}

function isPrefetchRequest(req: NextRequest): boolean {
  return (
    req.headers.get('next-router-prefetch') === '1' ||
    req.headers.get('purpose') === 'prefetch' ||
    req.headers.get('x-purpose') === 'prefetch'
  );
}

function authCookieNamesPresent(req: NextRequest): string[] {
  return req.cookies
    .getAll()
    .map((c) => c.name)
    .filter((n) => n.startsWith('sb-'));
}

function logRequest(
  req: NextRequest,
  hasUser: boolean,
  userId: string | null,
  redirectTo: string | null,
) {
  console.log(
    `[contractor-os] mw ${req.method} ${req.nextUrl.pathname}` +
      ` hasUser=${hasUser}` +
      ` userId=${userId ?? '-'}` +
      ` prefetch=${isPrefetchRequest(req)}` +
      ` rsc=${req.headers.get('rsc') === '1'}` +
      ` sbCookies=[${authCookieNamesPresent(req).join(',')}]` +
      (redirectTo ? ` → redirect ${redirectTo}` : ''),
  );
}

export async function middleware(req: NextRequest) {
  // Local-dev demo mode — no gating, cookie-driven role/company swaps work.
  if (isDevDemoMode()) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // Strip any inbound copies of the auth-forwarding headers so they can't
  // be spoofed from outside.
  req.headers.delete(SUPABASE_USER_ID_HEADER);
  req.headers.delete(SUPABASE_USER_EMAIL_HEADER);

  // Production-misconfigured: no Supabase env vars, but we're in production.
  // Refuse to silently fall through; force every protected route to /login.
  if (!isAuthEnabled()) {
    if (isPublic) {
      logRequest(req, false, null, null);
      return NextResponse.next({ request: req });
    }
    logRequest(req, false, null, '/login (auth not configured)');
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Build the response we'll return so we can attach refreshed Supabase
  // session cookies to it. Pass `request: req` so any subsequent mutations
  // to req.cookies / req.headers (by setAll below or by us setting the
  // user-id header) propagate downstream to the page render.
  let response = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
        ) => {
          // Canonical Supabase Next.js pattern: write the new cookies onto
          // the inbound request (so the same render pass sees them) AND
          // onto the outbound response (so the browser stores them).
          for (const { name, value } of cookiesToSet) {
            req.cookies.set(name, value);
          }
          response = NextResponse.next({ request: req });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() is the source of truth for "is there a valid session?".
  // It refreshes the access token if needed and writes new cookies via
  // the setAll callback above. Wrapped in try/catch — a transient network
  // hiccup talking to Supabase Auth must not sign every user out; treat
  // it as "we don't know" and let the existing cookies survive to the
  // next request.
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch (err) {
    console.error(
      `[contractor-os] mw getUser threw on ${pathname}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // Forward validated user identity to the page render via REQUEST headers.
  // Server components read from these instead of calling getUser themselves,
  // which is what was producing the "session lost on every other sidebar
  // click" symptom: each server component (layout + active-company +
  // active-role + page) was creating its own Supabase client and racing the
  // single-use, rotating refresh token. Centralising validation here
  // eliminates the race.
  //
  // CRITICAL: we do NOT skip this on Next-Router prefetches. Earlier
  // attempts bailed out on prefetch (to avoid consuming the refresh token
  // speculatively), but that left the user header unset during prefetch
  // renders of the dynamic (app) layout — which then called redirect('/login')
  // because getCurrentUser() returned null. Next's router cached that
  // redirect against the prefetched destination, so the next user click
  // replayed the cached redirect to /login. Always running getUser keeps
  // the prefetched render and the real-click render on the same code path.
  if (user) {
    req.headers.set(SUPABASE_USER_ID_HEADER, user.id);
    req.headers.set(SUPABASE_USER_EMAIL_HEADER, user.email ?? '');
    // Re-issue the response so the modified request headers (which now
    // include the user-id header) are forwarded to the destination route.
    // Carry over any Set-Cookie headers setAll wrote above.
    const next = NextResponse.next({ request: req });
    for (const cookie of response.cookies.getAll()) {
      next.cookies.set(cookie);
    }
    response = next;
  }

  // Already signed in but on /login → bounce to dashboard.
  if (user && pathname === '/login') {
    logRequest(req, true, user.id, '/dashboard');
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    return withRefreshedCookies(NextResponse.redirect(url), response);
  }

  // Not signed in and trying to load an app route → bounce to login.
  if (!user && !isPublic) {
    logRequest(req, false, null, '/login');
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return withRefreshedCookies(NextResponse.redirect(url), response);
  }

  logRequest(req, Boolean(user), user?.id ?? null, null);
  return response;
}

/**
 * Copy any cookies the Supabase client wrote to `source` (the running
 * NextResponse.next() response from setAll) onto `target` (a redirect
 * NextResponse). Without this, refreshed access/refresh tokens written
 * during middleware are silently dropped on redirect, and the browser
 * keeps using the stale tokens — which manifests as the user being
 * bounced to /login on every other navigation as the access token
 * approaches expiry.
 */
function withRefreshedCookies(target: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }
  return target;
}

export const config = {
  matcher: [
    // Run on every route except static assets / Next internals / favicons.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
