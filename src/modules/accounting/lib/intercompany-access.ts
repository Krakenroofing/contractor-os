import 'server-only';
import { getMembership } from '@/lib/data/memberships';

/** Posting a mirror writes to the partner's books: the user must be an
 *  owner or accountant there too. */
export async function canPostInPartner(
  userId: string,
  partnerCompanyId: string,
): Promise<boolean> {
  const m = await getMembership(userId, partnerCompanyId);
  return Boolean(m && (m.role === 'owner' || m.role === 'accounting'));
}
