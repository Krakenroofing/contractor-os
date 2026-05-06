// Admin-only runtime diagnostics. Owner role required (settings is the
// resource — only owners have it). Use this page to confirm a deployment
// is reading the expected auth/session/membership state without exposing
// the values to every signed-in user.

import { redirect } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { DiagnosticsBanner } from '@/components/diagnostics-banner';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export default async function DiagnosticsPage() {
  const role = await getActiveRole();
  if (!canView(role, 'settings')) {
    redirect('/dashboard' as never);
  }

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Diagnostics</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Production-safe runtime values for the current request. Echoes only
          your own identity and the active company id from your cookie — no
          secrets, no other tenants&apos; data.
        </p>
      </header>

      <Card>
        <CardContent className="p-4 space-y-3">
          <DiagnosticsBanner />
          <p className="text-xs text-slate-500">
            <span className="font-mono">authEnabled</span> reflects whether
            <span className="font-mono"> NEXT_PUBLIC_SUPABASE_URL</span> and
            <span className="font-mono"> NEXT_PUBLIC_SUPABASE_ANON_KEY</span> are
            set. <span className="font-mono">memberships</span> is the count of
            active rows in <span className="font-mono">public.memberships</span>
            for your user.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
