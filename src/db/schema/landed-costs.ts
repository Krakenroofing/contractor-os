import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { projects } from './projects';
import { vendors } from './vendors';

export const landedCosts = pgTable(
  'landed_costs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    vendorId: uuid('vendor_id').references(() => vendors.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    carrier: text('carrier'),
    itemDescription: text('item_description'),
    tariffCode: text('tariff_code'),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 })
      .notNull()
      .default('0'),
    materialCost: numeric('material_cost', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    flDelivery: numeric('fl_delivery', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    crating: numeric('crating', { precision: 14, scale: 2 }).notNull().default('0'),
    freightCost: numeric('freight_cost', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    insurance: numeric('insurance', { precision: 14, scale: 2 }).notNull().default('0'),
    dutyPercent: numeric('duty_percent', { precision: 6, scale: 3 })
      .notNull()
      .default('0'),
    vatPercent: numeric('vat_percent', { precision: 6, scale: 3 })
      .notNull()
      .default('0'),
    envLevyPercent: numeric('env_levy_percent', { precision: 6, scale: 3 })
      .notNull()
      .default('0'),
    envLevyAmount: numeric('env_levy_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    excisePercent: numeric('excise_percent', { precision: 6, scale: 3 })
      .notNull()
      .default('0'),
    exciseAmount: numeric('excise_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    brokerage: numeric('brokerage', { precision: 14, scale: 2 }).notNull().default('0'),
    portFees: numeric('port_fees', { precision: 14, scale: 2 }).notNull().default('0'),
    localDelivery: numeric('local_delivery', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull().default('1'),
    fob: numeric('fob', { precision: 14, scale: 2 }).notNull().default('0'),
    cif: numeric('cif', { precision: 14, scale: 2 }).notNull().default('0'),
    dutyAmount: numeric('duty_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    vatAmount: numeric('vat_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    totalLandedCost: numeric('total_landed_cost', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    perUnitCost: numeric('per_unit_cost', { precision: 14, scale: 4 })
      .notNull()
      .default('0'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index('landed_costs_project_idx').on(t.projectId),
  }),
);

export type LandedCost = typeof landedCosts.$inferSelect;
export type NewLandedCost = typeof landedCosts.$inferInsert;
