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

/**
 * Identify Next.js Router prefetch requests. The Link component fires
 * speculative RSC prefetches for in-viewport hrefs, and these go through
 * middleware exactly like real navigations. If we let getUser() refresh
 * the Supabase session during a prefetch, the (rotating, single-use)
 * refresh token gets consumed against Supabase's server, but the
 * Set-Cookie headers on a prefetch response are not always applied to
 * the document's cookie jar. The browser keeps the OLD refresh token,
 * the user clicks the prefetched link, the actual nav request sends the
 * stale refresh token, Supabase rejects it, getUser() returns null, and
 * the user lands back on /login — exactly the symptom we hit on every
 * sidebar click after the access token edges past expiry.
 *
 * Skipping the refresh on prefetches keeps the existing tokens intact
 * for the real navigation that follows.
 */
function isPrefetchRequest(req: NextRequest): boolean {
  // Next 13/14/15 sets these on RSC prefetches. Any one is enough.
  return (
    req.headers.get('next-router-prefetch') === '1' ||
    req.headers.get('purpose') === 'prefetch' ||
    req.headers.get('x-purpose') === 'prefetch' ||
    req.headers.get('x-moz') === 'prefetch'
  );
}

function logRequest(
  req: NextRequest,
  hasUser: boolean,
  redirectTo: string | null,
) {
  // Per-request log line. Visible in Vercel function logs. Strip after
  // session persistence is verified in production.
  console.log(
    `[contractor-os] mw ${req.method} ${req.nextUrl.pathname}` +
      ` hasUser=${hasUser}` +
      ` prefetch=${isPrefetchRequest(req)}` +
      ` rsc=${req.headers.get('rsc') === '1'}` +
      (redirectTo ? ` → redirect ${redirectTo}` : ''),
  );
}

/**
 * Names of the request headers middleware uses to forward the validated
 * Supabase user to server components. Stripped from inbound requests
 * before validation so an attacker cannot impersonate a user by sending
 * these headers from the outside.
 */
export const SUPABASE_USER_ID_HEADER = 'x-supabase-user-id';
export const SUPABASE_USER_EMAIL_HEADER = 'x-supabase-user-email';

export async function middleware(req: NextRequest) {
  // Local-dev demo mode — no gating, cookie-driven role/company swaps work.
  if (isDevDemoMode()) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // Strip any inbound copies of the auth-forwarding headers. Browsers can't
  // normally set arbitrary request headers on a top-level navigation, but
  // strip defensively so a misconfigured proxy or a curl can't impersonate
  // a user by sending x-supabase-user-id directly.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete(SUPABASE_USER_ID_HEADER);
  requestHeaders.delete(SUPABASE_USER_EMAIL_HEADER);

  // Production-misconfigured: no Supabase env vars, but we're in production.
  // Refuse to silently fall through; force every protected route to /login.
  if (!isAuthEnabled()) {
    if (isPublic) {
      logRequest(req, false, null);
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
    logRequest(req, false, '/login (auth not configured)');
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // PREFETCH BAILOUT — see isPrefetchRequest() above. Don't validate the
  // session (and so don't risk consuming a rotating refresh token) for
  // speculative prefetches. Server components reading
  // SUPABASE_USER_ID_HEADER will see no user on a prefetch and skip data
  // work, but the page itself only re-renders on the real navigation that
  // follows, which goes through the full getUser() path below.
  if (isPrefetchRequest(req)) {
    logRequest(req, false, null);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Build the response we'll return so we can attach refreshed Supabase
  // session cookies to it.
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
        ) => {
          for (const { name, value } of cookiesToSet) {
            req.cookies.set(name, value);
          }
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() is the source of truth for "is there a valid session?".
  // It also refreshes the access token if needed and sets the cookies via
  // setAll above. Wrapped in try/catch because a transient network error
  // talking to Supabase Auth shouldn't sign every user out — fall through
  // as unauthenticated, the next request will retry.
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch (err) {
    console.error('[contractor-os] mw getUser threw:', err);
  }

  // If we have a validated user, forward their identity to the page render
  // via request headers. This is the canonical hand-off — server components
  // read from these headers instead of calling supabase.auth.getUser()
  // themselves, which would otherwise cause concurrent refresh races
  // against the (single-use, rotating) refresh token and result in random
  // "session lost" redirects mid-navigation.
  if (user) {
    requestHeaders.set(SUPABASE_USER_ID_HEADER, user.id);
    requestHeaders.set(SUPABASE_USER_EMAIL_HEADER, user.email ?? '');
    // Re-issue the response so the modified headers are forwarded.
    const next = NextResponse.next({ request: { headers: requestHeaders } });
    for (const cookie of response.cookies.getAll()) {
      next.cookies.set(cookie);
    }
    response = next;
  }

  // Already signed in but on /login → bounce to dashboard.
  if (user && pathname === '/login') {
    logRequest(req, true, '/dashboard');
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    return withRefreshedCookies(NextResponse.redirect(url), response);
  }

  // Not signed in and trying to load an app route → bounce to login.
  if (!user && !isPublic) {
    logRequest(req, false, '/login');
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return withRefreshedCookies(NextResponse.redirect(url), response);
  }

  logRequest(req, Boolean(user), null);
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
