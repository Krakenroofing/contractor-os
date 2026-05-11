// Async data accessor for daily reports + their child manpower rows.
//
// Phase 1 ships:
//   - daily_reports CRUD scoped by company_id + project_id
//   - daily_report_manpower bulk-replace per report
//
// Photos (daily_report_photos) get their own accessor in Phase 2 alongside
// the Supabase Storage helpers.
//
// Demo mode: this module deliberately does NOT have a mock-store fallback.
// Daily Reports are net-new and would require duplicating ~150 lines of
// in-memory CRUD that only matter for local-no-DB development. When
// DATABASE_URL is missing, the action layer surfaces a clear error instead.

import 'server-only';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  dailyReports,
  dailyReportManpower,
  dailyReportPhotos,
  type DailyReport,
  type DailyReportManpower,
  type DailyReportPhoto,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import { deleteDailyReportPhotoBlob } from '@/lib/storage/daily-report-photos';

export class DailyReportsNotAvailableInDemoError extends Error {
  constructor() {
    super(
      'Daily Reports require a configured database. Set DATABASE_URL and apply the daily_reports migration to use this module.',
    );
    this.name = 'DailyReportsNotAvailableInDemoError';
  }
}

export class DuplicateDailyReportDateError extends Error {
  constructor() {
    super('A daily report already exists for this project on that date.');
    this.name = 'DuplicateDailyReportDateError';
  }
}

function requireDb() {
  if (!isDatabaseConfigured()) {
    throw new DailyReportsNotAvailableInDemoError();
  }
  return getDb()!;
}

export type CreateDailyReportInput = Omit<
  DailyReport,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
>;

export type UpdateDailyReportInput = Partial<
  Omit<CreateDailyReportInput, 'companyId' | 'projectId' | 'createdBy'>
>;

export type ManpowerRowInput = {
  companyCrew: string | null;
  trade: string | null;
  workerCount: number;
  hours: string;
  notes: string | null;
  sortOrder: number;
};

export async function listDailyReportsForProject(
  companyId: string,
  projectId: string,
): Promise<DailyReport[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(dailyReports)
    .where(
      and(
        eq(dailyReports.companyId, companyId),
        eq(dailyReports.projectId, projectId),
        isNull(dailyReports.deletedAt),
      ),
    )
    .orderBy(desc(dailyReports.reportDate), desc(dailyReports.createdAt));
}

export async function countDailyReportsForProject(
  companyId: string,
  projectId: string,
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const db = getDb()!;
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(dailyReports)
    .where(
      and(
        eq(dailyReports.companyId, companyId),
        eq(dailyReports.projectId, projectId),
        isNull(dailyReports.deletedAt),
      ),
    );
  return rows[0]?.n ?? 0;
}

export async function getDailyReport(
  companyId: string,
  id: string,
): Promise<DailyReport | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(dailyReports)
    .where(
      and(
        eq(dailyReports.id, id),
        eq(dailyReports.companyId, companyId),
        isNull(dailyReports.deletedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function getManpowerForReport(
  reportId: string,
): Promise<DailyReportManpower[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(dailyReportManpower)
    .where(eq(dailyReportManpower.dailyReportId, reportId))
    .orderBy(asc(dailyReportManpower.sortOrder));
}

/**
 * Checks whether a non-voided, non-deleted report already exists for this
 * project + date. Mirrors the DB's partial unique index so we can surface a
 * friendly form error instead of a raw constraint violation.
 */
async function reportExistsForDate(
  projectId: string,
  reportDate: string,
  excludeId?: string,
): Promise<boolean> {
  const db = requireDb();
  const conds = [
    eq(dailyReports.projectId, projectId),
    eq(dailyReports.reportDate, reportDate),
    isNull(dailyReports.deletedAt),
    ne(dailyReports.status, 'void' as const),
  ];
  if (excludeId) conds.push(ne(dailyReports.id, excludeId));
  const rows = await db
    .select({ id: dailyReports.id })
    .from(dailyReports)
    .where(and(...conds))
    .limit(1);
  return rows.length > 0;
}

export async function createDailyReport(
  input: CreateDailyReportInput,
  manpower: ManpowerRowInput[],
): Promise<DailyReport> {
  const db = requireDb();
  if (await reportExistsForDate(input.projectId, input.reportDate)) {
    throw new DuplicateDailyReportDateError();
  }
  const [created] = await db.insert(dailyReports).values(input).returning();
  if (manpower.length > 0) {
    await db.insert(dailyReportManpower).values(
      manpower.map((m) => ({
        dailyReportId: created.id,
        companyCrew: m.companyCrew,
        trade: m.trade,
        workerCount: m.workerCount,
        hours: m.hours,
        notes: m.notes,
        sortOrder: m.sortOrder,
      })),
    );
  }
  return created;
}

export async function updateDailyReport(
  companyId: string,
  id: string,
  patch: UpdateDailyReportInput,
  manpower: ManpowerRowInput[] | null,
): Promise<DailyReport | undefined> {
  const db = requireDb();
  // If the report_date is being changed, make sure it doesn't collide with
  // another active report on the same date.
  if (patch.reportDate) {
    const existing = await getDailyReport(companyId, id);
    if (existing && existing.reportDate !== patch.reportDate) {
      if (await reportExistsForDate(existing.projectId, patch.reportDate, id)) {
        throw new DuplicateDailyReportDateError();
      }
    }
  }
  const rows = await db
    .update(dailyReports)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(dailyReports.id, id),
        eq(dailyReports.companyId, companyId),
        isNull(dailyReports.deletedAt),
      ),
    )
    .returning();
  if (!rows[0]) return undefined;

  if (manpower !== null) {
    // Bulk replace — simple and correct for forms with a handful of rows.
    await db
      .delete(dailyReportManpower)
      .where(eq(dailyReportManpower.dailyReportId, id));
    if (manpower.length > 0) {
      await db.insert(dailyReportManpower).values(
        manpower.map((m) => ({
          dailyReportId: id,
          companyCrew: m.companyCrew,
          trade: m.trade,
          workerCount: m.workerCount,
          hours: m.hours,
          notes: m.notes,
          sortOrder: m.sortOrder,
        })),
      );
    }
  }
  return rows[0];
}

export async function voidDailyReport(
  companyId: string,
  id: string,
  updatedBy: string | null,
): Promise<DailyReport | undefined> {
  const db = requireDb();
  const rows = await db
    .update(dailyReports)
    .set({ status: 'void', updatedAt: new Date(), updatedBy })
    .where(
      and(
        eq(dailyReports.id, id),
        eq(dailyReports.companyId, companyId),
        isNull(dailyReports.deletedAt),
      ),
    )
    .returning();
  return rows[0];
}

// ===========================================================================
// Photos
// ===========================================================================

export type CreatePhotoRecordInput = Omit<
  DailyReportPhoto,
  'id' | 'uploadedAt'
>;

export type UpdatePhotoInput = Partial<
  Pick<DailyReportPhoto, 'caption' | 'category' | 'visibleToClient'>
>;

export async function listPhotosForReport(
  reportId: string,
): Promise<DailyReportPhoto[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  return await db
    .select()
    .from(dailyReportPhotos)
    .where(eq(dailyReportPhotos.dailyReportId, reportId))
    .orderBy(asc(dailyReportPhotos.sortOrder), asc(dailyReportPhotos.uploadedAt));
}

export async function getPhoto(
  companyId: string,
  photoId: string,
): Promise<DailyReportPhoto | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select()
    .from(dailyReportPhotos)
    .where(
      and(
        eq(dailyReportPhotos.id, photoId),
        eq(dailyReportPhotos.companyId, companyId),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function createPhotoRecord(
  input: CreatePhotoRecordInput,
): Promise<DailyReportPhoto> {
  const db = requireDb();
  const [row] = await db.insert(dailyReportPhotos).values(input).returning();
  return row;
}

export async function updatePhotoRecord(
  companyId: string,
  photoId: string,
  patch: UpdatePhotoInput,
): Promise<DailyReportPhoto | undefined> {
  const db = requireDb();
  const rows = await db
    .update(dailyReportPhotos)
    .set(patch)
    .where(
      and(
        eq(dailyReportPhotos.id, photoId),
        eq(dailyReportPhotos.companyId, companyId),
      ),
    )
    .returning();
  return rows[0];
}

export async function deletePhotoRecord(
  companyId: string,
  photoId: string,
): Promise<DailyReportPhoto | undefined> {
  const db = requireDb();
  const existing = await getPhoto(companyId, photoId);
  if (!existing) return undefined;
  await db
    .delete(dailyReportPhotos)
    .where(
      and(
        eq(dailyReportPhotos.id, photoId),
        eq(dailyReportPhotos.companyId, companyId),
      ),
    );
  // Best-effort blob cleanup. If storage delete fails the DB row is already
  // gone — that's the right priority because an orphaned blob is harmless
  // (it just costs storage) but a dangling row would render as a broken
  // signed URL.
  try {
    await deleteDailyReportPhotoBlob(existing.storagePath);
  } catch {
    // swallow — see comment above
  }
  return existing;
}

export async function softDeleteDailyReport(
  companyId: string,
  id: string,
): Promise<DailyReport | undefined> {
  const db = requireDb();
  const now = new Date();
  const rows = await db
    .update(dailyReports)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(dailyReports.id, id),
        eq(dailyReports.companyId, companyId),
        isNull(dailyReports.deletedAt),
      ),
    )
    .returning();
  return rows[0];
}
