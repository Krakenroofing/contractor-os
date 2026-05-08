import 'server-only';
import {
  getInvoice,
  getInvoiceLineItems,
  listInvoicesForProject,
} from '@/lib/data/invoices';
import { getInvoiceTemplate } from '@/lib/data/invoice-templates';
import { getProject } from '@/lib/data/projects';
import { getCustomer } from '@/lib/data/customers';
import { getActiveCompany } from '@/lib/active-company';
import { parseMoney, subtract } from '@/lib/money';
import type {
  DocumentPayload,
  DocumentTotalsRow,
  DocumentSection,
  DocumentMeta,
} from '@/lib/exports/types';
import { BILLING_TYPE_LABEL } from '@/modules/invoices/schema';

export async function buildInvoicePayload(
  companyId: string,
  invoiceId: string,
): Promise<DocumentPayload | null> {
  const invoice = await getInvoice(companyId, invoiceId);
  if (!invoice) return null;

  const company = await getActiveCompany();
  const project = await getProject(companyId, invoice.projectId);
  const customer = project
    ? await getCustomer(companyId, project.customerId)
    : undefined;
  const template = invoice.templateId
    ? await getInvoiceTemplate(companyId, invoice.templateId)
    : undefined;
  const lines = await getInvoiceLineItems(invoice.id);

  const subtotal = parseMoney(invoice.subtotal);
  const total = parseMoney(invoice.total);
  const balance = subtract(total, parseMoney(invoice.amountPaid));

  const vatRatePct = template ? Number(template.vatRatePercent) : 0;
  const vatAmount =
    vatRatePct > 0
      ? (subtotal * vatRatePct) / 100
      : parseMoney(invoice.taxAmount);

  const title =
    template?.titleOverride && template.titleOverride.trim() !== ''
      ? template.titleOverride
      : 'Invoice';

  const meta: DocumentMeta[] = [
    { label: 'Invoice #', value: invoice.number },
    { label: 'Invoice date', value: invoice.invoiceDate },
  ];
  if (invoice.dueDate) meta.push({ label: 'Due date', value: invoice.dueDate });
  meta.push({
    label: 'Billing type',
    value: BILLING_TYPE_LABEL[invoice.billingType],
  });
  if (invoice.purchaseOrderNumber) {
    meta.push({
      label: template?.poNumberLabel ?? 'PO #',
      value: invoice.purchaseOrderNumber,
    });
  }
  if (invoice.billingLabel) {
    meta.push({
      label: template?.billingNumberLabel ?? 'Billing #',
      value: invoice.billingLabel,
    });
  }

  const totals: DocumentTotalsRow[] = [
    { label: 'Subtotal', value: subtotal },
  ];
  if (template ? template.showTaxVat : true) {
    const vatLabel =
      vatRatePct > 0
        ? `${template?.vatLabel ?? 'VAT'} (${vatRatePct.toFixed(2)}%)`
        : (template?.vatLabel ?? 'Tax / VAT');
    totals.push({ label: vatLabel, value: vatAmount });
  }
  if (
    (template ? template.showRetainage : true) &&
    Number(invoice.retainageAmount) > 0
  ) {
    totals.push({
      label: `${template?.retainageHeldLabel ?? 'Retainage held'} (${Number(invoice.retainagePercent).toFixed(2)}%)`,
      value: parseMoney(invoice.retainageAmount),
      negative: true,
    });
  }
  totals.push({ label: 'Net amount due', value: total, bold: true });
  totals.push({ label: 'Amount paid', value: parseMoney(invoice.amountPaid) });
  totals.push({ label: 'Balance due', value: balance, bold: true });

  const sections: DocumentSection[] = [];
  if (
    (template ? template.showQualifications : false) &&
    template?.qualificationsText
  ) {
    sections.push({
      title: 'Qualifications & exclusions',
      body: template.qualificationsText,
    });
  }
  if (
    (template ? template.showRetainage : true) &&
    template?.retainageText
  ) {
    sections.push({ title: 'Retainage', body: template.retainageText });
  }
  if (
    (template ? template.showPaymentTerms : true) &&
    (invoice.termsOverride || template?.paymentTermsText)
  ) {
    sections.push({
      title: 'Payment terms',
      body: invoice.termsOverride || template?.paymentTermsText || '',
    });
  }
  if (
    (template ? template.showNotes : true) &&
    (invoice.notes || template?.notesText)
  ) {
    sections.push({
      title: 'Notes',
      body: invoice.notes || template?.notesText || '',
    });
  }

  return {
    type: 'invoice',
    title,
    number: invoice.number,
    statusLabel: invoice.status,
    company: companyToInfo(company),
    customer: customer
      ? {
          name: customer.name,
          contact: customer.primaryContactName,
          email: customer.email,
          phone: customer.phone,
        }
      : undefined,
    project: project
      ? {
          name: project.name,
          number: project.number,
          description: project.notes,
        }
      : undefined,
    meta,
    lines: lines.map((l) => ({
      description: l.description,
      unit: l.unit,
      quantity: Number(l.quantity),
      unitCost: Number(l.unitCost),
      lineTotal: Number(l.lineTotal),
    })),
    totals,
    sections,
    footerNote: template?.footerText ?? null,
  };
}

function companyToInfo(company: Awaited<ReturnType<typeof getActiveCompany>>) {
  return {
    name: company.name,
    email: company.email,
    phone: company.phone,
    website: company.website,
    licenseNumber: company.licenseNumber,
    addressLine1: company.addressLine1,
    city: company.city,
    state: company.state,
    postalCode: company.postalCode,
    tinNumber: company.tinNumber,
    defaultCurrency: company.defaultCurrency,
  };
}
