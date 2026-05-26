// Edge middleware. Three behaviors:
//
//   1. AUTH_ENABLED (NEXT_PUBLIC_SUPABASE_URL + ANON_KEY set):
//      Validate the Supabase session on every request. Refresh the access
//      token via the rotating refresh token if needed. Redirect
//      unauthenticated visitors to /login if they're trying to load any
//      app route.
//
//   2. DEMO_DEV (env vars missing AND NODE_ENV !== 'production'):
//      Do nothing — fall through to cookie-driven role/company switchers.
//      Local development only.
//
//   3. PRODUCTION_MISCONFIGURED (env vars missing AND NODE_ENV === 'production'):
//      Treat as auth-required-but-broken. Redirect every non-public route
//      to /login. We never silently fall back to the synthetic demo user.
//
// Excluded paths: static assets (handled by the matcher), the public auth
// routes (/login, /logout, /accept-invite, /no-access).

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

const PUBLIC_PATHS = [
  '/login',
  '/logout',
  '/accept-invite',
  '/no-access',
  '/forgot-password',
  '/reset-password',
];

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
 * header to every server-action invocation.
 *
 * Middleware MUST NOT issue a plain HTTP redirect (307/302) to an action
 * POST. React 19's useActionState transport expects an RSC action stream
 * as the response — a plain redirect can't be parsed and surfaces as
 * "Uncaught Error: An unexpected response was received from the server."
 * Forward unauthenticated action POSTs to the action handler instead;
 * the action's own `requireAuth()` calls `redirect('/login')` which IS
 * RSC-aware.
 */
function isServerActionRequest(req: NextRequest): boolean {
  return req.method === 'POST' && req.headers.has('next-action');
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
    if (isPublic) return NextResponse.next({ request: req });
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
            response.cookies.set(name, value, hardenCookieOptions(options));
          }
        },
      },
    },
  );

  // ===================================================================
  // PREFETCH PATH — read-only.
  //
  // Next.js Router fires speculative RSC prefetches when <Link> targets
  // enter the viewport. If we ran getUser() here, supabase-js would
  // refresh an expired access token using the rotating refresh token,
  // Supabase would invalidate the OLD refresh token at the server, and
  // we'd write new cookies onto the prefetch response. But Set-Cookie
  // headers from RSC prefetch responses do NOT reliably propagate to the
  // document cookie jar. The browser keeps the OLD refresh token, the
  // user clicks the prefetched link, the real navigation sends the
  // now-invalidated refresh token, refresh fails, and the user lands on
  // /login. That's the "sometimes works briefly, then breaks" symptom.
  //
  // On prefetch we therefore call getSession() instead. getSession reads
  // cookies, decodes the JWT locally, and returns the session WITHOUT
  // calling Supabase Auth.
  // ===================================================================
  if (isPrefetchRequest(req)) {
    const session = await safeGetSession(supabase);
    if (session?.user) {
      req.headers.set(SUPABASE_USER_ID_HEADER, session.user.id);
      req.headers.set(SUPABASE_USER_EMAIL_HEADER, session.user.email ?? '');
    }
    return NextResponse.next({ request: req });
  }

  // ===================================================================
  // REAL NAVIGATION PATH
  //
  // Try getUser() first — that's the source of truth (validates with
  // Supabase Auth, refreshes if needed). On failure (transient network
  // error, rate limit, refresh-token rotation race) fall back to
  // getSession(): the cookie-derived session is the next best thing
  // and prevents a single hiccup from logging the user out.
  //
  // This fallback is the fix for the "click sidebar tab → forced login"
  // symptom. Previously a transient getUser failure was treated identically
  // to "user is genuinely logged out" and middleware 307'd them to /login
  // even though their cookies were valid.
  // ===================================================================
  let user: { id: string; email: string | null } | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (data.user && !error) {
      user = { id: data.user.id, email: data.user.email ?? null };
    }
  } catch {
    // Network/transport error — fall through to getSession fallback below.
  }

  if (!user) {
    const session = await safeGetSession(supabase);
    if (session?.user) {
      user = { id: session.user.id, email: session.user.email ?? null };
    }
  }

  if (user) {
    req.headers.set(SUPABASE_USER_ID_HEADER, user.id);
    req.headers.set(SUPABASE_USER_EMAIL_HEADER, user.email ?? '');

    // /field/* override: pin the active company to FIELD_DEFAULT_COMPANY_ID
    // for the field shell only. Request-scoped — we mutate req.cookies so
    // getActiveCompanyId() resolves to this value during this render, but
    // we do NOT write response.cookies, so the user's persistent desktop
    // preference is untouched. Remove the env var to revert.
    // getActiveCompanyId still validates against the user's memberships,
    // so a user without membership in the target company silently falls
    // back to their own first membership.
    const fieldDefaultCompanyId =
      process.env.FIELD_DEFAULT_COMPANY_ID?.trim();
    if (fieldDefaultCompanyId && pathname.startsWith('/field')) {
      req.cookies.set('cos_company_id', fieldDefaultCompanyId);
    }

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
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    return withRefreshedCookies(NextResponse.redirect(url), response);
  }

  // Not signed in and trying to load an app route → bounce to login.
  if (!user && !isPublic) {
    if (isServerActionRequest(req)) {
      // Forward action POST without an auth header — the action's own
      // requireAuth() will redirect via the RSC-aware redirect() helper.
      return response;
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return withRefreshedCookies(NextResponse.redirect(url), response);
  }

  return response;
}

/**
 * getSession reads cookies and decodes the JWT locally. autoRefreshToken
 * is false in @supabase/ssr's server client, so this never triggers a
 * refresh attempt — it can't consume a rotating refresh token.
 */
async function safeGetSession(
  supabase: ReturnType<typeof createServerClient>,
): Promise<{ user: { id: string; email: string | null } } | null> {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      return {
        user: {
          id: data.session.user.id,
          email: data.session.user.email ?? null,
        },
      };
    }
  } catch {
    // ignore — caller treats null as "no session"
  }
  return null;
}

/**
 * Copy any cookies the Supabase client wrote to `source` (the running
 * NextResponse.next() response from setAll) onto `target` (a redirect
 * NextResponse). Without this, refreshed access/refresh tokens written
 * during middleware are silently dropped on redirect.
 */
function withRefreshedCookies(
  target: NextResponse,
  source: NextResponse,
): NextResponse {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }
  return target;
}

/**
 * Apply hardened production cookie attributes on top of whatever Supabase
 * passes us. Supabase's defaults are
 *   { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400d }
 * with NO `secure` flag. On Vercel HTTPS modern Chrome / Safari builds
 * silently drop session cookies set without `Secure`. Force Secure in
 * production; leave it off for local http dev so cookies still work
 * without TLS.
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
