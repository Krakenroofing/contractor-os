import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { users } from './users';
import { teamTaskStatusEnum } from './_enums';

// Team notes & tasks — a per-company shared inbox any team member can post a
// note or task into for the owner/admins to address. Decisions:
//   - Scoped per company (TRB and Kraken keep separate lists).
//   - Anyone posts; owner/accounting (or the original poster) resolve.
//   - Minimal fields: body text, who posted, when, status, attachments.
//
// `createdByName` is a snapshot of the poster's display name at post time so
// the inbox still reads correctly if the user row is later removed (createdBy
// FK is ON DELETE SET NULL) and so the mobile field surface doesn't need a
// join to render who flagged it.
export const teamTasks = pgTable(
  'team_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdByName: text('created_by_name').notNull().default(''),

    body: text('body').notNull().default(''),
    // "(edited)" marker — null until the body is first edited.
    editedAt: timestamp('edited_at', { withTimezone: true }),
    status: teamTaskStatusEnum('status').notNull().default('open'),

    resolvedBy: uuid('resolved_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    resolvedByName: text('resolved_by_name'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    companyIdx: index('team_tasks_company_idx').on(t.companyId),
    companyStatusIdx: index('team_tasks_company_status_idx').on(
      t.companyId,
      t.status,
    ),
  }),
);

export type TeamTask = typeof teamTasks.$inferSelect;
export type NewTeamTask = typeof teamTasks.$inferInsert;

// One row per file attached to a team task. Binary lives in the
// `team-task-attachments` Supabase Storage bucket (private). storagePath is
// the bucket key; signed URLs are minted per download.
export const teamTaskAttachments = pgTable(
  'team_task_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => teamTasks.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    fileName: text('file_name').notNull(),
    originalFileName: text('original_file_name').notNull(),
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    taskIdx: index('team_task_attachments_task_idx').on(t.taskId),
    companyIdx: index('team_task_attachments_company_idx').on(t.companyId),
  }),
);

export type TeamTaskAttachment = typeof teamTaskAttachments.$inferSelect;
export type NewTeamTaskAttachment = typeof teamTaskAttachments.$inferInsert;

// Threaded replies under a note — the follow-up answer or discussion a note
// often needs beyond open/done. Same name-snapshot convention as the task.
export const teamTaskReplies = pgTable(
  'team_task_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => teamTasks.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdByName: text('created_by_name').notNull().default(''),
    body: text('body').notNull().default(''),
    // "(edited)" marker — null until the body is first edited.
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    taskIdx: index('team_task_replies_task_idx').on(t.taskId),
    companyIdx: index('team_task_replies_company_idx').on(t.companyId),
  }),
);

export type TeamTaskReply = typeof teamTaskReplies.$inferSelect;
export type NewTeamTaskReply = typeof teamTaskReplies.$inferInsert;
