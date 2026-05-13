import { NextRequest } from 'next/server';
import { inArray } from 'drizzle-orm';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/data/projects';
import { listJobCostEntriesForProject } from '@/lib/data/job-cost-entries';
import { loadCostCodeMap } from '@/lib/data/cost-codes';
import { getDb, isDatabaseConfigured } from '@/db';
import { users, vendors } from '@/db/schema';
import {
  csvResponse,
  toCsv,
  type CsvCell,
} from '@/modules/reports/lib/csv';
import { JOB_COST_TYPE_LABEL } from '@/modules/job-costing/schema';
import type { JobCostType } from '@/modules/job-costing/schema';

export const dynamic = 'force-dynamic';

// GET /job-costing/<projectId>/export-ledger.csv
//
// Streams the full posted-cost ledger for a project as CSV. One row per
// non-deleted entry; columns mirror the Cost entries table on the project's
// job-costing page so the export is the same shape the user sees.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await requireAuth();
  const role = await getActiveRole();
  if (!canView(role, 'job_costing')) {
    return new Response('Forbidden', { status: 403 });
  }
  const { projectId } = await params;
  const companyId = await getActiveCompanyId();
  const project = await getProject(companyId, projectId);
  if (!project) return new Response('Not found', { status: 404 });

  const entries = await listJobCostEntriesForProject(companyId, projectId);

  // Resolve cost codes, vendors, and uploaders in three small queries so the
  // CSV can show human-readable labels instead of raw UUIDs.
  const codeMap = await loadCostCodeMap(
    companyId,
    Array.from(new Set(entries.map((e) => e.costCodeId))),
  );
  const vendorMap = new Map<string, string>();
  const userMap = new Map<string, string>();
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const vendorIds = Array.from(
      new Set(
        entries
          .map((e) => e.vendorId)
          .filter((v): v is string => typeof v === 'string'),
      ),
    );
    if (vendorIds.length > 0) {
      const rows = await db
        .select({ id: vendors.id, name: vendors.name })
        .from(vendors)
        .where(inArray(vendors.id, vendorIds));
      for (const r of rows) vendorMap.set(r.id, r.name);
    }
    const userIds = Array.from(
      new Set(
        entries
          .map((e) => e.createdByUserId)
          .filter((v): v is string => typeof v === 'string'),
      ),
    );
    if (userIds.length > 0) {
      const rows = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, userIds));
      for (const r of rows) userMap.set(r.id, r.name || r.email);
    }
  }

  const headers: CsvCell[] = [
    'Entry date',
    'Cost code',
    'Cost code description',
    'Category',
    'Cost type',
    'Description',
    'Vendor',
    'Vendor invoice #',
    'Quantity',
    'Unit cost',
    'Amount',
    'Billable',
    'Markup %',
    'Burden %',
    'Source',
    'Notes',
    'Created by',
    'Created at',
  ];
  const rows: CsvCell[][] = [
    headers,
    ...entries.map((e) => {
      const code = codeMap.get(e.costCodeId);
      return [
        e.entryDate,
        code?.code ?? '',
        code?.description ?? '',
        code?.category ?? '',
        JOB_COST_TYPE_LABEL[e.costType as JobCostType] ?? e.costType,
        e.description,
        e.vendorId ? vendorMap.get(e.vendorId) ?? '' : '',
        e.vendorInvoiceNumber ?? '',
        e.quantity,
        e.unitCost,
        e.amount,
        e.isBillable ? 'yes' : 'no',
        e.markupPercent ?? '',
        e.burdenPercent ?? '',
        e.source,
        e.notes ?? '',
        e.createdByUserId ? userMap.get(e.createdByUserId) ?? '' : '',
        e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
      ];
    }),
  ];

  const filename = `job-cost-ledger-${project.number}-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  return csvResponse(filename, toCsv(rows));
}
