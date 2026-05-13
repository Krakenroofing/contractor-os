import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { projects } from './projects';
import { users } from './users';
import { documentCategoryEnum } from './_enums';

// Project-level document repository. One row per uploaded file.
//
// Storage: blob bytes live in the `project-documents` Supabase Storage bucket
// (private). `storagePath` is the bucket key; signed URLs are minted per
// download. See src/lib/storage/project-documents.ts.
//
// Versioning prep: parentDocumentId + versionNumber + isCurrentVersion are
// present so Phase 3 can add "Upload new revision" without a migration. Phase
// 1 always writes parentDocumentId=null, versionNumber=1, isCurrentVersion=true.
export const projectDocuments = pgTable(
  'project_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    // Display name (user-editable). Defaults to originalFileName on upload.
    fileName: text('file_name').notNull(),
    // What the user's filesystem called it — never mutated after upload.
    originalFileName: text('original_file_name').notNull(),
    // Bucket key inside `project-documents` storage bucket.
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull().default(0),

    category: documentCategoryEnum('category').notNull().default('other'),
    description: text('description'),
    visibleToClient: boolean('visible_to_client').notNull().default(false),

    // Versioning placeholders — Phase 3 wires the UI. Self-FK uses
    // AnyPgColumn forward-ref because the column type isn't known yet at
    // table-definition time.
    parentDocumentId: uuid('parent_document_id').references(
      (): AnyPgColumn => projectDocuments.id,
      { onDelete: 'set null' },
    ),
    versionNumber: integer('version_number').notNull().default(1),
    isCurrentVersion: boolean('is_current_version').notNull().default(true),

    sortOrder: integer('sort_order').notNull().default(0),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    companyIdx: index('project_documents_company_idx').on(t.companyId),
    projectIdx: index('project_documents_project_idx').on(t.projectId),
    projectCategoryIdx: index('project_documents_project_category_idx').on(
      t.projectId,
      t.category,
    ),
    parentIdx: index('project_documents_parent_idx').on(t.parentDocumentId),
  }),
);

export type ProjectDocument = typeof projectDocuments.$inferSelect;
export type NewProjectDocument = typeof projectDocuments.$inferInsert;
