// Production-safe runtime diagnostics. Renders a single line with values
// that are useful for verifying that the deployed app is reading the right
// auth/session/membership state.
//
// Safe to expose to the signed-in user: it only echoes their own email/id,
// the count of memberships they have, and the active company id (which is
// already in their cookie). No secrets, no tokens, no other tenants' data.
//
// To hide once the rollout is verified, remove the import in
// src/app/(app)/layout.tsx.

import { getCurrentUser, isAuthEnabled, isDevDemoMode } from '@/lib/auth';
import { listMembershipsForUser } from '@/lib/data/memberships';
import { getActiveCompanyId } from '@/lib/active-company';

export async function DiagnosticsBanner() {
  const authEnabled = isAuthEnabled();
  const demoMode = isDevDemoMode();
  const user = await getCurrentUser();
  const memberships = user ? await listMembershipsForUser(user.id) : [];
  // Resolving the active company id may redirect (auth-enabled with zero
  // memberships). The (app) layout guards that case before this component
  // renders, so we can safely call it here.
  const activeCompanyId = user ? await getActiveCompanyId() : null;

  const tone = demoMode
    ? 'bg-amber-50 border-amber-300 text-amber-900'
    : authEnabled
      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
      : 'bg-red-50 border-red-300 text-red-900';

  return (
    <div
      data-testid="diagnostics-banner"
      className={`rounded-md border px-3 py-1.5 text-[11px] font-mono flex flex-wrap gap-x-4 gap-y-0.5 ${tone}`}
    >
      <span>
        authEnabled: <strong>{String(authEnabled)}</strong>
      </span>
      <span>
        email: <strong>{user?.email ?? '—'}</strong>
      </span>
      <span>
        userId: <strong>{user?.id ?? '—'}</strong>
      </span>
      <span>
        memberships: <strong>{memberships.length}</strong>
      </span>
      <span>
        companyId: <strong>{activeCompanyId ?? '—'}</strong>
      </span>
    </div>
  );
}
