import { pgTable, uuid, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { users } from './users';
import { membershipRoleEnum, membershipStatusEnum } from './_enums';

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum('role').notNull(),
    status: membershipStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyUserUniq: uniqueIndex('memberships_company_user_uniq').on(t.companyId, t.userId),
  }),
);

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
