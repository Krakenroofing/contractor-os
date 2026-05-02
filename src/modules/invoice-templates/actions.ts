'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { createInvoiceTemplate } from '@/lib/data/invoice-templates';
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

export async function createInvoiceTemplateAction(
  _prev: CreateInvoiceTemplateState,
  formData: FormData,
): Promise<CreateInvoiceTemplateState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'invoice_templates')) {
    return { formError: 'Not allowed to create invoice templates.' };
  }

  const parsed = invoiceTemplateFormSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description') ?? '',
    isDefault: formData.get('isDefault') ?? '',
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
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  let createdId: string;
  try {
    const tpl = await createInvoiceTemplate(companyId, {
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
    });
    createdId = tpl.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create template: ${message}` };
  }

  revalidatePath('/invoice-templates');
  redirect(`/invoice-templates/${createdId}`);
}
