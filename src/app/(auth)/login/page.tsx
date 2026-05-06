import { redirect } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { isAuthEnabled, isDevDemoMode } from '@/lib/auth';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  // Local-dev demo mode only: there's no real auth, so jump straight to the
  // dashboard. In production-misconfigured mode (env vars missing AND
  // NODE_ENV === 'production') we MUST NOT redirect to /dashboard — the
  // middleware would bounce that request right back to /login and the
  // browser would loop. Render the form so its inline error explains the
  // misconfiguration instead.
  if (isDevDemoMode()) {
    redirect('/dashboard');
  }

  const params = await searchParams;
  const nextUrl = typeof params.next === 'string' ? params.next : '/dashboard';
  const explicitError = typeof params.error === 'string' ? params.error : null;
  const initialError =
    explicitError ??
    (!isAuthEnabled()
      ? 'Auth is not configured on this deployment. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
      : null);

  return (
    <Card>
      <CardContent className="p-6">
        <LoginForm nextUrl={nextUrl} initialError={initialError} />
      </CardContent>
    </Card>
  );
}
