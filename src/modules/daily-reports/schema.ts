import { z } from 'zod';

export const dailyReportStatusValues = [
  'draft',
  'complete',
  'exported',
  'sent_to_client',
  'void',
] as const;
export type DailyReportStatus = (typeof dailyReportStatusValues)[number];

export const STATUS_LABEL: Record<DailyReportStatus, string> = {
  draft: 'Draft',
  complete: 'Complete',
  exported: 'Exported',
  sent_to_client: 'Sent to Client',
  void: 'Void',
};

export const STATUS_TONE: Record<
  DailyReportStatus,
  'slate' | 'blue' | 'amber' | 'green' | 'red'
> = {
  draft: 'slate',
  complete: 'blue',
  exported: 'amber',
  sent_to_client: 'green',
  void: 'red',
};

export const photoCategoryValues = [
  'progress',
  'safety',
  'issue',
  'delivery',
  'inspection',
  'weather',
  'other',
] as const;
export type PhotoCategory = (typeof photoCategoryValues)[number];

export const PHOTO_CATEGORY_LABEL: Record<PhotoCategory, string> = {
  progress: 'Progress',
  safety: 'Safety',
  issue: 'Issue',
  delivery: 'Delivery',
  inspection: 'Inspection',
  weather: 'Weather',
  other: 'Other',
};

// Manpower row schema. company_crew + trade are free text; worker_count is
// a non-negative integer; hours is non-negative decimal stored as string for
// drizzle's numeric() compatibility.
export const manpowerRowSchema = z.object({
  companyCrew: z.string().trim().max(200).optional().default(''),
  trade: z.string().trim().max(200).optional().default(''),
  workerCount: z.coerce.number().int().min(0).max(9999).default(0),
  hours: z.coerce.number().min(0).max(9999).default(0),
  notes: z.string().trim().max(2000).optional().default(''),
});

export type ManpowerRow = z.infer<typeof manpowerRowSchema>;

export const manpowerListSchema = z.array(manpowerRowSchema).max(50);

// The main report form schema. Most fields are optional free text so the
// form is permissive — operators fill what they have without being blocked.
export const dailyReportFormSchema = z.object({
  reportDate: z
    .string()
    .min(1, 'Date is required')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  status: z.enum(dailyReportStatusValues).default('draft'),

  weatherCondition: z.string().trim().max(200).optional().default(''),
  weatherTemperatureF: z.string().trim().max(20).optional().default(''),
  weatherPrecipitation: z.string().trim().max(200).optional().default(''),
  weatherWind: z.string().trim().max(200).optional().default(''),
  weatherHumidity: z.string().trim().max(200).optional().default(''),
  weatherSource: z.enum(['manual', 'auto']).default('manual'),

  siteConditions: z.string().trim().max(2000).optional().default(''),
  crewCompanyName: z.string().trim().max(200).optional().default(''),
  foremanName: z.string().trim().max(200).optional().default(''),

  workPerformed: z.string().trim().max(8000).optional().default(''),
  materialsDelivered: z.string().trim().max(4000).optional().default(''),
  equipmentOnSite: z.string().trim().max(4000).optional().default(''),
  inspections: z.string().trim().max(4000).optional().default(''),
  delays: z.string().trim().max(4000).optional().default(''),
  safetyIncidents: z.string().trim().max(4000).optional().default(''),
  visitorsOnSite: z.string().trim().max(4000).optional().default(''),
  issuesConcerns: z.string().trim().max(4000).optional().default(''),
  tomorrowPlan: z.string().trim().max(4000).optional().default(''),
  internalNotes: z.string().trim().max(8000).optional().default(''),
  clientNotes: z.string().trim().max(8000).optional().default(''),

  preparedByName: z.string().trim().max(200).optional().default(''),

  includeWeatherInExport: z.coerce.boolean().default(true),
  includeManpowerInExport: z.coerce.boolean().default(true),
  includeWorkInExport: z.coerce.boolean().default(true),
  includeMaterialsInExport: z.coerce.boolean().default(true),
  includeEquipmentInExport: z.coerce.boolean().default(true),
  includeDelaysInExport: z.coerce.boolean().default(true),
  includeSafetyInExport: z.coerce.boolean().default(true),
  includeIssuesInExport: z.coerce.boolean().default(false),
  includePhotosInExport: z.coerce.boolean().default(true),
  includeClientNotesInExport: z.coerce.boolean().default(true),

  manpowerJson: z.string().optional().default('[]'),
});

export type DailyReportFormInput = z.infer<typeof dailyReportFormSchema>;
