import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  date,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies';
import { projects } from './projects';
import { costCodes } from './cost-codes';
import { vendors } from './vendors';
import { users } from './users';
import { jobCostSourceEnum, jobCostTypeEnum } from './_enums';

export const jobCostEntries = pgTable(
  'job_cost_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    costCodeId: uuid('cost_code_id')
      .notNull()
      .references(() => costCodes.id, { onDelete: 'restrict' }),
    source: jobCostSourceEnum('source').notNull().default('manual'),
    sourceRefId: uuid('source_ref_id'),
    // Decoupled from cost_code.category — a single code can be used for an
    // entry whose true type is 'vat'/'freight'/etc.
    costType: jobCostTypeEnum('cost_type').notNull().default('other'),
    entryDate: date('entry_date').notNull(),
    vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull().default('1'),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull().default('0'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    isBillable: boolean('is_billable').notNull().default(false),
    markupPercent: numeric('markup_percent', { precision: 6, scale: 3 }),
    // Phase 2 specialized metadata. Both nullable — used only by the labor
    // and vendor-expense entry flows respectively.
    burdenPercent: numeric('burden_percent', { precision: 6, scale: 3 }),
    vendorInvoiceNumber: text('vendor_invoice_number'),
    attachmentUrl: text('attachment_url'),
    notes: text('notes'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    projectIdx: index('job_cost_entries_project_idx').on(t.projectId),
    projectCodeIdx: index('job_cost_entries_project_code_idx').on(t.projectId, t.costCodeId),
    dateIdx: index('job_cost_entries_date_idx').on(t.entryDate),
    // Partial index excludes soft-deleted rows from cost-type rollups.
    projectTypeIdx: index('job_cost_entries_project_type_idx')
      .on(t.projectId, t.costType)
      .where(sql`${t.deletedAt} IS NULL`),
  }),
);

export const laborEntries = pgTable(
  'labor_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    costCodeId: uuid('cost_code_id')
      .notNull()
      .references(() => costCodes.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    workerName: text('worker_name').notNull(),
    workDate: date('work_date').notNull(),
    hours: numeric('hours', { precision: 8, scale: 2 }).notNull(),
    rate: numeric('rate', { precision: 14, scale: 4 }).notNull(),
    burdenPercent: numeric('burden_percent', { precision: 6, scale: 3 })
      .notNull()
      .default('0'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index('labor_entries_project_idx').on(t.projectId),
    workDateIdx: index('labor_entries_work_date_idx').on(t.workDate),
  }),
);

export type JobCostEntry = typeof jobCostEntries.$inferSelect;
export type NewJobCostEntry = typeof jobCostEntries.$inferInsert;
export type LaborEntry = typeof laborEntries.$inferSelect;
export type NewLaborEntry = typeof laborEntries.$inferInsert;
