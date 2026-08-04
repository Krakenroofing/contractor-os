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
  // Project-credit lines are itemised under the subtotal so VAT reads as
  // charged on the net. `subtotal` (invoice.subtotal) is already the net; the
  // gross is the pre-credit work value shown above the credit row.
  const projectCreditTotal = lines.reduce(
    (s, l) =>
      l.isProjectCredit && Number(l.lineTotal) < 0 ? add(s, -Number(l.lineTotal)) : s,
    0,
  );
  const grossSubtotal = add(subtotal, projectCreditTotal);
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
  // billRevised: a base-track invoice that bills against the REVISED contract
  // (project.contractValue = base + approved COs), netting prior billings
  // across both tracks.
  const billRevised = !!invoice.billAgainstRevised && !thisInvoiceOnCoTrack;
  const revisedContractValue = project ? parseMoney(project.contractValue) : 0;
  const progressDenominator = thisInvoiceOnCoTrack
    ? thisInvoiceCoTotal
    : billRevised
      ? revisedContractValue
      : originalContractValue;
  const progressContext =
    progressPct !== null && project && progressDenominator > 0
      ? await (async () => {
          const contract = progressDenominator;
          const allProjectInvoices = await listInvoicesForProject(project.id);
          // Which prior invoices reduce "previously billed" for THIS draw:
          //   - revised-contract draw → ALL prior billings (both tracks)
          //   - CO-linked draw        → only priors on the SAME change order
          //     (a % draw on CO-#2 must not be reduced by a different CO's
          //     billing — that printed another CO's amount as "previously
          //     paid" and the page-1 stack stopped footing). Mirrors the
          //     on-screen invoice page's `priorOnSameSource`.
          //   - base draw             → only base-track priors
          const prior = allProjectInvoices
            .filter((i) => i.id !== invoice.id)
            .filter(
              (i) =>
                normalizeStatus('invoice', i.status) !== 'void' &&
                i.invoiceDate <= invoice.invoiceDate &&
                (billRevised
                  ? true
                  : thisInvoiceOnCoTrack
                    ? (i.changeOrderId ?? null) ===
                      (invoice.changeOrderId ?? null)
                    : !isInvoiceOnCoTrack(i)),
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
  // The totals stack shows THIS INVOICE's charges only — subtotal, (retainage),
  // VAT, total. Settlement (amount paid / credit / balance) is kept in its own
  // "Payment summary" table below so the current charge isn't muddled with the
  // running account — operators were finding clients miss the VAT in the mix.
  const totals: DocumentTotalsRow[] = [];
  // Never render a VAT row for a non-VAT company (e.g. Kraken Roofing LLC,
  // US) — otherwise the PDF shows a "VAT $0.00" line on every invoice.
  const showVatRow = (template ? template.showTaxVat : true) && company.isVatActive;
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
      // "Previously billed", not "paid" — the figure sums prior invoices
      // regardless of whether the client has settled them.
      totals.push({
        label: template?.priorBilledLabel ?? 'Less previously billed',
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
    totals.push({
      label: showVatRow ? 'Final total (incl. VAT)' : 'Final total',
      value: total,
      bold: true,
    });
  } else {
    if (projectCreditTotal > 0) {
      totals.push({ label: 'Subtotal', value: grossSubtotal });
      totals.push({
        label: 'Less project credit',
        value: projectCreditTotal,
        negative: true,
      });
      totals.push({ label: 'Net subtotal', value: subtotal });
    } else {
      totals.push({ label: 'Subtotal', value: subtotal });
    }
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
    totals.push({
      label: showVatRow ? 'Net amount due (incl. VAT)' : 'Net amount due',
      value: total,
      bold: true,
    });
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
    if (company.bankRoutingNumber) {
      // US (ACH) account — Beneficiary / Bank / Routing / Account number.
      if (company.bankAccountName)
        bankLines.push(`Beneficiary: ${company.bankAccountName}`);
      if (company.bankName) bankLines.push(`Bank: ${company.bankName}`);
      bankLines.push(`Routing (ACH): ${company.bankRoutingNumber}`);
      if (company.bankAccountNumber)
        bankLines.push(`Account number: ${company.bankAccountNumber}`);
      if (company.bankAddress)
        bankLines.push(`Bank address: ${company.bankAddress}`);
    } else {
      // Bahamas-style account — Bank / Branch / Account name.
      if (company.bankName) bankLines.push(`Bank: ${company.bankName}`);
      if (company.bankBranch) bankLines.push(`Branch: ${company.bankBranch}`);
      if (company.bankAccountName)
        bankLines.push(`Account name: ${company.bankAccountName}`);
      if (company.bankAccountNumber)
        bankLines.push(`Account number: ${company.bankAccountNumber}`);
      if (company.bankAddress)
        bankLines.push(`Bank address: ${company.bankAddress}`);
    }
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

  // ---- Contract summary table ----
  // Base contract and change-order work are shown on SEPARATE tracks. Each
  // track foots on its own:  value − previously billed − this invoice =
  // still billable.  Cumulative retainage held is a separate memo line at
  // the bottom — NOT a row dangling next to a "balance to bill" that never
  // subtracted it (the old layout did exactly that, and showed only this
  // invoice's retainage, so the stack didn't foot and read as confusing).
  //
  // "Billed" figures use subtotals (work value, pre-retainage/pre-VAT) so
  // they share units with the contract value.
  const currency = company.defaultCurrency ?? 'USD';
  const fmtAmount = (n: number, negative = false): string =>
    negative ? `(${formatMoney(n, currency)})` : formatMoney(n, currency);
  const dataTables: DocumentDataTable[] = [];
  // Only a CONTRACT job gets this block. A service / T&M project has no
  // contract value, so "still billable" (contract − billed) is meaningless
  // and would print as a negative.
  const projectHasContractValue =
    !!project &&
    add(
      originalContractValue,
      approvedProjectCOs.reduce((acc, co) => add(acc, parseMoney(co.total)), 0),
    ) > 0;
  if (template?.showProgressBilling && project && projectHasContractValue) {
    const originalContract = parseMoney(project.originalContractValue);

    // Prior invoices on the project up to (and including the date of) this
    // one, excluding this invoice itself and voids.
    const priorToDate = (await listInvoicesForProject(invoice.projectId))
      .filter((i) => i.id !== invoice.id)
      .filter((i) => normalizeStatus('invoice', i.status) !== 'void')
      .filter((i) => i.invoiceDate <= invoice.invoiceDate);
    const priorBaseBilled = priorToDate
      .filter((i) => !isInvoiceOnCoTrack(i))
      .reduce((acc, i) => add(acc, parseMoney(i.subtotal)), 0);

    // This-invoice base contribution (CO contribution is handled per-CO below).
    const thisBase = thisInvoiceOnCoTrack ? 0 : subtotal;
    const baseStill = subtract(originalContract, add(priorBaseBilled, thisBase));

    // Prior CO billing grouped by the CO it was billed against, so each CO
    // shows its own remaining balance. CO-track invoices with no linked CO
    // fall into an "other" bucket.
    const coTrackPriors = priorToDate.filter((i) => isInvoiceOnCoTrack(i));
    const billedByCoId = new Map<string, number>();
    let unlinkedCoBilled = 0;
    for (const i of coTrackPriors) {
      if (i.changeOrderId) {
        billedByCoId.set(
          i.changeOrderId,
          add(billedByCoId.get(i.changeOrderId) ?? 0, parseMoney(i.subtotal)),
        );
      } else {
        unlinkedCoBilled = add(unlinkedCoBilled, parseMoney(i.subtotal));
      }
    }
    const thisCoId = thisInvoiceOnCoTrack ? invoice.changeOrderId : null;

    // Cumulative retainage withheld (net of releases) across all non-void
    // invoices on the project up to and including this one.
    const retainageHeldToDate = add(
      priorToDate.reduce(
        (acc, i) =>
          add(
            acc,
            subtract(
              parseMoney(i.retainageAmount),
              parseMoney(i.retainageReleased),
            ),
          ),
        0,
      ),
      subtract(
        parseMoney(invoice.retainageAmount),
        parseMoney(invoice.retainageReleased),
      ),
    );

    const rows: string[][] = [];

    if (billRevised) {
      // ----- Revised-contract draw: ONE combined track -----
      // This draw's % totals from the revised contract and nets prior
      // billings across base + CO, so the summary must foot the same way —
      // a base/CO split would show the base over-billed and the CO
      // untouched when this draw deliberately covered both.
      const priorAllBilled = priorToDate.reduce(
        (acc, i) => add(acc, parseMoney(i.subtotal)),
        0,
      );
      const revisedStill = subtract(
        revisedContractValue,
        add(priorAllBilled, subtotal),
      );
      rows.push(['Revised contract (base + change orders)', '']);
      rows.push(['  Contract value', fmtAmount(revisedContractValue)]);
      if (priorAllBilled > 0) {
        rows.push(['  Previously billed', fmtAmount(priorAllBilled, true)]);
      }
      if (subtotal > 0) {
        rows.push(['  This invoice', fmtAmount(subtotal, true)]);
      }
      rows.push(['  Still billable', fmtAmount(revisedStill)]);
    } else {
    // ----- Base contract track -----
    rows.push([template.contractValueLabel || 'Base contract', '']);
    rows.push(['  Contract value', fmtAmount(originalContract)]);
    if (priorBaseBilled > 0) {
      rows.push(['  Previously billed', fmtAmount(priorBaseBilled, true)]);
    }
    if (thisBase > 0) {
      rows.push(['  This invoice', fmtAmount(thisBase, true)]);
    }
    rows.push(['  Still billable', fmtAmount(baseStill)]);

    // ----- Change orders track (itemised per CO) -----
    if (
      approvedProjectCOs.length > 0 ||
      coTrackPriors.length > 0 ||
      thisInvoiceOnCoTrack
    ) {
      rows.push([template.changeOrdersLabel || 'Change orders', '']);
      const itemisedCOs = [...approvedProjectCOs].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      for (const co of itemisedCOs) {
        const value = parseMoney(co.total);
        const prevBilled = billedByCoId.get(co.id) ?? 0;
        const thisAmt = thisCoId === co.id ? subtotal : 0;
        const still = subtract(value, add(prevBilled, thisAmt));
        // Full description — the cell wraps in the PDF. Cap only extreme
        // outliers so the unbreakable summary table can't outgrow the page.
        const desc =
          co.description && co.description.length > 200
            ? `${co.description.slice(0, 200)}…`
            : co.description;
        const label = `  ${co.number}${desc ? ` — ${desc}` : ''}`;
        rows.push([label, '']);
        rows.push(['    Approved value', fmtAmount(value)]);
        if (prevBilled > 0) {
          rows.push(['    Previously billed', fmtAmount(prevBilled, true)]);
        }
        if (thisAmt > 0) {
          rows.push(['    This invoice', fmtAmount(thisAmt, true)]);
        }
        rows.push(['    Still billable', fmtAmount(still)]);
      }
      if (unlinkedCoBilled > 0) {
        rows.push(['  Other change-order billing', fmtAmount(unlinkedCoBilled, true)]);
      }
    }
    }

    // ----- Cumulative retainage memo -----
    const showRetainageMemo =
      (template ? template.showRetainage : true) && retainageHeldToDate > 0;
    if (showRetainageMemo) {
      rows.push(['Retainage held to date', fmtAmount(retainageHeldToDate)]);
    }

    dataTables.push({
      title: template.progressBillingLabel || 'Contract summary',
      columns: [
        { label: 'Item', align: 'left', widthPct: 70 },
        { label: 'Amount', align: 'right', widthPct: 30 },
      ],
      rows,
    });
  }

  // ---- Payment summary (this invoice's settlement) ----
  // Kept OUT of the charge totals and in its own table so the current
  // invoice's "Subtotal / VAT / Total" reads cleanly. Only shown once
  // something has actually been paid or credited against this invoice.
  if (cashPaid > 0 || creditApplied > 0) {
    const paymentRows: string[][] = [['Invoice total', fmtAmount(total)]];
    if (cashPaid > 0) {
      paymentRows.push(['Amount paid', fmtAmount(cashPaid, true)]);
    }
    if (creditApplied > 0) {
      paymentRows.push(['Credit applied', fmtAmount(creditApplied, true)]);
    }
    paymentRows.push(['Balance due', fmtAmount(balance)]);
    dataTables.push({
      title: 'Payment summary',
      columns: [
        { label: 'Item', align: 'left', widthPct: 70 },
        { label: 'Amount', align: 'right', widthPct: 30 },
      ],
      rows: paymentRows,
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
    // (cumulative → previously billed → retention → invoice total → VAT →
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

