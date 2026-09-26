import { pgTable, uuid, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { accountingAccounts } from './accounting-accounts';

// Roadmap P7: each company's single intercompany account per partner (its
// net Due from / Due to position) + where mirrored offsets land until the
// partner's accountant reclassifies them.
export const intercompanyAccounts = pgTable(
  'intercompany_accounts',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    partnerCompanyId: uuid('partner_company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accountingAccounts.id, { onDelete: 'cascade' }),
    clearingAccountId: uuid('clearing_account_id').references(
      () => accountingAccounts.id,
      { onDelete: 'set null' },
    ),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.companyId, t.partnerCompanyId] }),
  }),
);

export type IntercompanyAccount = typeof intercompanyAccounts.$inferSelect;
