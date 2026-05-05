import { redirect } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { isAuthEnabled } from '@/lib/auth';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  // In demo mode there's no real auth — the dashboard is open. Redirect
  // straight there so the URL bar doesn't dead-end on /login.
  if (!isAuthEnabled()) {
    redirect('/dashboard');
  }

  const params = await searchParams;
  const nextUrl = typeof params.next === 'string' ? params.next : '/dashboard';
  const errorMsg = typeof params.error === 'string' ? params.error : null;

  return (
    <Card>
      <CardContent className="p-6">
        <LoginForm nextUrl={nextUrl} initialError={errorMsg} />
      </CardContent>
    </Card>
  );
}
