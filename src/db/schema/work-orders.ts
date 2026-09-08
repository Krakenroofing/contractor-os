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
import { employees } from './employees';
import { customers } from './customers';
import { projects } from './projects';
import { invoices } from './invoices';
import { users } from './users';
import { workOrderStatusEnum } from './_enums';

// Field work orders (service calls). The crew submits the call from the
// field app — who was on it, hours, materials used, who requested it, and
// the repairs done. The office reviews it from the dashboard, fills in the
// client, invoices, and POSTS it: posting stamps a (service) project and
// writes the labor to job_cost_entries (source 'work_order',
// source_ref_id = this row's id) so job costing and the P&L labor split
// treat it exactly like posted labor.
export const workOrders = pgTable(
  'work_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    // 'WO-1', 'WO-2', … per company.
    number: text('number').notNull(),
    status: workOrderStatusEnum('status').notNull().default('submitted'),
    workDate: date('work_date').notNull(),
    createdByEmployeeId: uuid('created_by_employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Who requested the service call — free text from the field (name /
    // phone); the office turns it into a real customer link below.
    requestedBy: text('requested_by'),
    repairsDone: text('repairs_done'),
    officeNotes: text('office_notes'),
    // Office-filled: the client, the (service) project the call books to,
    // and the invoice that bills it.
    customerId: uuid('customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    invoiceId: uuid('invoice_id').references(() => invoices.id, {
      onDelete: 'set null',
    }),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    postedByUserId: uuid('posted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    companyIdx: index('work_orders_company_idx').on(t.companyId),
    statusIdx: index('work_orders_status_idx').on(t.companyId, t.status),
    numberUniq: uniqueIndex('work_orders_company_number_uniq').on(
      t.companyId,
      t.number,
    ),
  }),
);

// Everyone on the call, with hours. `rate` is the COST rate used when the
// office posts labor to job costing — prefilled from the employee's pay
// rate for hourly workers, office-editable before posting.
export const workOrderLabor = pgTable(
  'work_order_labor',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    hours: numeric('hours', { precision: 8, scale: 2 }).notNull().default('0'),
    rate: numeric('rate', { precision: 12, scale: 4 }).notNull().default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    woIdx: index('work_order_labor_wo_idx').on(t.workOrderId),
  }),
);

// Materials used on the call — name + quantity as the crew reports them.
// Quantities are informational (the office prices them on the invoice);
// material COST still flows through receipts categorized to the project.
export const workOrderMaterials = pgTable(
  'work_order_materials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 2 })
      .notNull()
      .default('1'),
    unit: text('unit'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    woIdx: index('work_order_materials_wo_idx').on(t.workOrderId),
  }),
);

export type WorkOrder = typeof workOrders.$inferSelect;
export type NewWorkOrder = typeof workOrders.$inferInsert;
export type WorkOrderLabor = typeof workOrderLabor.$inferSelect;
export type NewWorkOrderLabor = typeof workOrderLabor.$inferInsert;
export type WorkOrderMaterial = typeof workOrderMaterials.$inferSelect;
export type NewWorkOrderMaterial = typeof workOrderMaterials.$inferInsert;
