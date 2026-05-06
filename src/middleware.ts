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

// One-shot startup log so the runtime mode is visible in Vercel function
// logs after a deploy. NODE_ENV is set to 'production' by Vercel on the
// production environment; on local dev it's 'development'.
let _modeLogged = false;
function logModeOnce(req: NextRequest) {
  if (_modeLogged) return;
  _modeLogged = true;
  const authEnabled = isAuthEnabled();
  const demoMode = isDevDemoMode();
  console.log(
    `[contractor-os] runtime mode — NODE_ENV=${process.env.NODE_ENV ?? 'unset'} authEnabled=${authEnabled} demoMode=${demoMode} firstReq=${req.nextUrl.pathname}`,
  );
}

export async function middleware(req: NextRequest) {
  logModeOnce(req);

  // Local-dev demo mode — no gating, cookie-driven role/company swaps work.
  if (isDevDemoMode()) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // Production-misconfigured: no Supabase env vars, but we're in production.
  // Refuse to silently fall through; force every protected route to /login.
  if (!isAuthEnabled()) {
    if (isPublic) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Build the response we'll return so we can attach refreshed Supabase
  // session cookies to it.
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
  // It also refreshes the access token if needed and sets the cookies via
  // setAll above.
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  // Already signed in but on /login → bounce to dashboard.
  if (user && pathname === '/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    return withRefreshedCookies(NextResponse.redirect(url), response);
  }

  // Not signed in and trying to load an app route → bounce to login.
  if (!user && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return withRefreshedCookies(NextResponse.redirect(url), response);
  }

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
