import 'server-only';
import { getActiveCompanyId } from '@/lib/active-company';
import { requireAuth } from '@/lib/auth';
import { listMembershipsForUser } from '@/lib/data/memberships';

/** Companies the signed-in user can see (always includes the active one). */
export async function visibleCompanyIds(): Promise<string[]> {
  const activeId = await getActiveCompanyId();
  try {
    const user = await requireAuth();
    const ms = await listMembershipsForUser(user.id);
    return [...new Set([activeId, ...ms.map((m) => m.companyId)])];
  } catch {
    return [activeId];
  }
}
