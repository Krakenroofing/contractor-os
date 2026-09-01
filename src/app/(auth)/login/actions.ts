// Server-side login. Switched from browser-side signInWithPassword (which
// writes cookies via document.cookie and was being silently rejected by the
// browser) to a Server Action that uses @supabase/ssr's createServerClient.
// The setAll callback writes the auth cookies via cookieStore.set, which
// emits real Set-Cookie response headers — the standard mechanism browsers
// accept reliably across all privacy settings.

'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { z } from 'zod';
import { updateUserLastLogin } from '@/lib/data/users';
import { recordLogin } from '@/lib/data/login-sessions';

export type LoginState = {
  error?: string;
};

const schema = z.object({
  email: z.string().email('Please enter a valid email').max(200),
  password: z.string().min(1, 'Password is required').max(200),
  next: z.string().optional(),
  remember: z.string().optional(),
});

/**
 * Force `Secure` and explicit `SameSite=Lax` / `Path=/` on production HTTPS.
 * Supabase's defaults omit `Secure`; some browser configurations refuse to
 * persist non-Secure auth cookies on HTTPS pages, which surfaces as "no
 * cookie in DevTools after a successful sign-in". Local dev keeps the
 * default so http://localhost still works without TLS.
 *
 * When `remember` is false, strip the persistence attributes (maxAge /
 * expires) so the browser treats them as session cookies that vanish on
 * browser close.
 */
function hardenCookieOptions(
  options: CookieOptions | undefined,
  remember: boolean,
): CookieOptions {
  const isProduction = process.env.NODE_ENV === 'production';
  const base: CookieOptions = {
    ...options,
    path: options?.path ?? '/',
    sameSite: options?.sameSite ?? 'lax',
    secure: isProduction ? true : (options?.secure ?? false),
    httpOnly: options?.httpOnly ?? false,
  };
  if (!remember) {
    delete base.maxAge;
    delete base.expires;
  }
  return base;
}

export async function signInAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return {
      error:
        'Auth is not configured on this deployment. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    };
  }

  const parsed = schema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? '',
    remember: formData.get('remember') ?? '',
  });
  if (!parsed.success) {
    return {
      error: parsed.error.errors[0]?.message ?? 'Invalid email or password.',
    };
  }

  // HTML checkboxes only submit a value when checked. The default browser
  // value is "on" — anything truthy here means the user wants persistent
  // cookies; missing or empty means session-only.
  const remember = parsed.data.remember === 'on';

  const cookieStore = await cookies();
  const cookiesWritten: { name: string; valueLen: number }[] = [];

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (
        cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
      ) => {
        // Server Actions CAN write cookies — these go out as Set-Cookie
        // headers on the action's response. That's the reliable path that
        // the browser-side document.cookie write was failing.
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, hardenCookieOptions(options, remember));
          cookiesWritten.push({ name, valueLen: value?.length ?? 0 });
        }
      },
    },
  });

  const { data: signInData, error: signInError } =
    await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });

  if (signInError) {
    return { error: signInError.message };
  }

  // Defensive check: signInWithPassword succeeded, but if setAll never
  // fired we'd have no cookies on the response and the next request would
  // come back unauthenticated.
  if (cookiesWritten.length === 0) {
    return {
      error:
        'Sign in succeeded but the server failed to write the auth cookie. Please try again.',
    };
  }

  // Resolve the post-login destination.
  //
  // Priority order:
  //   1. The `next` form field, if it's a safe same-origin path. (This is
  //      what middleware sets when an unauthenticated user lands on a
  //      protected URL — we send them back there after sign-in.)
  //   2. Role-based default: field_user → /field (the mobile app shell),
  //      everyone else → /dashboard (desktop).
  //
  // Why this default matters: field workers signing in on their phone
  // expect the mobile UI, not the dense desktop dashboard. A signed-in
  // field_user can still reach /dashboard manually if they want, but
  // out-of-the-box the login flow should land them where they'll
  // actually work.
  // Stamp last sign-in + open an activity-session row for the owner admin
  // view. Best-effort — never block the login on these writes.
  if (signInData?.user) {
    try {
      await updateUserLastLogin(signInData.user.id);
      const ua = (await headers()).get('user-agent');
      await recordLogin(signInData.user.id, ua);
    } catch {
      /* ignore */
    }
  }

  let next = '/dashboard';
  if (parsed.data.next && parsed.data.next.startsWith('/')) {
    next = parsed.data.next;
  } else if (signInData?.user) {
    // Look up the signed-in user's first active membership to read their
    // role. We don't pick a specific company here — pickFirstMembership
    // is just for routing the landing page. The active-company helper
    // takes over from here.
    const { data: membership } = await supabase
      .from('memberships')
      .select('role')
      .eq('user_id', signInData.user.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (membership?.role === 'field_user') {
      next = '/field';
    }
  }

  // redirect() throws NEXT_REDIRECT — the cookies set above ARE included
  // in the redirect response's Set-Cookie headers, so the browser stores
  // them before following the 303 to `next`.
  redirect(next as never);
}
