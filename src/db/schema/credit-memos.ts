import {
  pgTable,
  uuid,
  text,
  numeric,
  date,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies';
import { customers } from './customers';
import { projects } from './projects';
import { invoices } from './invoices';
import { changeOrders } from './change-orders';
import { users } from './users';
import {
  creditMemoApplicationKindEnum,
  creditMemoStatusEnum,
} from './_enums';

// Customer-facing credit memo. Issued when an invoice was over-billed
// (cancellation, scope reduction, goodwill) and the customer is owed
// either a cash refund or an open credit balance to apply to future
// invoices. Always positive in storage — the "credit owed to customer"
// sign is implicit in the entity.
//
// Invoices stay intact at their original amount. The credit memo nets
// against them in reporting (net invoiced revenue = invoice subtotal −
// applied credit amount). Invoice payments stay intact too — refunds
// are recorded as credit_memo_applications with kind='cash_refund'.
export const creditMemos = pgTable(
  'credit_memos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    // Project is optional — credits can be issued at the customer level
    // (deposit refund, goodwill credit) with no project context.
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    // Invoice is optional — credits can be customer-level. When set, it's
    // the operator's intent to net against that specific invoice's
    // billed value.
    invoiceId: uuid('invoice_id').references(() => invoices.id, {
      onDelete: 'set null',
    }),
    // Deduct change order spawned from this credit when it's a refund for a
    // canceled / reduced scope. When set, the credit represents work that was
    // billed and then refunded, so reporting nets its amount out of the
    // project's billed-net (the CO already lowers the revised contract by the
    // same amount). NULL for goodwill / pricing-correction credits, which
    // shouldn't move the contract or billed totals.
    changeOrderId: uuid('change_order_id').references(() => changeOrders.id, {
      onDelete: 'set null',
    }),
    number: text('number').notNull(),
    issueDate: date('issue_date').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    // Running total of consumption. Maintained by the application layer
    // inside the same transaction that inserts each application row.
    appliedAmount: numeric('applied_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    status: creditMemoStatusEnum('status').notNull().default('draft'),
    reason: text('reason').notNull(),
    notes: text('notes'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
  },
  (t) => ({
    companyNumberUniq: uniqueIndex('credit_memos_company_number_uniq').on(
      t.companyId,
      t.number,
    ),
    customerIdx: index('credit_memos_customer_idx').on(t.customerId),
    projectIdx: index('credit_memos_project_idx').on(t.projectId),
    invoiceIdx: index('credit_memos_invoice_idx').on(t.invoiceId),
    changeOrderIdx: index('credit_memos_change_order_idx').on(t.changeOrderId),
    // Partial index for the "what does this customer have open?" lookup
    // that feeds the AR-aging net-out and the customer-detail tile.
    customerOpenIdx: index('credit_memos_customer_open_idx')
      .on(t.companyId, t.customerId)
      .where(sql`${t.status} IN ('issued', 'partially_applied')`),
  }),
);

// Each row records one consumption event against a credit memo. Either
// an invoice application (reduces the invoice's net billed) or a cash
// refund (bank account out the door). A single credit can be consumed
// across multiple applications of mixed kinds.
export const creditMemoApplications = pgTable(
  'credit_memo_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    creditMemoId: uuid('credit_memo_id')
      .notNull()
      .references(() => creditMemos.id, { onDelete: 'cascade' }),
    appliedAt: date('applied_at').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    kind: creditMemoApplicationKindEnum('kind').notNull(),
    // For invoice_application: which invoice this credit reduced.
    // RESTRICT on delete because deleting an invoice should require
    // unwinding its applications first.
    invoiceId: uuid('invoice_id').references(() => invoices.id, {
      onDelete: 'restrict',
    }),
    // For cash_refund: bank-account label + reference (check #, wire #).
    bankAccount: text('bank_account'),
    reference: text('reference'),
    notes: text('notes'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    creditIdx: index('credit_memo_applications_credit_idx').on(t.creditMemoId),
    invoiceIdx: index('credit_memo_applications_invoice_idx').on(t.invoiceId),
  }),
);

export type CreditMemo = typeof creditMemos.$inferSelect;
export type NewCreditMemo = typeof creditMemos.$inferInsert;
export type CreditMemoApplication = typeof creditMemoApplications.$inferSelect;
export type NewCreditMemoApplication = typeof creditMemoApplications.$inferInsert;
