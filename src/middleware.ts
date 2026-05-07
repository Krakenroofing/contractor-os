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

/**
 * Identify Next.js Server Action POSTs. Next attaches the `next-action`
 * header to every server-action invocation (it's the action ID).
 *
 * IMPORTANT: middleware MUST NOT issue a plain HTTP redirect (307/302) to
 * an action POST. React 19's useActionState transport expects an RSC
 * action stream as the response — a plain redirect can't be parsed and
 * surfaces in the browser as
 *
 *   Uncaught Error: An unexpected response was received from the server.
 *
 * For unauthenticated action POSTs we therefore forward the request to
 * the action handler with no auth header set; the action's own
 * `requireAuth()` / `getActiveCompanyId()` path will call
 * `redirect('/login')`, which IS RSC-aware and the client can follow.
 */
function isServerActionRequest(req: NextRequest): boolean {
  return req.method === 'POST' && req.headers.has('next-action');
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
  extra: {
    mode?: 'prefetch-readonly' | 'getUser' | 'no-auth';
    expiresAt?: number | null;
    refreshed?: boolean;
    outgoingCookies?: { name: string; value: string }[];
  } = {},
) {
  const outgoing = extra.outgoingCookies
    ? `setCookie=[${extra.outgoingCookies
        .map((c) => `${c.name}(${c.value?.length ?? 0}b)`)
        .join(',')}]`
    : 'setCookie=[]';
  const expiry =
    typeof extra.expiresAt === 'number'
      ? ` expSec=${Math.round(extra.expiresAt - Date.now() / 1000)}`
      : '';
  const mode = extra.mode ? ` mode=${extra.mode}` : '';
  const refreshed = extra.refreshed ? ' REFRESHED' : '';
  console.log(
    `[contractor-os] mw ${req.method} ${req.nextUrl.pathname}` +
      ` hasUser=${hasUser}` +
      ` userId=${userId ?? '-'}` +
      ` prefetch=${isPrefetchRequest(req)}` +
      ` rsc=${req.headers.get('rsc') === '1'}` +
      ` host=${req.headers.get('host') ?? '-'}` +
      mode +
      expiry +
      refreshed +
      ` sbCookies=[${authCookieNamesPresent(req).join(',')}]` +
      ` ${outgoing}` +
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
      logRequest(req, false, null, null, { mode: 'no-auth', outgoingCookies: [] });
      return NextResponse.next({ request: req });
    }
    logRequest(req, false, null, '/login (auth not configured)', {
      mode: 'no-auth',
      outgoingCookies: [],
    });
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
  let setAllFired = false;

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
          setAllFired = true;
          console.log(
            `[contractor-os] mw setAll firing on ${pathname}: ${cookiesToSet
              .map(
                (c) =>
                  `${c.name}(len=${c.value?.length ?? 0}${
                    c.value === '' ? ',CLEAR' : ''
                  })`,
              )
              .join(', ')}`,
          );
          for (const { name, value } of cookiesToSet) {
            req.cookies.set(name, value);
          }
          response = NextResponse.next({ request: req });
          for (const { name, value, options } of cookiesToSet) {
            // Force `secure: true` in production. Vercel only serves over
            // HTTPS, and modern Chrome/Safari are strict about persisting
            // session cookies set without the Secure flag — symptom is the
            // cookie shows up in the response but never lands in the
            // browser's cookie jar. Supabase's defaults don't set Secure,
            // hence this hardening. Local dev (http://localhost) keeps
            // Supabase's default so cookies still work without TLS.
            const finalOptions = hardenCookieOptions(options);
            response.cookies.set(name, value, finalOptions);
          }
        },
      },
    },
  );

  // ===================================================================
  // PREFETCH PATH — read-only.
  //
  // Next.js Router fires speculative RSC prefetches when <Link> targets
  // enter the viewport. Those go through middleware just like real
  // navigations. If we ran getUser() here, supabase-js would refresh an
  // expired access token using the rotating refresh token, Supabase would
  // invalidate the OLD refresh token at the server, and we'd write new
  // cookies onto the prefetch response. But Set-Cookie headers from RSC
  // prefetch responses do NOT reliably propagate to the document cookie
  // jar (the prefetch response is consumed by Next's router cache, not
  // the page response that sets cookies). The browser keeps the OLD
  // refresh token, the user clicks the prefetched link, the real
  // navigation sends the now-invalidated refresh token, refresh fails,
  // and the user lands on /login. That's the "sometimes works briefly,
  // then breaks" symptom — it tracks the access-token expiry boundary.
  //
  // On prefetch we therefore call getSession() instead. getSession reads
  // the cookies, decodes the JWT locally, and returns the session WITHOUT
  // calling Supabase Auth. autoRefreshToken is false in @supabase/ssr's
  // server client, so no refresh is attempted. The session may be expired
  // — that's fine, we just need the user identity to populate the
  // request header so the layout's auth gate doesn't redirect to /login.
  // The next REAL navigation will go through the getUser path below and
  // refresh properly.
  // ===================================================================
  if (isPrefetchRequest(req)) {
    let prefetchUser: { id: string; email: string | null } | null = null;
    let prefetchExpiresAt: number | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        prefetchUser = {
          id: data.session.user.id,
          email: data.session.user.email ?? null,
        };
        prefetchExpiresAt = data.session.expires_at ?? null;
      }
    } catch (err) {
      console.error(
        `[contractor-os] mw getSession threw on prefetch ${pathname}:`,
        err instanceof Error ? err.message : err,
      );
    }
    if (prefetchUser) {
      req.headers.set(SUPABASE_USER_ID_HEADER, prefetchUser.id);
      req.headers.set(SUPABASE_USER_EMAIL_HEADER, prefetchUser.email ?? '');
    }
    logRequest(req, Boolean(prefetchUser), prefetchUser?.id ?? null, null, {
      mode: 'prefetch-readonly',
      expiresAt: prefetchExpiresAt,
      refreshed: false,
      outgoingCookies: [],
    });
    // IMPORTANT: do not refresh and do not redirect on prefetch. If user is
    // null, just let Next render whatever it wants — we don't want to cache
    // a redirect-to-/login as the prefetched payload for an authenticated
    // user whose access token merely expired in flight.
    return NextResponse.next({ request: req });
  }

  // ===================================================================
  // REAL NAVIGATION PATH — getUser() validates and refreshes.
  // ===================================================================
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null;
  let expiresAt: number | null = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    // getUser doesn't return expires_at; pull it from getSession (cheap, no
    // refresh, reads in-memory state populated by getUser).
    if (user) {
      const { data: sessionData } = await supabase.auth.getSession();
      expiresAt = sessionData.session?.expires_at ?? null;
    }
  } catch (err) {
    console.error(
      `[contractor-os] mw getUser threw on ${pathname}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // Forward validated user identity to the page render via REQUEST headers.
  // Server components read from these instead of calling getUser themselves,
  // which would otherwise cause concurrent refresh races against the
  // single-use, rotating refresh token.
  if (user) {
    req.headers.set(SUPABASE_USER_ID_HEADER, user.id);
    req.headers.set(SUPABASE_USER_EMAIL_HEADER, user.email ?? '');
    // Re-issue the response so the modified request headers are forwarded
    // to the destination route. Carry over any Set-Cookie headers setAll
    // wrote above.
    const next = NextResponse.next({ request: req });
    for (const cookie of response.cookies.getAll()) {
      next.cookies.set(cookie);
    }
    response = next;
  }

  // Already signed in but on /login → bounce to dashboard.
  if (user && pathname === '/login') {
    logRequest(req, true, user.id, '/dashboard', {
      mode: 'getUser',
      expiresAt,
      refreshed: setAllFired,
      outgoingCookies: response.cookies.getAll(),
    });
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    return withRefreshedCookies(NextResponse.redirect(url), response);
  }

  // Not signed in and trying to load an app route → bounce to login.
  if (!user && !isPublic) {
    if (isServerActionRequest(req)) {
      // See isServerActionRequest() comment. A 307 here would crash
      // useActionState with "An unexpected response was received from
      // the server." Forward to the action without setting the user
      // header; the action will see null user and redirect itself via
      // `redirect('/login')`, which IS RSC-aware.
      logRequest(req, false, null, '(action — let through, no auth)', {
        mode: 'getUser',
        expiresAt,
        refreshed: setAllFired,
        outgoingCookies: response.cookies.getAll(),
      });
      return response;
    }
    logRequest(req, false, null, '/login', {
      mode: 'getUser',
      expiresAt,
      refreshed: setAllFired,
      outgoingCookies: response.cookies.getAll(),
    });
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return withRefreshedCookies(NextResponse.redirect(url), response);
  }

  logRequest(req, Boolean(user), user?.id ?? null, null, {
    mode: 'getUser',
    expiresAt,
    refreshed: setAllFired,
    outgoingCookies: response.cookies.getAll(),
  });
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

/**
 * Apply the hardened production cookie attributes on top of whatever
 * Supabase's setAll handed us. Supabase's defaults are
 * { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400d } with
 * NO `secure` flag. On Vercel HTTPS that's borderline — recent Chrome
 * builds will silently drop session cookies set without `Secure`, and
 * that's the most likely explanation for "no cookie in DevTools after
 * login" reports. Force Secure in production; leave it off for local
 * http dev where Secure cookies wouldn't be sent.
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

export const config = {
  matcher: [
    // Run on every route except static assets / Next internals / favicons.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
