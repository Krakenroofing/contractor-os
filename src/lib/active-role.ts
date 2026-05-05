import 'server-only';
import { cookies } from 'next/headers';
import { ROLES, canCreate, canView, type Resource, type Role } from './permissions';
import { getActiveCompanyId } from './active-company';
import { getCurrentUser, isAuthEnabled, isDevDemoMode } from '@/lib/auth';
import { getMembership } from '@/lib/data/memberships';

const COOKIE_NAME = 'cos_role';

export const ACTIVE_ROLE_COOKIE = COOKIE_NAME;

/**
 * Returns the role that should govern the current request.
 *
 * - Auth enabled: the role on the current user's membership in the active
 *   company. The role-switcher cookie is ignored (no "shadow role" in real
 *   tenants). Falls back to 'view_only' if no membership exists yet.
 * - Demo mode: the cookie-driven role-switcher used by the existing UI for
 *   testing the permission matrix.
 */
export async function getActiveRole(): Promise<Role> {
  if (isAuthEnabled()) {
    const user = await getCurrentUser();
    if (!user) return 'view_only';
    const companyId = await getActiveCompanyId();
    const membership = await getMembership(user.id, companyId);
    if (!membership) return 'view_only';
    if ((ROLES as readonly string[]).includes(membership.role)) {
      return membership.role as Role;
    }
    return 'view_only';
  }

  // Cookie-driven role-switcher is a local-development affordance only.
  // Production-without-env-vars must NOT honor it — return the most
  // restrictive role so a misconfigured deploy can't leak permissions.
  if (!isDevDemoMode()) return 'view_only';

  const c = await cookies();
  const stored = c.get(COOKIE_NAME)?.value;
  if (stored && (ROLES as readonly string[]).includes(stored)) {
    return stored as Role;
  }
  return 'owner';
}

export async function getActiveRolePerms() {
  const role = await getActiveRole();
  return {
    role,
    canView: (resource: Resource) => canView(role, resource),
    canCreate: (resource: Resource) => canCreate(role, resource),
  };
}
