import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  date,
  boolean,
  numeric,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { projects } from './projects';
import { estimates } from './estimates';
import { proposalStatusEnum } from './_enums';

export const proposalTemplates = pgTable('proposal_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  headerHtml: text('header_html'),
  bodyHtml: text('body_html'),
  footerHtml: text('footer_html'),
  termsAndConditions: text('terms_and_conditions'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const proposals = pgTable(
  'proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    estimateId: uuid('estimate_id')
      .notNull()
      .references(() => estimates.id, { onDelete: 'restrict' }),
    templateId: uuid('template_id').references(() => proposalTemplates.id, {
      onDelete: 'set null',
    }),
    number: text('number').notNull(),
    version: integer('version').notNull().default(1),
    status: proposalStatusEnum('status').notNull().default('draft'),
    proposalDate: date('proposal_date'),
    expiryDate: date('expiry_date'),
    total: numeric('total', { precision: 14, scale: 2 }).notNull().default('0'),
    scopeOfWork: text('scope_of_work'),
    inclusions: text('inclusions'),
    exclusions: text('exclusions'),
    paymentSchedule: text('payment_schedule'),
    warrantyNotes: text('warranty_notes'),
    termsAndConditions: text('terms_and_conditions'),
    pdfUrl: text('pdf_url'),
    publicToken: text('public_token').unique(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    declinedAt: timestamp('declined_at', { withTimezone: true }),
    signatureImageUrl: text('signature_image_url'),
    signedByName: text('signed_by_name'),
    signedByEmail: text('signed_by_email'),
    signedIp: text('signed_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index('proposals_project_idx').on(t.projectId),
    companyNumberUniq: uniqueIndex('proposals_company_number_uniq').on(t.companyId, t.number),
  }),
);

export type Proposal = typeof proposals.$inferSelect;
export type NewProposal = typeof proposals.$inferInsert;
export type ProposalTemplate = typeof proposalTemplates.$inferSelect;
