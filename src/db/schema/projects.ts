import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  date,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { customers } from './customers';
import { users } from './users';
import { projectStatusEnum, projectTypeEnum } from './_enums';

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    status: projectStatusEnum('status').notNull().default('lead'),
    // production (default) vs service / T&M. See projectTypeEnum.
    projectType: projectTypeEnum('project_type').notNull().default('production'),
    jobsiteAddressLine1: text('jobsite_address_line1'),
    jobsiteAddressLine2: text('jobsite_address_line2'),
    jobsiteCity: text('jobsite_city'),
    jobsiteState: text('jobsite_state'),
    jobsitePostalCode: text('jobsite_postal_code'),
    projectManagerId: uuid('project_manager_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    estimatorId: uuid('estimator_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    startDate: date('start_date'),
    targetCompletionDate: date('target_completion_date'),
    actualCompletionDate: date('actual_completion_date'),
    contractValue: numeric('contract_value', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    originalContractValue: numeric('original_contract_value', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    totalChangeOrders: numeric('total_change_orders', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    currentBudget: numeric('current_budget', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    notes: text('notes'),
    // Service / T&M billing defaults. Only meaningful when
    // projectType = 'service'; NULL on production jobs.
    //   tmLaborBillRate — default hourly *bill* rate charged to the customer
    //     for T&M labor (distinct from employee pay/cost).
    //   tmMaterialMarkupPct — default markup % applied to billable materials /
    //     job costs when generating a T&M invoice (NULL → per-entry / company
    //     default markup).
    tmLaborBillRate: numeric('tm_labor_bill_rate', { precision: 12, scale: 2 }),
    tmMaterialMarkupPct: numeric('tm_material_markup_pct', { precision: 6, scale: 3 }),
    // Reconciliation verification — set when an operator confirms the
    // project's financials match real-world numbers.
    reconciliationVerifiedAt: timestamp('reconciliation_verified_at', {
      withTimezone: true,
    }),
    reconciliationVerifiedRole: text('reconciliation_verified_role'),
    reconciliationVerifiedNote: text('reconciliation_verified_note'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('projects_company_idx').on(t.companyId),
    customerIdx: index('projects_customer_idx').on(t.customerId),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
