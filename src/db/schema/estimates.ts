import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  integer,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { projects } from './projects';
import { costCodes } from './cost-codes';
import { estimateStatusEnum } from './_enums';

export const assemblies = pgTable('assemblies', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  defaultUnit: text('default_unit'),
  defaultMarkupPercent: numeric('default_markup_percent', { precision: 6, scale: 3 })
    .notNull()
    .default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const assemblyComponents = pgTable('assembly_components', {
  id: uuid('id').primaryKey().defaultRandom(),
  assemblyId: uuid('assembly_id')
    .notNull()
    .references(() => assemblies.id, { onDelete: 'cascade' }),
  costCodeId: uuid('cost_code_id')
    .notNull()
    .references(() => costCodes.id, { onDelete: 'restrict' }),
  description: text('description').notNull(),
  unit: text('unit'),
  quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull().default('0'),
  unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull().default('0'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const estimates = pgTable(
  'estimates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    version: integer('version').notNull().default(1),
    status: estimateStatusEnum('status').notNull().default('draft'),
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 14, scale: 2 }).notNull().default('0'),
    markupPercent: numeric('markup_percent', { precision: 6, scale: 3 })
      .notNull()
      .default('0'),
    overheadPercent: numeric('overhead_percent', { precision: 6, scale: 3 })
      .notNull()
      .default('0'),
    validUntil: date('valid_until'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    parentEstimateId: uuid('parent_estimate_id').references((): AnyPgColumn => estimates.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index('estimates_project_idx').on(t.projectId),
    projectVersionUniq: uniqueIndex('estimates_project_version_uniq').on(t.projectId, t.version),
    companyNumberUniq: uniqueIndex('estimates_company_number_uniq').on(t.companyId, t.number),
  }),
);

export const estimateSections = pgTable('estimate_sections', {
  id: uuid('id').primaryKey().defaultRandom(),
  estimateId: uuid('estimate_id')
    .notNull()
    .references(() => estimates.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const estimateLineItems = pgTable(
  'estimate_line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    estimateId: uuid('estimate_id')
      .notNull()
      .references(() => estimates.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id').references(() => estimateSections.id, {
      onDelete: 'set null',
    }),
    costCodeId: uuid('cost_code_id')
      .notNull()
      .references(() => costCodes.id, { onDelete: 'restrict' }),
    assemblyId: uuid('assembly_id').references(() => assemblies.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    unit: text('unit'),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull().default('0'),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull().default('0'),
    markupPercent: numeric('markup_percent', { precision: 6, scale: 3 })
      .notNull()
      .default('0'),
    lineTotal: numeric('line_total', { precision: 14, scale: 2 }).notNull().default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    estimateIdx: index('estimate_line_items_estimate_idx').on(t.estimateId),
  }),
);

export type Estimate = typeof estimates.$inferSelect;
export type NewEstimate = typeof estimates.$inferInsert;
export type EstimateLineItem = typeof estimateLineItems.$inferSelect;
