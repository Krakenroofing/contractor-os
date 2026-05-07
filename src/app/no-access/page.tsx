// Lands here when an authenticated user has no active memberships in any
// company. Common cases: their last membership was just revoked, or they
// signed up directly through Supabase without going through an invite.
//
// Lives at the root level so it doesn't try to render the (app) sidebar
// (which would fail because the layout assumes a company is active).

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function NoAccessPage() {
  const user = await getCurrentUser();

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardContent className="p-6 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Account inactive
            </p>
            <h1 className="text-xl font-semibold text-slate-900 mt-1">
              You&apos;re not a member of any company yet
            </h1>
          </div>

          <p className="text-sm text-slate-600">
            Your sign-in worked, but your account isn&apos;t linked to a
            company. Ask your administrator to send you an invitation — they
            can do that from the Invite Users page in their workspace.
          </p>

          {user?.email && (
            <p className="text-xs text-slate-500">
              Signed in as <span className="font-mono">{user.email}</span>
            </p>
          )}

          <div className="flex items-center gap-2 pt-2">
            {/* POST-form, NOT a <Link>. /logout is POST-only — see
                src/app/logout/route.ts. */}
            <form action="/logout" method="post">
              <Button size="sm" variant="outline" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
