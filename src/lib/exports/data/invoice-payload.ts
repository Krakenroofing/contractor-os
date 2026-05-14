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
import { add, formatMoney, parseMoney, subtract } from '@/lib/money';
import { normalizeStatus } from '@/lib/status-machine';
import type {
  DocumentPayload,
  DocumentTotalsRow,
  DocumentSection,
  DocumentMeta,
  DocumentDataTable,
  DocumentSignatureBlock,
} from '@/lib/exports/types';

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
  const retainageAmount = parseMoney(invoice.retainageAmount);
  const netOfRetainage = subtract(subtotal, retainageAmount);
  const total = parseMoney(invoice.total);
  const balance = subtract(total, parseMoney(invoice.amountPaid));

  // Progress-billing context: when this invoice has a `percentOfContract`
  // and lives on a project with a contract value, derive the cumulative
  // billing / previously-paid / cumulative-retention rollup so we can
  // render the breakdown instead of standard line items.
  const progressPct =
    invoice.percentOfContract && Number(invoice.percentOfContract) > 0
      ? Number(invoice.percentOfContract)
      : null;
  const progressContext =
    progressPct !== null && project && parseMoney(project.contractValue) > 0
      ? await (async () => {
          const contract = parseMoney(project.contractValue);
          const allProjectInvoices = await listInvoicesForProject(project.id);
          const prior = allProjectInvoices
            .filter((i) => i.id !== invoice.id)
            .filter(
              (i) =>
                normalizeStatus('invoice', i.status) !== 'void' &&
                i.invoiceDate <= invoice.invoiceDate,
            );
          const priorNet = prior.reduce(
            (acc, i) =>
              acc +
              (parseMoney(i.subtotal) - parseMoney(i.retainageAmount)),
            0,
          );
          const cumulative = (progressPct / 100) * contract;
          const retentionPct =
            Number(invoice.retainagePercent) > 0
              ? Number(invoice.retainagePercent)
              : 0;
          const cumRetention = (retentionPct / 100) * cumulative;
          return {
            contract,
            cumulative: Math.round(cumulative * 100) / 100,
            priorNet: Math.round(priorNet * 100) / 100,
            priorCount: prior.length,
            cumRetention: Math.round(cumRetention * 100) / 100,
            retentionPct,
            billingNumber: prior.length + 1,
            pct: progressPct,
          };
        })()
      : null;

  // VAT pulled straight from the stored row — the form computes it on the
  // post-retainage base when an invoice is created, so the stored value is
  // authoritative. Recomputing on view would make the display math diverge
  // from invoice.total whenever an old invoice (pre-formula-change) is
  // viewed.
  const vatRatePct = template ? Number(template.vatRatePercent) : 0;
  const vatAmount = parseMoney(invoice.taxAmount);

  const title =
    template?.titleOverride && template.titleOverride.trim() !== ''
      ? template.titleOverride
      : 'Invoice';

  // Invoice # / date / due date — identity, always render. Billing type
  // is operator-facing only (drives form behavior), not something the
  // recipient needs on the invoice, so it's omitted from the PDF/Excel.
  // The `showProjectMetadata` flag gates the PO # / Billing # rows below.
  const meta: DocumentMeta[] = [
    { label: 'Invoice #', value: invoice.number },
    { label: 'Invoice date', value: invoice.invoiceDate },
  ];
  if (invoice.dueDate) meta.push({ label: 'Due date', value: invoice.dueDate });
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

  // Totals stack reads top-to-bottom as: starting subtotal -> retainage
  // withheld -> what's actually being billed (net of retainage) -> VAT on
  // that base -> grand total. Makes the retainage subtraction obvious
  // and prevents VAT from being inflated by money that's held back.
  //
  // In progress-billing mode (invoice has percentOfContract + project has
  // contract value), the totals stack uses the cumulative framing instead:
  // "Billing #N — X% Progress" / Less Previously Paid / Less Retention /
  // Invoice Total / VAT / Final Total — matching the construction-industry
  // AIA-style progress payment certificate format.
  const totals: DocumentTotalsRow[] = [];
  const showVatRow = template ? template.showTaxVat : true;
  const showRetainageRow =
    (template ? template.showRetainage : true) && retainageAmount > 0;

  if (progressContext) {
    // If the template label already starts with "Less" (operator's
    // preference), don't prepend another one — avoids "Less less retainage".
    const rawRetentionLabel =
      template?.retainageHeldLabel ?? 'Retention held';
    const retentionLabel = rawRetentionLabel
      .replace(/^less\s+/i, '')
      .toLowerCase();
    totals.push({
      label: `Billing #${progressContext.billingNumber} — ${progressContext.pct.toFixed(2)}% Progress`,
      value: progressContext.cumulative,
    });
    if (progressContext.priorNet > 0) {
      totals.push({
        label: 'Less previously paid',
        value: progressContext.priorNet,
        negative: true,
      });
    }
    if (showRetainageRow && progressContext.cumRetention > 0) {
      totals.push({
        label: `Less ${retentionLabel} (${progressContext.retentionPct.toFixed(2)}% of cumulative)`,
        value: progressContext.cumRetention,
        negative: true,
      });
    }
    totals.push({ label: 'Invoice total', value: netOfRetainage, bold: true });
    if (showVatRow) {
      const baseVatLabel = template?.vatLabel ?? 'VAT';
      const vatLabel =
        vatRatePct > 0
          ? `${baseVatLabel} (${vatRatePct.toFixed(2)}%)`
          : baseVatLabel;
      totals.push({ label: vatLabel, value: vatAmount });
    }
    totals.push({ label: 'Final total', value: total, bold: true });
    totals.push({
      label: 'Amount paid',
      value: parseMoney(invoice.amountPaid),
    });
    totals.push({ label: 'Balance due', value: balance, bold: true });
  } else {
    totals.push({ label: 'Subtotal', value: subtotal });
    if (showRetainageRow) {
      const rawLabel = template?.retainageHeldLabel ?? 'Retainage held';
      const cleanLabel = rawLabel.replace(/^less\s+/i, '').toLowerCase();
      totals.push({
        label: `Less ${cleanLabel} (${Number(invoice.retainagePercent).toFixed(2)}%)`,
        value: retainageAmount,
        negative: true,
      });
      totals.push({ label: 'Net of retainage', value: netOfRetainage });
    }
    if (showVatRow) {
      const baseVatLabel = template?.vatLabel ?? 'VAT';
      const vatLabel = showRetainageRow
        ? vatRatePct > 0
          ? `${baseVatLabel} on net (${vatRatePct.toFixed(2)}%)`
          : `${baseVatLabel} on net`
        : vatRatePct > 0
          ? `${baseVatLabel} (${vatRatePct.toFixed(2)}%)`
          : (template?.vatLabel ?? 'Tax / VAT');
      totals.push({ label: vatLabel, value: vatAmount });
    }
    totals.push({ label: 'Net amount due', value: total, bold: true });
    totals.push({ label: 'Amount paid', value: parseMoney(invoice.amountPaid) });
    totals.push({ label: 'Balance due', value: balance, bold: true });
  }

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
  if (template ? template.showWireInstructions : false) {
    // Compose wire instructions from the company's bank fields (set in
    // company settings) plus the template's free-text note. Either alone
    // is enough to render the section; both together is the common case.
    const bankLines: string[] = [];
    if (company.bankName) bankLines.push(`Bank: ${company.bankName}`);
    if (company.bankBranch) bankLines.push(`Branch: ${company.bankBranch}`);
    if (company.bankAccountName)
      bankLines.push(`Account name: ${company.bankAccountName}`);
    if (company.bankAccountNumber)
      bankLines.push(`Account number: ${company.bankAccountNumber}`);
    if (company.bankAddress) bankLines.push(`Bank address: ${company.bankAddress}`);
    if (company.paymentNotes) bankLines.push(company.paymentNotes);
    const templateNote = template?.wireInstructionsNote?.trim() ?? '';
    const body = [bankLines.join('\n'), templateNote].filter(Boolean).join('\n\n');
    if (body.trim() !== '') {
      sections.push({
        title: 'Wire / payment instructions',
        body,
      });
    }
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
  const currency = company.defaultCurrency ?? 'USD';
  const fmtAmount = (n: number, negative = false): string =>
    negative ? `(${formatMoney(n, currency)})` : formatMoney(n, currency);
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
      fmtAmount(amount, negative),
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
            fmtAmount(sub),
            fmtAmount(paid),
            fmtAmount(bal),
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

  // Lump-sum invoices ship qty=1, unit='', unitCost=lineTotal. Showing the
  // qty/unit/unit-cost columns on a lump-sum draw is just noise, so the
  // renderer drops them via `simpleLineItems`.
  const simpleLineItems =
    invoice.billingType === 'lump_sum' ||
    template?.lineItemLayout === 'lumpsum';

  return {
    type: 'invoice',
    title,
    number: invoice.number,
    // statusLabel intentionally omitted — DRAFT / SENT / PAID is an
    // operator-side state, not something the recipient needs on the PDF.
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
    // In progress-billing mode the totals stack tells the whole story
    // (cumulative → previously paid → retention → invoice total → VAT →
    // final total), so we suppress the line items table entirely. The line
    // description gets promoted to headerNote so the recipient still sees
    // what's being billed for.
    lines: progressContext || !showLineItems
      ? []
      : lines.map((l) => ({
          description: l.description,
          unit: l.unit,
          quantity: Number(l.quantity),
          unitCost: Number(l.unitCost),
          lineTotal: Number(l.lineTotal),
        })),
    simpleLineItems,
    totals,
    sections,
    dataTables: dataTables.length > 0 ? dataTables : undefined,
    // Combine template's headerNote with the (progress-mode-only) line
    // description so the operator's "what am I billing for" context still
    // shows up above the totals. Either piece alone is enough.
    headerNote: (() => {
      const parts: string[] = [];
      if (template?.headerNote && template.headerNote.trim() !== '') {
        parts.push(template.headerNote);
      }
      if (progressContext && lines[0]?.description) {
        const desc = lines[0].description.trim();
        const autoLabel = `Billing #${progressContext.billingNumber} — ${progressContext.pct.toFixed(2)}% Progress`;
        // Skip the auto-generated default — it's already the first totals row.
        if (desc !== '' && desc !== autoLabel && desc !== 'Lump sum billing') {
          parts.push(desc);
        }
      }
      return parts.length > 0 ? parts.join('\n\n') : null;
    })(),
    signatureBlock,
    footerNote: showFooter ? (template?.footerText ?? null) : null,
  };
}

