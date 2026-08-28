// Data layer for journal_entry_attachments — supporting documents on MANUAL
// journal entries.

import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  journalEntryAttachments,
  type JournalEntryAttachment,
  type NewJournalEntryAttachment,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export async function createJournalEntryAttachment(
  input: NewJournalEntryAttachment,
): Promise<JournalEntryAttachment> {
  const db = getDb();
  if (!db) throw new Error('Attachments require a configured database.');
  const [row] = await db
    .insert(journalEntryAttachments)
    .values(input)
    .returning();
  return row;
}

export async function listJournalEntryAttachments(
  companyId: string,
  entryIds: string[],
): Promise<JournalEntryAttachment[]> {
  if (!isDatabaseConfigured() || entryIds.length === 0) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(journalEntryAttachments)
    .where(
      and(
        eq(journalEntryAttachments.companyId, companyId),
        inArray(journalEntryAttachments.journalEntryId, entryIds),
      ),
    )
    .orderBy(asc(journalEntryAttachments.createdAt));
}

export async function getJournalEntryAttachment(
  companyId: string,
  id: string,
): Promise<JournalEntryAttachment | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(journalEntryAttachments)
    .where(
      and(
        eq(journalEntryAttachments.id, id),
        eq(journalEntryAttachments.companyId, companyId),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function deleteJournalEntryAttachment(
  companyId: string,
  id: string,
): Promise<JournalEntryAttachment | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const [row] = await db
    .delete(journalEntryAttachments)
    .where(
      and(
        eq(journalEntryAttachments.id, id),
        eq(journalEntryAttachments.companyId, companyId),
      ),
    )
    .returning();
  return row;
}
