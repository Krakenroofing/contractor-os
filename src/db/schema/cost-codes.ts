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
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { projects } from './projects';
import { costCodeCategoryEnum } from './_enums';

export const costCodeLibraries = pgTable(
  'cost_code_libraries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isGlobal: boolean('is_global').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One non-global library per company. The global library has
    // company_id IS NULL and is excluded from the uniqueness check via the
    // partial-index WHERE clause. Mirrors
    // migrations/2026-05-13_cost_code_library_per_company.sql.
    companyUniq: uniqueIndex('cost_code_libraries_company_uniq')
      .on(t.companyId)
      .where(sql`${t.companyId} IS NOT NULL`),
  }),
);

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
    division: text('division'),
    parentId: uuid('parent_id').references((): AnyPgColumn => costCodes.id, {
      onDelete: 'set null',
    }),
    // Optional default unit cost. Used as a fallback on PO lines when the
    // linked inventory item has no defaultCost (or no inventory item is
    // linked at all — e.g. labor / equipment rental / services). Null when
    // the code doesn't carry a standing rate.
    defaultCost: numeric('default_cost', { precision: 14, scale: 2 }),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    libraryCodeUniq: uniqueIndex('cost_codes_library_code_uniq').on(t.libraryId, t.code),
    libraryDivisionSortIdx: index('cost_codes_library_division_sort_idx').on(
      t.libraryId,
      t.division,
      t.sortOrder,
    ),
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
