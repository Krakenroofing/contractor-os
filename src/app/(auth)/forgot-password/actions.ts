'use server';

import { headers } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { z } from 'zod';

export type ForgotPasswordState = {
  error?: string;
  sent?: boolean;
};

const schema = z.object({
  email: z.string().email('Please enter a valid email').max(200),
});

export async function requestPasswordResetAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return {
      error:
        'Auth is not configured on this deployment. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    };
  }

  const parsed = schema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? 'Invalid email.' };
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (
        cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
      ) => {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });

  // Build an absolute redirectTo so Supabase's recovery email lands the user
  // back on our /reset-password page. Pull the host from the request headers
  // so this works on every preview deploy without an env var.
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
    (host ? `${proto}://${host}` : '');
  const redirectTo = `${origin}/reset-password`;

  // Don't leak whether an email exists. Supabase already returns a generic
  // success for unknown emails, but we also swallow any error here so the
  // UI message is the same either way.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo });

  return { sent: true };
}
