import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { projects } from './projects';
import { employees } from './employees';
import { users } from './users';

// One row = "employee X is on project Y on date D". Per-day cardinality
// (rather than date ranges) keeps schedule updates trivial — see
// migration 2026-05-26_project_assignments.sql for the design rationale.
export const projectAssignments = pgTable(
  'project_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    assignedDate: date('assigned_date').notNull(),
    roleLabel: text('role_label'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('project_assignments_uniq').on(
      t.projectId,
      t.employeeId,
      t.assignedDate,
    ),
    employeeDateIdx: index('project_assignments_employee_date_idx').on(
      t.employeeId,
      t.assignedDate,
    ),
    projectDateIdx: index('project_assignments_project_date_idx').on(
      t.projectId,
      t.assignedDate,
    ),
    companyDateIdx: index('project_assignments_company_date_idx').on(
      t.companyId,
      t.assignedDate,
    ),
  }),
);

export type ProjectAssignment = typeof projectAssignments.$inferSelect;
export type NewProjectAssignment = typeof projectAssignments.$inferInsert;
