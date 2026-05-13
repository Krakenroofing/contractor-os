// Async data accessor for invoice templates (dual-backend: Postgres or mock store).

import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { invoiceTemplates, type InvoiceTemplate } from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  listMockInvoiceTemplates as mockList,
  getMockInvoiceTemplate as mockGet,
  createMockInvoiceTemplate as mockCreate,
} from '@/lib/mock-store';

// All InvoiceTemplate fields except id/companyId/timestamps. The Phase 1
// additions (header overrides, banking section toggles, progress-billing
// labels, VAT row config, etc.) are accepted as optional so the existing
// create action keeps working unchanged — defaults defined on the column
// in src/db/schema/invoice-templates.ts apply when omitted.
type FullInput = Omit<
  InvoiceTemplate,
  'id' | 'companyId' | 'createdAt' | 'updatedAt'
>;
type Phase1Optional =
  | 'titleOverride'
  | 'tinLabel'
  | 'issuedByLabel'
  | 'showBillToTin'
  | 'billToAttentionLabel'
  | 'showProjectMetadata'
  | 'poNumberLabel'
  | 'billingNumberLabel'
  | 'projectDescriptionLabel'
  | 'showWireInstructions'
  | 'wireInstructionsNote'
  | 'showQualifications'
  | 'qualificationsText'
  | 'showAccountHistory'
  | 'accountHistoryLabel'
  | 'showProgressBilling'
  | 'progressBillingLabel'
  | 'contractValueLabel'
  | 'changeOrdersLabel'
  | 'priorBilledLabel'
  | 'retainageHeldLabel'
  | 'vatLabel'
  | 'vatRatePercent';
export type CreateInvoiceTemplateInput =
  Omit<FullInput, Phase1Optional> & Partial<Pick<FullInput, Phase1Optional>>;

export async function listInvoiceTemplates(
  companyId: string,
): Promise<InvoiceTemplate[]> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    return await db
      .select()
      .from(invoiceTemplates)
      .where(eq(invoiceTemplates.companyId, companyId))
      .orderBy(asc(invoiceTemplates.name));
  }
  return mockList(companyId);
}

export async function getInvoiceTemplate(
  companyId: string,
  id: string,
): Promise<InvoiceTemplate | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(invoiceTemplates)
      .where(
        and(
          eq(invoiceTemplates.id, id),
          eq(invoiceTemplates.companyId, companyId),
        ),
      )
      .limit(1);
    return rows[0];
  }
  return mockGet(companyId, id);
}

// Default values for Phase 1 columns when the caller doesn't supply them.
// Keep aligned with the column-level defaults declared in
// src/db/schema/invoice-templates.ts so create-via-DB and create-via-mock
// produce identical rows.
const PHASE1_DEFAULTS = {
  titleOverride: null,
  tinLabel: 'TIN',
  issuedByLabel: 'Issued by',
  showBillToTin: false,
  billToAttentionLabel: 'Attention',
  showProjectMetadata: true,
  poNumberLabel: 'Purchase Order',
  billingNumberLabel: 'Billing #',
  projectDescriptionLabel: 'Project description',
  showWireInstructions: false,
  wireInstructionsNote: null,
  showQualifications: false,
  qualificationsText: null,
  showAccountHistory: false,
  accountHistoryLabel: 'Account history',
  showProgressBilling: false,
  progressBillingLabel: 'Progress billing',
  contractValueLabel: 'Total contract value',
  changeOrdersLabel: 'Approved change orders',
  priorBilledLabel: 'Less previously billed',
  retainageHeldLabel: 'Less retainage',
  vatLabel: 'VAT',
  vatRatePercent: '0',
} as const satisfies Pick<FullInput, Phase1Optional>;

export async function createInvoiceTemplate(
  companyId: string,
  input: CreateInvoiceTemplateInput,
): Promise<InvoiceTemplate> {
  const filled: FullInput = { ...PHASE1_DEFAULTS, ...input };
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    // If this template is being created as the default, clear isDefault on
    // any existing templates first so the company has exactly one default.
    if (filled.isDefault) {
      await db
        .update(invoiceTemplates)
        .set({ isDefault: false })
        .where(eq(invoiceTemplates.companyId, companyId));
    }
    const inserted = await db
      .insert(invoiceTemplates)
      .values({ ...filled, companyId })
      .returning();
    return inserted[0];
  }
  return mockCreate(companyId, filled);
}

export type UpdateInvoiceTemplateInput = Partial<FullInput>;

export async function updateInvoiceTemplate(
  companyId: string,
  id: string,
  patch: UpdateInvoiceTemplateInput,
): Promise<InvoiceTemplate | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    // If this update flips isDefault to true, clear the flag on every
    // other template in the same company first — one default per company.
    if (patch.isDefault) {
      await db
        .update(invoiceTemplates)
        .set({ isDefault: false })
        .where(eq(invoiceTemplates.companyId, companyId));
    }
    const updated = await db
      .update(invoiceTemplates)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(invoiceTemplates.id, id),
          eq(invoiceTemplates.companyId, companyId),
        ),
      )
      .returning();
    return updated[0];
  }
  // Demo mode: no in-memory update path (yet). Returning undefined lets the
  // action layer surface a clean "not available in demo" message.
  return undefined;
}

/**
 * Flip the default-template flag to point at `templateId`. Clears the flag
 * on every other template in the company. Atomic-ish (two UPDATEs).
 */
export async function setDefaultInvoiceTemplate(
  companyId: string,
  templateId: string,
): Promise<InvoiceTemplate | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    // Clear default on all of the company's templates.
    await db
      .update(invoiceTemplates)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(invoiceTemplates.companyId, companyId));
    // Set default on the target.
    const updated = await db
      .update(invoiceTemplates)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(
        and(
          eq(invoiceTemplates.id, templateId),
          eq(invoiceTemplates.companyId, companyId),
        ),
      )
      .returning();
    return updated[0];
  }
  return undefined;
}

/**
 * Returns the company's default template, or undefined if none is marked
 * default. Used by createInvoiceAction to auto-attach the default when the
 * user leaves the dropdown on "— Default —".
 */
export async function getDefaultInvoiceTemplate(
  companyId: string,
): Promise<InvoiceTemplate | undefined> {
  if (isDatabaseConfigured()) {
    const db = getDb()!;
    const rows = await db
      .select()
      .from(invoiceTemplates)
      .where(
        and(
          eq(invoiceTemplates.companyId, companyId),
          eq(invoiceTemplates.isDefault, true),
        ),
      )
      .limit(1);
    return rows[0];
  }
  const all = mockList(companyId);
  return all.find((t) => t.isDefault);
}
