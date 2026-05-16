// Small lookup helpers for displaying user names alongside audit fields
// (e.g., "submitted by Sam Carter on 2026-05-16"). DB-only — demo mode
// returns an empty map and the UI falls back to "—".

import 'server-only';
import { inArray } from 'drizzle-orm';
import { users } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

/** Batch fetch users by id. Returns a Map<id, name> for easy lookup. Missing
 *  ids are simply absent from the map. */
export async function getUserNamesByIds(
  ids: string[],
): Promise<Map<string, string>> {
  if (!isDatabaseConfigured() || ids.length === 0) return new Map();
  const db = getDb()!;
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
