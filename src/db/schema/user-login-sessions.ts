import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';

// One row per sign-in session. started_at is the login; last_seen_at is a
// throttled heartbeat updated as the user navigates, so "how long they were
// on" = last_seen_at - started_at even though the web has no reliable
// logout signal. ended_at is stamped on explicit sign-out; a long
// inactivity gap closes the row and the next navigation opens a fresh one.
export const userLoginSessions = pgTable(
  'user_login_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    userAgent: text('user_agent'),
  },
  (t) => ({
    userIdx: index('user_login_sessions_user_idx').on(t.userId, t.startedAt),
  }),
);

export type UserLoginSession = typeof userLoginSessions.$inferSelect;
