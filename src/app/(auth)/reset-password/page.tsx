import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { Card, CardContent } from '@/components/ui/card';
import { isAuthEnabled } from '@/lib/auth';
import { ResetPasswordForm } from './reset-password-form';

export const dynamic = 'force-dynamic';

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

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error_description?: string }>;
}) {
  const params = await searchParams;

  let initialError: string | null = null;
  if (!isAuthEnabled()) {
    initialError =
      'Auth is not configured on this deployment. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.';
  } else if (params.error_description) {
    initialError = params.error_description;
  } else if (params.code) {
    // Exchange the recovery code for a session so the subsequent
    // updateUser call in the form's server action is authenticated as the
    // user who clicked the email link. This writes auth cookies onto the
    // response — once exchanged, the code is single-use.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
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
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) {
      initialError =
        'Your reset link is invalid or has expired. Request a new one from the forgot-password page.';
    }
  }

  return (
    <Card>
      <CardContent className="p-6">
        <ResetPasswordForm initialError={initialError} />
      </CardContent>
    </Card>
  );
}
