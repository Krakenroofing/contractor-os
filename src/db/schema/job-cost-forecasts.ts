import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies';
import { projects } from './projects';
import { costCodes } from './cost-codes';
import { users } from './users';

// Per-cost-code cost-to-complete forecast. Used by computeProjectFinancials
// to derive Projected Final Cost = Actual To Date + sum(cost_to_complete).
//
// One non-deleted row per (project, cost_code) — the partial unique index
// `job_cost_forecasts_project_code_uniq` enforces this. A PM can clear &
// re-add a forecast for the same code by soft-deleting and re-inserting.
export const jobCostForecasts = pgTable(
  'job_cost_forecasts',
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
    costToComplete: numeric('cost_to_complete', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    notes: text('notes'),
    riskFlag: boolean('risk_flag').notNull().default(false),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    projectIdx: index('job_cost_forecasts_project_idx').on(t.projectId),
    companyIdx: index('job_cost_forecasts_company_idx').on(t.companyId),
    projectCodeUniq: uniqueIndex('job_cost_forecasts_project_code_uniq')
      .on(t.projectId, t.costCodeId)
      .where(sql`${t.deletedAt} IS NULL`),
  }),
);

export type JobCostForecast = typeof jobCostForecasts.$inferSelect;
export type NewJobCostForecast = typeof jobCostForecasts.$inferInsert;
