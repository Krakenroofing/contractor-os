import 'server-only';
import {
  getInvoice,
  getInvoiceLineItems,
  listInvoicesForProject,
} from '@/lib/data/invoices';
import { listChangeOrders } from '@/lib/data/change-orders';
import { getInvoiceTemplate } from '@/lib/data/invoice-templates';
import { getProject } from '@/lib/data/projects';
import { getCustomer } from '@/lib/data/customers';
import { getActiveCompany } from '@/lib/active-company';
import { buildCompanyInfo } from '@/lib/exports/data/company-info';
import { add, parseMoney, subtract } from '@/lib/money';
import { normalizeStatus } from '@/lib/status-machine';
import type {
  DocumentPayload,
  DocumentTotalsRow,
  DocumentSection,
  DocumentMeta,
  DocumentDataTable,
  DocumentSignatureBlock,
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

  // Invoice # / date / due date / billing type always render — they're
  // identity, not metadata. The `showProjectMetadata` flag only gates the
  // PO # / Billing # rows since those are owner-controlled fields.
  const meta: DocumentMeta[] = [
    { label: 'Invoice #', value: invoice.number },
    { label: 'Invoice date', value: invoice.invoiceDate },
  ];
  if (invoice.dueDate) meta.push({ label: 'Due date', value: invoice.dueDate });
  meta.push({
    label: 'Billing type',
    value: BILLING_TYPE_LABEL[invoice.billingType],
  });
  const showProjectMetadata = template ? template.showProjectMetadata : true;
  if (showProjectMetadata && invoice.purchaseOrderNumber) {
    meta.push({
      label: template?.poNumberLabel ?? 'PO #',
      value: invoice.purchaseOrderNumber,
    });
  }
  if (showProjectMetadata && invoice.billingLabel) {
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
    (template ? template.showWireInstructions : false) &&
    template?.wireInstructionsNote
  ) {
    sections.push({
      title: 'Wire / payment instructions',
      body: template.wireInstructionsNote,
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

  // showBillToTin gates whether the customer's TIN renders in the bill-to
  // block. Other customer fields (name, address) always render — they're
  // not a privacy/policy decision the template should own.
  const showBillToTin = template ? template.showBillToTin : false;
  // showLineItems hides the entire line items table — useful for templates
  // that only show a totals summary (lump-sum draws, retainage releases).
  const showLineItems = template ? template.showLineItems : true;
  // showFooter gates the footer note. When off, no footer text appears
  // even if the template has a body.
  const showFooter = template ? template.showFooter : true;
  // showCompanyHeader gates the whole top strip (logo + name + title row).
  // True unless BOTH branding and header are explicitly off — letting a
  // template suppress one but not the other was confusing in testing.
  const showCompanyHeader = template
    ? template.showCompanyBranding || template.showHeader
    : true;

  // ---- Progress billing summary table ----
  // Builds a small structured table (contract value, approved COs, prior
  // billed, this invoice, retainage) so the recipient sees the financial
  // arc of the project, not just this single invoice.
  const dataTables: DocumentDataTable[] = [];
  if (template?.showProgressBilling && project) {
    const projectCOs = await listChangeOrders(companyId);
    const approvedCOTotal = projectCOs
      .filter(
        (co) =>
          co.projectId === invoice.projectId &&
          normalizeStatus('change_order', co.status) === 'approved',
      )
      .reduce((acc, co) => add(acc, parseMoney(co.total)), 0);
    const originalContract = parseMoney(project.originalContractValue);
    const revisedContract = add(originalContract, approvedCOTotal);

    const priorInvoices = (await listInvoicesForProject(invoice.projectId))
      .filter((i) => i.id !== invoice.id)
      .filter((i) => normalizeStatus('invoice', i.status) !== 'void');
    const priorBilled = priorInvoices.reduce(
      (acc, i) => add(acc, parseMoney(i.subtotal)),
      0,
    );
    const retainageHeldNow = parseMoney(invoice.retainageAmount);

    const fmtRow = (label: string, amount: number, negative = false): string[] => [
      label,
      `${negative ? '(' : ''}${amount.toFixed(2)}${negative ? ')' : ''}`,
    ];

    dataTables.push({
      title: template.progressBillingLabel || 'Progress billing summary',
      columns: [
        { label: 'Item', align: 'left', widthPct: 70 },
        { label: 'Amount', align: 'right', widthPct: 30 },
      ],
      rows: [
        fmtRow(
          template.contractValueLabel || 'Total contract value',
          originalContract,
        ),
        fmtRow(
          template.changeOrdersLabel || 'Approved change orders',
          approvedCOTotal,
        ),
        fmtRow('Revised contract', revisedContract),
        fmtRow(
          template.priorBilledLabel || 'Less previously billed',
          priorBilled,
          true,
        ),
        fmtRow('This invoice (subtotal)', subtotal),
        ...(retainageHeldNow > 0
          ? [
              fmtRow(
                template.retainageHeldLabel || 'Less retainage held',
                retainageHeldNow,
                true,
              ),
            ]
          : []),
        fmtRow('Balance to bill', subtract(revisedContract, add(priorBilled, subtotal))),
      ],
    });
  }

  // ---- Account history (prior invoices on this project) ----
  if (template?.showAccountHistory && project) {
    const priorInvoices = (await listInvoicesForProject(invoice.projectId))
      .filter((i) => i.id !== invoice.id)
      .filter((i) => normalizeStatus('invoice', i.status) !== 'void')
      .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));
    if (priorInvoices.length > 0) {
      dataTables.push({
        title: template.accountHistoryLabel || 'Account history',
        columns: [
          { label: 'Invoice #', widthPct: 18 },
          { label: 'Date', widthPct: 18 },
          { label: 'Status', widthPct: 14 },
          { label: 'Subtotal', align: 'right', widthPct: 17 },
          { label: 'Paid', align: 'right', widthPct: 17 },
          { label: 'Balance', align: 'right', widthPct: 16 },
        ],
        rows: priorInvoices.map((i) => {
          const sub = parseMoney(i.subtotal);
          const paid = parseMoney(i.amountPaid);
          const bal = subtract(parseMoney(i.total), paid);
          return [
            i.number,
            i.invoiceDate,
            i.status,
            sub.toFixed(2),
            paid.toFixed(2),
            bal.toFixed(2),
          ];
        }),
      });
    }
  }

  // ---- Signature block ----
  const signatureBlock: DocumentSignatureBlock | null = template?.showSignature
    ? {
        label: 'Authorized signature',
      }
    : null;

  return {
    type: 'invoice',
    title,
    number: invoice.number,
    statusLabel: invoice.status,
    showCompanyHeader,
    company: {
      ...(await buildCompanyInfo(company)),
      tinLabel: template?.tinLabel ?? null,
    },
    customer: customer
      ? {
          name: customer.name,
          contact: customer.primaryContactName,
          email: customer.email,
          phone: customer.phone,
          addressLine1: customer.billingAddressLine1,
          city: customer.billingCity,
          state: customer.billingState,
          postalCode: customer.billingPostalCode,
          tinNumber: showBillToTin ? customer.tinNumber : null,
          attentionLabel: template?.billToAttentionLabel ?? null,
          tinLabel: template?.tinLabel ?? null,
        }
      : undefined,
    project: project
      ? {
          name: project.name,
          number: project.number,
          description: project.notes,
          descriptionLabel: template?.projectDescriptionLabel ?? null,
        }
      : undefined,
    meta,
    lines: showLineItems
      ? lines.map((l) => ({
          description: l.description,
          unit: l.unit,
          quantity: Number(l.quantity),
          unitCost: Number(l.unitCost),
          lineTotal: Number(l.lineTotal),
        }))
      : [],
    totals,
    sections,
    dataTables: dataTables.length > 0 ? dataTables : undefined,
    headerNote: template?.headerNote ?? null,
    signatureBlock,
    footerNote: showFooter ? (template?.footerText ?? null) : null,
  };
}

