'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import {
  createInvoiceTemplate,
  setDefaultInvoiceTemplate,
  updateInvoiceTemplate,
} from '@/lib/data/invoice-templates';
import { invoiceTemplateFormSchema } from './schema';

export type CreateInvoiceTemplateState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function readForm(formData: FormData) {
  return {
    name: formData.get('name'),
    description: formData.get('description') ?? '',
    isDefault: formData.get('isDefault') ?? '',

    // Existing toggles
    showCompanyBranding: formData.get('showCompanyBranding') ?? '',
    showHeader: formData.get('showHeader') ?? '',
    showLineItems: formData.get('showLineItems') ?? '',
    showPaymentTerms: formData.get('showPaymentTerms') ?? '',
    showRetainage: formData.get('showRetainage') ?? '',
    showTaxVat: formData.get('showTaxVat') ?? '',
    showNotes: formData.get('showNotes') ?? '',
    showSignature: formData.get('showSignature') ?? '',
    showFooter: formData.get('showFooter') ?? '',
    headerLayout: formData.get('headerLayout') ?? 'standard',
    lineItemLayout: formData.get('lineItemLayout') ?? 'detailed',
    headerNote: formData.get('headerNote') ?? '',
    paymentTermsText: formData.get('paymentTermsText') ?? '',
    retainageText: formData.get('retainageText') ?? '',
    notesText: formData.get('notesText') ?? '',
    footerText: formData.get('footerText') ?? '',

    // Phase 1 additions
    titleOverride: formData.get('titleOverride') ?? '',
    tinLabel: formData.get('tinLabel') ?? '',
    issuedByLabel: formData.get('issuedByLabel') ?? '',
    showBillToTin: formData.get('showBillToTin') ?? '',
    billToAttentionLabel: formData.get('billToAttentionLabel') ?? '',
    showProjectMetadata: formData.get('showProjectMetadata') ?? '',
    poNumberLabel: formData.get('poNumberLabel') ?? '',
    billingNumberLabel: formData.get('billingNumberLabel') ?? '',
    projectDescriptionLabel: formData.get('projectDescriptionLabel') ?? '',
    showWireInstructions: formData.get('showWireInstructions') ?? '',
    wireInstructionsNote: formData.get('wireInstructionsNote') ?? '',
    showQualifications: formData.get('showQualifications') ?? '',
    qualificationsText: formData.get('qualificationsText') ?? '',
    showAccountHistory: formData.get('showAccountHistory') ?? '',
    accountHistoryLabel: formData.get('accountHistoryLabel') ?? '',
    showProgressBilling: formData.get('showProgressBilling') ?? '',
    progressBillingLabel: formData.get('progressBillingLabel') ?? '',
    contractValueLabel: formData.get('contractValueLabel') ?? '',
    changeOrdersLabel: formData.get('changeOrdersLabel') ?? '',
    priorBilledLabel: formData.get('priorBilledLabel') ?? '',
    retainageHeldLabel: formData.get('retainageHeldLabel') ?? '',
    vatLabel: formData.get('vatLabel') ?? '',
    vatRatePercent: formData.get('vatRatePercent') ?? '',
  };
}

/** Map a parsed form value back to the column form: empty string → null OR
 * empty string → "Default Label". Used for the new label-override columns. */
function labelOrDefault(
  value: string | undefined,
  fallback: string,
): string {
  const v = (value ?? '').trim();
  return v === '' ? fallback : v;
}

export async function createInvoiceTemplateAction(
  _prev: CreateInvoiceTemplateState,
  formData: FormData,
): Promise<CreateInvoiceTemplateState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invoice_templates')) {
    return { formError: 'Not allowed to create invoice templates.' };
  }

  const parsed = invoiceTemplateFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  let createdId: string;
  try {
    const tpl = await createInvoiceTemplate(companyId, {
      // Existing fields
      name: data.name,
      description: emptyToNull(data.description ?? null),
      isDefault: data.isDefault,
      showCompanyBranding: data.showCompanyBranding,
      showHeader: data.showHeader,
      showLineItems: data.showLineItems,
      showPaymentTerms: data.showPaymentTerms,
      showRetainage: data.showRetainage,
      showTaxVat: data.showTaxVat,
      showNotes: data.showNotes,
      showSignature: data.showSignature,
      showFooter: data.showFooter,
      headerLayout: data.headerLayout,
      lineItemLayout: data.lineItemLayout,
      headerNote: emptyToNull(data.headerNote ?? null),
      paymentTermsText: emptyToNull(data.paymentTermsText ?? null),
      retainageText: emptyToNull(data.retainageText ?? null),
      notesText: emptyToNull(data.notesText ?? null),
      footerText: emptyToNull(data.footerText ?? null),

      // Phase 1 additions — labels fall back to column-level defaults via
      // labelOrDefault, free-text fields stay null when empty.
      titleOverride: emptyToNull(data.titleOverride ?? null),
      tinLabel: labelOrDefault(data.tinLabel, 'TIN'),
      issuedByLabel: labelOrDefault(data.issuedByLabel, 'Issued by'),
      showBillToTin: data.showBillToTin,
      billToAttentionLabel: labelOrDefault(
        data.billToAttentionLabel,
        'Attention',
      ),
      showProjectMetadata: data.showProjectMetadata,
      poNumberLabel: labelOrDefault(data.poNumberLabel, 'Purchase Order'),
      billingNumberLabel: labelOrDefault(data.billingNumberLabel, 'Billing #'),
      projectDescriptionLabel: labelOrDefault(
        data.projectDescriptionLabel,
        'Project description',
      ),
      showWireInstructions: data.showWireInstructions,
      wireInstructionsNote: emptyToNull(data.wireInstructionsNote ?? null),
      showQualifications: data.showQualifications,
      qualificationsText: emptyToNull(data.qualificationsText ?? null),
      showAccountHistory: data.showAccountHistory,
      accountHistoryLabel: labelOrDefault(
        data.accountHistoryLabel,
        'Account history',
      ),
      showProgressBilling: data.showProgressBilling,
      progressBillingLabel: labelOrDefault(
        data.progressBillingLabel,
        'Progress billing',
      ),
      contractValueLabel: labelOrDefault(
        data.contractValueLabel,
        'Total contract value',
      ),
      changeOrdersLabel: labelOrDefault(
        data.changeOrdersLabel,
        'Approved change orders',
      ),
      priorBilledLabel: labelOrDefault(
        data.priorBilledLabel,
        'Less previously billed',
      ),
      retainageHeldLabel: labelOrDefault(
        data.retainageHeldLabel,
        'Less retainage',
      ),
      vatLabel: labelOrDefault(data.vatLabel, 'VAT'),
      vatRatePercent: data.vatRatePercent,
    });
    createdId = tpl.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create template: ${message}` };
  }

  revalidatePath('/invoice-templates');
  redirect(`/invoice-templates/${createdId}`);
}

// ---------------------------------------------------------------------------
// Update — same schema as create. Id is bound via .bind() in the form.
// ---------------------------------------------------------------------------

export async function updateInvoiceTemplateAction(
  templateId: string,
  _prev: CreateInvoiceTemplateState,
  formData: FormData,
): Promise<CreateInvoiceTemplateState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invoice_templates')) {
    return { formError: 'Not allowed to edit invoice templates.' };
  }

  const parsed = invoiceTemplateFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  try {
    const out = await updateInvoiceTemplate(companyId, templateId, {
      name: data.name,
      description: emptyToNull(data.description ?? null),
      isDefault: data.isDefault,
      showCompanyBranding: data.showCompanyBranding,
      showHeader: data.showHeader,
      showLineItems: data.showLineItems,
      showPaymentTerms: data.showPaymentTerms,
      showRetainage: data.showRetainage,
      showTaxVat: data.showTaxVat,
      showNotes: data.showNotes,
      showSignature: data.showSignature,
      showFooter: data.showFooter,
      headerLayout: data.headerLayout,
      lineItemLayout: data.lineItemLayout,
      headerNote: emptyToNull(data.headerNote ?? null),
      paymentTermsText: emptyToNull(data.paymentTermsText ?? null),
      retainageText: emptyToNull(data.retainageText ?? null),
      notesText: emptyToNull(data.notesText ?? null),
      footerText: emptyToNull(data.footerText ?? null),
      titleOverride: emptyToNull(data.titleOverride ?? null),
      tinLabel: labelOrDefault(data.tinLabel, 'TIN'),
      issuedByLabel: labelOrDefault(data.issuedByLabel, 'Issued by'),
      showBillToTin: data.showBillToTin,
      billToAttentionLabel: labelOrDefault(data.billToAttentionLabel, 'Attention'),
      showProjectMetadata: data.showProjectMetadata,
      poNumberLabel: labelOrDefault(data.poNumberLabel, 'Purchase Order'),
      billingNumberLabel: labelOrDefault(data.billingNumberLabel, 'Billing #'),
      projectDescriptionLabel: labelOrDefault(
        data.projectDescriptionLabel,
        'Project description',
      ),
      showWireInstructions: data.showWireInstructions,
      wireInstructionsNote: emptyToNull(data.wireInstructionsNote ?? null),
      showQualifications: data.showQualifications,
      qualificationsText: emptyToNull(data.qualificationsText ?? null),
      showAccountHistory: data.showAccountHistory,
      accountHistoryLabel: labelOrDefault(data.accountHistoryLabel, 'Account history'),
      showProgressBilling: data.showProgressBilling,
      progressBillingLabel: labelOrDefault(data.progressBillingLabel, 'Progress billing'),
      contractValueLabel: labelOrDefault(data.contractValueLabel, 'Total contract value'),
      changeOrdersLabel: labelOrDefault(data.changeOrdersLabel, 'Approved change orders'),
      priorBilledLabel: labelOrDefault(data.priorBilledLabel, 'Less previously billed'),
      retainageHeldLabel: labelOrDefault(data.retainageHeldLabel, 'Less retainage'),
      vatLabel: labelOrDefault(data.vatLabel, 'VAT'),
      vatRatePercent: data.vatRatePercent,
    });
    if (!out) {
      return { formError: 'Template not found, or editing is not available in demo mode.' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save template: ${message}` };
  }

  revalidatePath('/invoice-templates');
  revalidatePath(`/invoice-templates/${templateId}`);
  redirect(`/invoice-templates/${templateId}`);
}

// ---------------------------------------------------------------------------
// Make-default action — single-button click to flip which template is the
// company's default. Clears the flag on every other template.
// ---------------------------------------------------------------------------

export type SetDefaultTemplateState = { formError?: string; ok?: boolean };

export async function setDefaultInvoiceTemplateAction(
  templateId: string,
  _prev: SetDefaultTemplateState,
  _formData: FormData,
): Promise<SetDefaultTemplateState> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'invoice_templates')) {
    return { formError: 'Not allowed to change the default template.' };
  }
  const companyId = await getActiveCompanyId();
  try {
    const out = await setDefaultInvoiceTemplate(companyId, templateId);
    if (!out) {
      return {
        formError:
          'Template not found, or default-template changes are not available in demo mode.',
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to update default: ${message}` };
  }
  revalidatePath('/invoice-templates');
  revalidatePath(`/invoice-templates/${templateId}`);
  return { ok: true };
}
