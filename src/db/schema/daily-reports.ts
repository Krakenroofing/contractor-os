import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  integer,
  date,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies';
import { projects } from './projects';
import { users } from './users';
import {
  dailyReportStatusEnum,
  dailyReportPhotoCategoryEnum,
} from './_enums';

export const dailyReports = pgTable(
  'daily_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedBy: uuid('updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    reportDate: date('report_date').notNull(),
    status: dailyReportStatusEnum('status').notNull().default('draft'),

    projectNameSnapshot: text('project_name_snapshot'),
    projectLocationSnapshot: text('project_location_snapshot'),

    weatherCondition: text('weather_condition'),
    weatherTemperatureF: numeric('weather_temperature_f', { precision: 5, scale: 1 }),
    weatherPrecipitation: text('weather_precipitation'),
    weatherWind: text('weather_wind'),
    weatherHumidity: text('weather_humidity'),
    weatherSource: text('weather_source').notNull().default('manual'),
    weatherObservedAt: timestamp('weather_observed_at', { withTimezone: true }),

    siteConditions: text('site_conditions'),
    menOnSite: integer('men_on_site').notNull().default(0),
    crewCompanyName: text('crew_company_name'),
    foremanName: text('foreman_name'),

    workPerformed: text('work_performed'),
    materialsDelivered: text('materials_delivered'),
    equipmentOnSite: text('equipment_on_site'),
    inspections: text('inspections'),
    delays: text('delays'),
    safetyIncidents: text('safety_incidents'),
    visitorsOnSite: text('visitors_on_site'),
    issuesConcerns: text('issues_concerns'),
    tomorrowPlan: text('tomorrow_plan'),
    internalNotes: text('internal_notes'),
    clientNotes: text('client_notes'),

    includeWeatherInExport: boolean('include_weather_in_export').notNull().default(true),
    includeManpowerInExport: boolean('include_manpower_in_export').notNull().default(true),
    includeWorkInExport: boolean('include_work_in_export').notNull().default(true),
    includeMaterialsInExport: boolean('include_materials_in_export').notNull().default(true),
    includeEquipmentInExport: boolean('include_equipment_in_export').notNull().default(true),
    includeDelaysInExport: boolean('include_delays_in_export').notNull().default(true),
    includeSafetyInExport: boolean('include_safety_in_export').notNull().default(true),
    includeIssuesInExport: boolean('include_issues_in_export').notNull().default(false),
    includePhotosInExport: boolean('include_photos_in_export').notNull().default(true),
    includeClientNotesInExport: boolean('include_client_notes_in_export').notNull().default(true),

    preparedByName: text('prepared_by_name'),

    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('daily_reports_company_idx').on(t.companyId),
    projectIdx: index('daily_reports_project_idx').on(t.projectId),
    dateIdx: index('daily_reports_date_idx').on(t.reportDate),
    // Partial unique index — voided / soft-deleted rows are excluded so an
    // operator can void a mistaken report and re-create one for the same
    // (project, date). Matches the SQL migration's partial index.
    projectDateUniq: uniqueIndex('daily_reports_project_date_uniq')
      .on(t.projectId, t.reportDate)
      .where(sql`${t.deletedAt} IS NULL AND ${t.status} <> 'void'`),
  }),
);

export const dailyReportManpower = pgTable(
  'daily_report_manpower',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dailyReportId: uuid('daily_report_id')
      .notNull()
      .references(() => dailyReports.id, { onDelete: 'cascade' }),
    companyCrew: text('company_crew'),
    trade: text('trade'),
    workerCount: integer('worker_count').notNull().default(0),
    hours: numeric('hours', { precision: 6, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    reportIdx: index('daily_report_manpower_report_idx').on(t.dailyReportId),
  }),
);

export const dailyReportPhotos = pgTable(
  'daily_report_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dailyReportId: uuid('daily_report_id')
      .notNull()
      .references(() => dailyReports.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    storagePath: text('storage_path').notNull(),
    fileName: text('file_name'),
    mimeType: text('mime_type'),
    byteSize: integer('byte_size'),
    caption: text('caption'),
    category: dailyReportPhotoCategoryEnum('category').notNull().default('progress'),
    visibleToClient: boolean('visible_to_client').notNull().default(true),
    uploadedBy: uuid('uploaded_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    reportIdx: index('daily_report_photos_report_idx').on(t.dailyReportId),
    projectIdx: index('daily_report_photos_project_idx').on(t.projectId),
  }),
);

export type DailyReport = typeof dailyReports.$inferSelect;
export type NewDailyReport = typeof dailyReports.$inferInsert;
export type DailyReportManpower = typeof dailyReportManpower.$inferSelect;
export type NewDailyReportManpower = typeof dailyReportManpower.$inferInsert;
export type DailyReportPhoto = typeof dailyReportPhotos.$inferSelect;
export type NewDailyReportPhoto = typeof dailyReportPhotos.$inferInsert;
