// Sign-out endpoint. POST-only by design.
//
// GET requests must be safe and idempotent per HTTP semantics — browsers,
// proxies, and the Next.js Router ALL prefetch GET URLs speculatively
// (Link prefetch, hover preview, browser predictive fetch, cached
// responses, etc.). If /logout were a GET, any of those mechanisms would
// silently sign the user out the moment a sidebar Link to /logout entered
// the viewport. That was the actual cause of the "click any sidebar tab
// and get bounced to /login" symptom: the browser prefetched the Sign Out
// Link on page load, the GET handler called signOut(), cookies were
// cleared, and the next nav ran without a session.
//
// The Sign Out control in (app)/layout.tsx is now a <form method="post">
// so it cannot be prefetched and only fires on an explicit click.

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, isDevDemoMode, signOut } from '@/lib/auth';
import { endSession } from '@/lib/data/login-sessions';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Close the activity-session row before the cookies are cleared.
  // Best-effort — sign-out must never fail on a tracking write.
  try {
    const user = await getCurrentUser();
    if (user && !isDevDemoMode()) await endSession(user.id);
  } catch {
    /* ignore */
  }
  await signOut();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  const response = NextResponse.redirect(url, 303);
  // Defence in depth: never let a logout response be cached. If a CDN /
  // browser ever stored a logout response with Set-Cookie clear headers,
  // replaying it would re-clear cookies on subsequent visits.
  response.headers.set(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, max-age=0',
  );
  return response;
}

// GET to /logout: no side effects. Just bounce to /login. This handles
// stale links, bookmarks, browser prefetches, and any cached references
// to the old GET-based logout URL.
export async function GET(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  const response = NextResponse.redirect(url, 303);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
