// Server-side login. Switched from browser-side signInWithPassword (which
// writes cookies via document.cookie and was being silently rejected by the
// browser) to a Server Action that uses @supabase/ssr's createServerClient.
// The setAll callback writes the auth cookies via cookieStore.set, which
// emits real Set-Cookie response headers — the standard mechanism browsers
// accept reliably across all privacy settings.

'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { z } from 'zod';

export type LoginState = {
  error?: string;
};

const schema = z.object({
  email: z.string().email('Please enter a valid email').max(200),
  password: z.string().min(1, 'Password is required').max(200),
  next: z.string().optional(),
});

/**
 * Force `Secure` and explicit `SameSite=Lax` / `Path=/` on production HTTPS.
 * Supabase's defaults omit `Secure`; some browser configurations refuse to
 * persist non-Secure auth cookies on HTTPS pages, which surfaces as "no
 * cookie in DevTools after a successful sign-in". Local dev keeps the
 * default so http://localhost still works without TLS.
 */
function hardenCookieOptions(options: CookieOptions | undefined): CookieOptions {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    ...options,
    path: options?.path ?? '/',
    sameSite: options?.sameSite ?? 'lax',
    secure: isProduction ? true : (options?.secure ?? false),
    httpOnly: options?.httpOnly ?? false,
  };
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
  });
  if (!parsed.success) {
    return {
      error: parsed.error.errors[0]?.message ?? 'Invalid email or password.',
    };
  }

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
          cookieStore.set(name, value, hardenCookieOptions(options));
          cookiesWritten.push({ name, valueLen: value?.length ?? 0 });
        }
      },
    },
  });

  const { data, error: signInError } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  console.log('[contractor-os] signInAction', {
    ok: !signInError,
    userId: data?.user?.id ?? null,
    error: signInError?.message ?? null,
    cookiesWritten: cookiesWritten.map((c) => `${c.name}(${c.valueLen}b)`),
  });

  if (signInError) {
    return { error: signInError.message };
  }

  // Defensive check: signInWithPassword succeeded, but if setAll never
  // fired we'd have no cookies on the response and the next request would
  // come back unauthenticated. Surface the bug instead of silently
  // redirecting into a broken state.
  if (cookiesWritten.length === 0) {
    return {
      error:
        'Sign in succeeded but the server failed to write the auth cookie. Check Vercel function logs for [contractor-os] signInAction output.',
    };
  }

  // Confirm the just-written session validates round-trip.
  const { data: verify } = await supabase.auth.getUser();
  if (!verify.user) {
    return {
      error:
        'Sign in succeeded but the session did not persist. Check Vercel function logs.',
    };
  }

  const next =
    parsed.data.next && parsed.data.next.startsWith('/')
      ? parsed.data.next
      : '/dashboard';
  // redirect() throws NEXT_REDIRECT — the cookies set above ARE included
  // in the redirect response's Set-Cookie headers, so the browser stores
  // them before following the 303 to `next`.
  redirect(next as never);
}
