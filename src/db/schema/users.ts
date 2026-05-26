import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { employees } from './employees';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  phone: text('phone'),
  hashedPassword: text('hashed_password'),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  // Phase M1 (field app): links a login to a specific employee record so
  // the mobile UI knows which employee just signed in. NULL for office
  // staff who aren't on payroll. Enforced 1:1 (partial unique index in
  // migration 2026-05-26_users_employee_link.sql).
  employeeId: uuid('employee_id').references(() => employees.id, {
    onDelete: 'set null',
  }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
