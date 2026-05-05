import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { users } from './users';
import { membershipRoleEnum } from './_enums';

// One pending invitation per row. Owners create these; recipients consume
// them at /accept-invite by setting a password — that creates the auth user
// + the public.users row + the membership in one transaction (server action).
//
// `acceptedAt` and `revokedAt` are mutually exclusive end states. Active
// invitations are: acceptedAt IS NULL AND revokedAt IS NULL AND expiresAt > now().

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: membershipRoleEnum('role').notNull(),
    // 32 random bytes encoded as base64url. Looked up by exact match in the
    // /accept-invite handler. Stored as plaintext for simplicity — the lookup
    // path is constant-time (UNIQUE index).
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedByUserId: uuid('accepted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tokenUniq: uniqueIndex('invitations_token_uniq').on(t.token),
    companyIdx: index('invitations_company_idx').on(t.companyId),
    emailIdx: index('invitations_email_idx').on(t.email),
  }),
);

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
