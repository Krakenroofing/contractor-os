import 'server-only';
import {
  getInvoice,
  getInvoiceLineItems,
  listInvoicesForProject,
} from '@/lib/data/invoices';
import { getInvoicePayments } from '@/lib/data/invoice-payments';
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

  // Split settlement into actual cash vs credit-memo applications. A credit
  // memo applied to an invoice books a contra payment with method
  // 'credit_memo'; lumping that under "Amount paid" reads as cash received —
  // it isn't (it's a discount / back-charge credit), so it gets its own
  // "Credit applied" line below.
  const payments = await getInvoicePayments(invoice.id);
  const creditApplied = payments
    .filter(
      (p) =>
        p.method === 'credit_memo' &&
        (p.status === 'applied' || p.status === 'received'),
    )
    .reduce((acc, p) => add(acc, parseMoney(p.amount)), 0);
  const amountPaidTotal = parseMoney(invoice.amountPaid);
  const cashPaid = subtract(amountPaidTotal, creditApplied);

  // Track classification: every invoice on a project sits on either the
  // BASE CONTRACT track or the CHANGE ORDER track. This drives:
  //   - which contract value the % progress is computed against
  //   - which prior invoices count toward "previously billed" on this track
  //   - how Progress Billing Summary + Account History split the numbers
  //     so historical paper invoices stop drifting after a CO lands
  //
  // We load all approved COs upfront so the table builders below can reuse
  // them without re-fetching.
  const allCompanyChangeOrders = project ? await listChangeOrders(companyId) : [];
  const projectChangeOrders = allCompanyChangeOrders.filter(
    (co) => co.projectId === invoice.projectId,
  );
  const approvedProjectCOs = projectChangeOrders.filter(
    (co) => normalizeStatus('change_order', co.status) === 'approved',
  );
  const coById = new Map(projectChangeOrders.map((co) => [co.id, co]));
  const isInvoiceOnCoTrack = (i: {
    changeOrderId: string | null;
    billingType: string;
  }): boolean =>
    i.changeOrderId !== null || i.billingType === 'change_order';
  const thisInvoiceOnCoTrack = isInvoiceOnCoTrack(invoice);
  const thisInvoiceCoTotal =
    invoice.changeOrderId !== null
      ? parseMoney(coById.get(invoice.changeOrderId)?.total ?? '0')
      : 0;

  // Progress-billing context: when this invoice has a `percentOfContract`
  // and lives on a project with a contract base, derive the cumulative
  // billing / previously-paid / cumulative-retention rollup so we can
  // render the breakdown instead of standard line items.
  //
  // Denominator (the "contract" used for cumulative math):
  //   - If invoice is CO-linked → that CO's total
  //   - Else → project.originalContractValue (NOT project.contractValue —
  //     using the revised value silently reshapes old % numbers after a CO
  //     lands, which breaks historical paper-trail fidelity)
  const progressPct =
    invoice.percentOfContract && Number(invoice.percentOfContract) > 0
      ? Number(invoice.percentOfContract)
      : null;
  const originalContractValue = project
    ? parseMoney(project.originalContractValue)
    : 0;
  const progressDenominator = thisInvoiceOnCoTrack
    ? thisInvoiceCoTotal
    : originalContractValue;
  const progressContext =
    progressPct !== null && project && progressDenominator > 0
      ? await (async () => {
          const contract = progressDenominator;
          const allProjectInvoices = await listInvoicesForProject(project.id);
          // Only same-track prior invoices contribute to "previously billed".
          const prior = allProjectInvoices
            .filter((i) => i.id !== invoice.id)
            .filter(
              (i) =>
                normalizeStatus('invoice', i.status) !== 'void' &&
                i.invoiceDate <= invoice.invoiceDate &&
                isInvoiceOnCoTrack(i) === thisInvoiceOnCoTrack,
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
  // Shared settlement rows: cash payments and credit-memo applications shown
  // separately so a credit reads as a credit, not as cash paid.
  const pushSettlementRows = () => {
    if (cashPaid > 0 || creditApplied === 0) {
      totals.push({ label: 'Amount paid', value: cashPaid });
    }
    if (creditApplied > 0) {
      totals.push({
        label: 'Credit applied',
        value: creditApplied,
        negative: true,
      });
    }
  };
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
    pushSettlementRows();
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
    pushSettlementRows();
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
  // Two parallel tracks — BASE CONTRACT and CHANGE ORDERS — each with its
  // own contract value, previously billed, this-invoice contribution, and
  // remaining balance. Then a small revised-contract summary at the bottom.
  //
  // Why split: when historical change orders are entered later, the
  // single-line "Revised contract — Less previously billed" view drifts
  // from the operator's paper trail. Splitting locks each track to its own
  // denominator so the % and dollar numbers match what the customer
  // originally received.
  const currency = company.defaultCurrency ?? 'USD';
  const fmtAmount = (n: number, negative = false): string =>
    negative ? `(${formatMoney(n, currency)})` : formatMoney(n, currency);
  const dataTables: DocumentDataTable[] = [];
  if (template?.showProgressBilling && project) {
    const approvedCOTotal = approvedProjectCOs.reduce(
      (acc, co) => add(acc, parseMoney(co.total)),
      0,
    );
    const originalContract = parseMoney(project.originalContractValue);
    const revisedContract = add(originalContract, approvedCOTotal);

    // Split prior invoices by track. Same-track = same denominator.
    const allPriorInvoices = (
      await listInvoicesForProject(invoice.projectId)
    )
      .filter((i) => i.id !== invoice.id)
      .filter((i) => normalizeStatus('invoice', i.status) !== 'void');
    const priorBase = allPriorInvoices.filter(
      (i) => !isInvoiceOnCoTrack(i),
    );
    const priorCo = allPriorInvoices.filter((i) => isInvoiceOnCoTrack(i));
    const priorBaseBilled = priorBase.reduce(
      (acc, i) => add(acc, parseMoney(i.subtotal)),
      0,
    );
    const priorCoBilled = priorCo.reduce(
      (acc, i) => add(acc, parseMoney(i.subtotal)),
      0,
    );

    // This-invoice contribution lands on exactly one track.
    const thisBase = thisInvoiceOnCoTrack ? 0 : subtotal;
    const thisCo = thisInvoiceOnCoTrack ? subtotal : 0;
    const baseBalance = subtract(
      originalContract,
      add(priorBaseBilled, thisBase),
    );
    const coBalance = subtract(approvedCOTotal, add(priorCoBilled, thisCo));
    const totalBilled = add(priorBaseBilled, priorCoBilled, thisBase, thisCo);
    const totalBalance = subtract(revisedContract, totalBilled);

    const fmtRow = (label: string, amount: number, negative = false): string[] => [
      label,
      fmtAmount(amount, negative),
    ];

    const rows: string[][] = [];

    // ----- Base contract track -----
    rows.push([template.contractValueLabel || 'Base contract value', '']);
    rows.push(fmtRow('  Original contract', originalContract));
    if (priorBaseBilled > 0 || priorBase.length > 0) {
      rows.push(
        fmtRow(
          `  ${template.priorBilledLabel || 'Less previously billed'}`,
          priorBaseBilled,
          true,
        ),
      );
    }
    if (thisBase > 0) {
      rows.push(fmtRow('  This invoice', thisBase));
    }
    rows.push(fmtRow('  Balance (base contract)', baseBalance));

    // ----- Change orders track -----
    if (approvedProjectCOs.length > 0 || priorCo.length > 0 || thisCo > 0) {
      rows.push([template.changeOrdersLabel || 'Change orders', '']);
      // Itemise each approved CO so the customer can see the breakdown.
      for (const co of approvedProjectCOs) {
        const coTotal = parseMoney(co.total);
        const isThisInvoiceForThisCo = invoice.changeOrderId === co.id;
        const label = `  CO #${co.number}${
          co.description ? ` — ${co.description.slice(0, 50)}` : ''
        }${isThisInvoiceForThisCo ? ' (this invoice)' : ''}`;
        rows.push(fmtRow(label, coTotal));
      }
      rows.push(fmtRow('  Total approved change orders', approvedCOTotal));
      if (priorCoBilled > 0 || priorCo.length > 0) {
        rows.push(
          fmtRow(
            `  ${template.priorBilledLabel || 'Less previously billed (CO)'}`,
            priorCoBilled,
            true,
          ),
        );
      }
      if (thisCo > 0) {
        rows.push(fmtRow('  This invoice (CO)', thisCo));
      }
      rows.push(fmtRow('  Balance (change orders)', coBalance));
    }

    // ----- Combined summary -----
    rows.push(fmtRow('Revised contract', revisedContract));
    rows.push(fmtRow('Total billed to date', totalBilled));
    const retainageHeldNow = parseMoney(invoice.retainageAmount);
    if (retainageHeldNow > 0) {
      rows.push(
        fmtRow(
          template.retainageHeldLabel || 'Less retainage held',
          retainageHeldNow,
          true,
        ),
      );
    }
    rows.push(fmtRow('Total balance to bill', totalBalance));

    dataTables.push({
      title: template.progressBillingLabel || 'Progress billing summary',
      columns: [
        { label: 'Item', align: 'left', widthPct: 70 },
        { label: 'Amount', align: 'right', widthPct: 30 },
      ],
      rows,
    });
  }

  // ---- Account history (prior invoices on this project) ----
  // Split into two tables (base contract vs change orders) for the same
  // reason as the progress summary — historical paper invoices need to
  // line up with their original contract base, not the post-CO revised
  // value.
  if (template?.showAccountHistory && project) {
    const priorInvoices = (await listInvoicesForProject(invoice.projectId))
      .filter((i) => i.id !== invoice.id)
      .filter((i) => normalizeStatus('invoice', i.status) !== 'void')
      .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));

    const baseHistory = priorInvoices.filter((i) => !isInvoiceOnCoTrack(i));
    const coHistory = priorInvoices.filter((i) => isInvoiceOnCoTrack(i));

    const historyRow = (i: (typeof priorInvoices)[number]): string[] => {
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
    };

    const historyColumns = [
      { label: 'Invoice #', widthPct: 18 },
      { label: 'Date', widthPct: 18 },
      { label: 'Status', widthPct: 14 },
      { label: 'Subtotal', align: 'right' as const, widthPct: 17 },
      { label: 'Paid', align: 'right' as const, widthPct: 17 },
      { label: 'Balance', align: 'right' as const, widthPct: 16 },
    ];

    const baseLabel = template.accountHistoryLabel || 'Account history';

    if (baseHistory.length > 0) {
      dataTables.push({
        title: `${baseLabel} — base contract`,
        columns: historyColumns,
        rows: baseHistory.map(historyRow),
      });
    }

    if (coHistory.length > 0) {
      // Group change-order history by CO so the customer can see "for CO #N"
      // when an invoice was specifically tied to a CO. Invoices on the CO
      // track but not linked to a specific CO (billingType=change_order)
      // appear under a generic CO heading.
      const coGroups = new Map<string, typeof priorInvoices>();
      for (const i of coHistory) {
        const key = i.changeOrderId ?? '__unlinked__';
        const existing = coGroups.get(key);
        if (existing) existing.push(i);
        else coGroups.set(key, [i]);
      }
      for (const [coId, group] of coGroups) {
        const co = coId === '__unlinked__' ? null : coById.get(coId);
        const titleSuffix = co
          ? ` — CO #${co.number}${
              co.description ? ` (${co.description.slice(0, 50)})` : ''
            }`
          : ' — change orders';
        dataTables.push({
          title: `${baseLabel}${titleSuffix}`,
          columns: historyColumns,
          rows: group.map(historyRow),
        });
      }
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

