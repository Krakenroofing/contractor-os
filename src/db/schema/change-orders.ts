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
import { companies } from './companies';
import { projects } from './projects';
import { proposals } from './proposals';
import { costCodes } from './cost-codes';
import { changeOrderStatusEnum, changeOrderReasonEnum } from './_enums';

export const changeOrders = pgTable(
  'change_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id').references(() => proposals.id, {
      onDelete: 'set null',
    }),
    number: text('number').notNull(),
    status: changeOrderStatusEnum('status').notNull().default('draft'),
    reason: changeOrderReasonEnum('reason').notNull().default('scope_change'),
    description: text('description').notNull(),
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 14, scale: 2 }).notNull().default('0'),
    scheduleImpactDays: integer('schedule_impact_days').notNull().default(0),
    publicToken: text('public_token').unique(),
    submittedAt: date('submitted_at'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    customerSignedAt: timestamp('customer_signed_at', { withTimezone: true }),
    customerSignedName: text('customer_signed_name'),
    customerSignedIp: text('customer_signed_ip'),
    approvedAt: date('approved_at'),
    rejectedAt: date('rejected_at'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index('change_orders_project_idx').on(t.projectId),
    projectNumberUniq: uniqueIndex('change_orders_project_number_uniq').on(
      t.projectId,
      t.number,
    ),
  }),
);

export const changeOrderLineItems = pgTable(
  'change_order_line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    changeOrderId: uuid('change_order_id')
      .notNull()
      .references(() => changeOrders.id, { onDelete: 'cascade' }),
    costCodeId: uuid('cost_code_id')
      .notNull()
      .references(() => costCodes.id, { onDelete: 'restrict' }),
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
    coIdx: index('change_order_line_items_co_idx').on(t.changeOrderId),
  }),
);

export type ChangeOrder = typeof changeOrders.$inferSelect;
export type NewChangeOrder = typeof changeOrders.$inferInsert;
export type ChangeOrderLineItem = typeof changeOrderLineItems.$inferSelect;
