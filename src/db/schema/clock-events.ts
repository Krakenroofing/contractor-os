import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { employees } from './employees';
import { projects } from './projects';
import { costCodes } from './cost-codes';
import { users } from './users';
import { timeEntries } from './time-entries';

// One row per atomic clock punch. Sessions are derived by pairing
// adjacent (in → out) events at read time. See migration
// 2026-05-26_clock_events.sql for the design rationale.
export const clockEvents = pgTable(
  'clock_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    // Nullable — yard time / errands clock in without a specific project.
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    costCodeId: uuid('cost_code_id').references(() => costCodes.id, {
      onDelete: 'set null',
    }),
    // 'in' | 'out'. Plain text with a DB CHECK so future kinds (e.g.
    // 'break_start') can be added without an enum-alter migration.
    kind: text('kind').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    // Phone-reported GPS. Nullable because (a) older phones may not
    // resolve a fix in time, (b) the user may decline location
    // permission. Treat null as "no signal" — don't block the punch.
    gpsLat: numeric('gps_lat', { precision: 9, scale: 6 }),
    gpsLng: numeric('gps_lng', { precision: 9, scale: 6 }),
    gpsAccuracyM: numeric('gps_accuracy_m', { precision: 8, scale: 2 }),
    notes: text('notes'),
    // Phase M6.1: office review flag. Set when an owner/PM/accounting
    // confirms the punch is correct. M6.2 only posts reviewed sessions
    // to payroll. Editing a punch clears this — see updateClockEvent.
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Phase M6.2: idempotency link to the time_entries row this punch
    // posted into. Both punches of a paired session share the same FK.
    // ON DELETE SET NULL: deleting the time entry on /payroll unposts
    // the session and lets it be re-posted (the correction workflow).
    postedTimeEntryId: uuid('posted_time_entry_id').references(
      () => timeEntries.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    employeeOccurredIdx: index('clock_events_employee_occurred_idx').on(
      t.employeeId,
      t.occurredAt,
    ),
    companyOccurredIdx: index('clock_events_company_occurred_idx').on(
      t.companyId,
      t.occurredAt,
    ),
    projectIdx: index('clock_events_project_idx').on(t.projectId),
  }),
);

export type ClockEvent = typeof clockEvents.$inferSelect;
export type NewClockEvent = typeof clockEvents.$inferInsert;
export type ClockEventKind = 'in' | 'out';
