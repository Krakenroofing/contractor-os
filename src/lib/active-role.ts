import 'server-only';
import { cookies } from 'next/headers';
import { ROLES, canCreate, canView, type Resource, type Role } from './permissions';

const COOKIE_NAME = 'cos_role';

export const ACTIVE_ROLE_COOKIE = COOKIE_NAME;

export async function getActiveRole(): Promise<Role> {
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
