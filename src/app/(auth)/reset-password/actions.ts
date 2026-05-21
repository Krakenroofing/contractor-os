'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { z } from 'zod';

export type ResetPasswordState = {
  error?: string;
};

const schema = z
  .object({
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });

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

export async function updatePasswordAction(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return {
      error:
        'Auth is not configured on this deployment. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    };
  }

  const parsed = schema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.errors[0]?.message ?? 'Invalid password.',
    };
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (
        cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
      ) => {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, hardenCookieOptions(options));
        }
      },
    },
  });

  // The recovery session was established server-side when the user landed
  // on /reset-password (the ?code= was exchanged in the page component).
  // If no session is present here, the recovery link was invalid or expired.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return {
      error:
        'Your reset link is invalid or has expired. Request a new one from the forgot-password page.',
    };
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (updateError) {
    return { error: updateError.message };
  }

  // Sign the recovery session out so the user has to sign in fresh with
  // their new password — the cleanest mental model for "I reset my pw".
  await supabase.auth.signOut();

  redirect('/login?reset=1' as never);
}
