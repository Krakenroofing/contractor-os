import { Card, CardContent } from '@/components/ui/card';
import { isAuthEnabled } from '@/lib/auth';
import { ForgotPasswordForm } from './forgot-password-form';

export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  const initialError = !isAuthEnabled()
    ? 'Auth is not configured on this deployment. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    : null;

  return (
    <Card>
      <CardContent className="p-6">
        <ForgotPasswordForm initialError={initialError} />
      </CardContent>
    </Card>
  );
}
