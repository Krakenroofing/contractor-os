import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  numeric,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { projects } from './projects';
import { costCodeCategoryEnum } from './_enums';

export const costCodeLibraries = pgTable('cost_code_libraries', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isGlobal: boolean('is_global').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const costCodes = pgTable(
  'cost_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    libraryId: uuid('library_id')
      .notNull()
      .references(() => costCodeLibraries.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    description: text('description').notNull(),
    category: costCodeCategoryEnum('category').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    libraryCodeUniq: uniqueIndex('cost_codes_library_code_uniq').on(t.libraryId, t.code),
  }),
);

export const projectCostCodes = pgTable(
  'project_cost_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    costCodeId: uuid('cost_code_id')
      .notNull()
      .references(() => costCodes.id, { onDelete: 'restrict' }),
    budgetedAmount: numeric('budgeted_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectCodeUniq: uniqueIndex('project_cost_codes_project_code_uniq').on(
      t.projectId,
      t.costCodeId,
    ),
    projectIdx: index('project_cost_codes_project_idx').on(t.projectId),
  }),
);

export type CostCodeLibrary = typeof costCodeLibraries.$inferSelect;
export type CostCode = typeof costCodes.$inferSelect;
export type ProjectCostCode = typeof projectCostCodes.$inferSelect;
