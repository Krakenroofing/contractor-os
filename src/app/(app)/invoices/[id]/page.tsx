import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { BackButton } from '@/components/back-button';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { CompanyStandardTerms } from '@/components/company-standard-terms';
import { DocumentBranding } from '@/components/document-branding';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveCompany, getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { add, formatMoney, parseMoney, subtract } from '@/lib/money';
import {
  getInvoice,
  getInvoiceLineItems,
  listInvoicesForProject,
} from '@/lib/data/invoices';
import { getInvoicePayments } from '@/lib/data/invoice-payments';
import { getInvoiceTemplate } from '@/lib/data/invoice-templates';
import {
  getChangeOrder,
  listApprovedChangeOrdersForProject,
} from '@/lib/data/change-orders';
import { getProposal } from '@/lib/data/proposals';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { toAccountingAccountOptions } from '@/modules/accounting/lib/account-options';
import { InvoiceRevenueCategoryPicker } from '@/modules/invoices/components/invoice-revenue-category-picker';
import {
  listCreditMemosForInvoice,
  getInvoiceCreditApplicationsMap,
} from '@/lib/data/credit-memos';
import { IssueCreditMemoDialog } from '@/modules/credit-memos/components/issue-credit-memo-dialog';
import { BILLING_TYPE_LABEL } from '@/modules/invoices/schema';
import { ActivityLogCard } from '@/modules/status/components/activity-log-card';
import { StatusBadge } from '@/modules/status/components/status-badge';
import { StatusPanel } from '@/modules/status/components/status-panel';
import { InvoiceActionsBar } from '@/modules/invoices/components/invoice-actions-bar';
import { DocumentDownloadButtons } from '@/components/document-download-buttons';
import { DeleteOrphanedPaymentsButton } from '@/modules/payments/components/delete-orphaned-payments-button';

export const dynamic = 'force-dynamic';

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const fromProject = from === 'project';
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'invoices');

  const invoice = await getInvoice(companyId, id);
  if (!invoice) notFound();

  const project = await getProject(companyId, invoice.projectId);
  const customer = project ? await getCustomer(companyId, project.customerId) : undefined;
  const proposal = invoice.proposalId
    ? await getProposal(companyId, invoice.proposalId)
    : undefined;
  const co = invoice.changeOrderId
    ? await getChangeOrder(companyId, invoice.changeOrderId)
    : undefined;
  // Approved change orders on this project — used by the contract summary to
  // itemise each CO's own value / billed / still-billable instead of rolling
  // them into one line (which hid a CO's unbilled remainder).
  const approvedCOs = invoice.projectId
    ? await listApprovedChangeOrdersForProject(invoice.projectId)
    : [];
  const template = invoice.templateId
    ? await getInvoiceTemplate(companyId, invoice.templateId)
    : undefined;
  const lines = await getInvoiceLineItems(invoice.id);
  const payments = await getInvoicePayments(invoice.id);
  // Revenue categories (income-rollup accounts) for the P&L revenue-by-service
  // -type split. Internal classification — not printed on the invoice.
  const incomeAccounts = toAccountingAccountOptions(
    (await listAccountingAccounts(companyId)).filter(
      (a) => a.rollupGroup === 'income',
    ),
  );

  // Phase 1: pull the active company for the wire-instructions / TIN block,
  // and all prior invoices on the same project for the account-history /
  // progress-billing aggregates. Both are cheap (already loaded for other
  // sections via React.cache or direct query).
  const company = await getActiveCompany();
  const allProjectInvoices = project
    ? await listInvoicesForProject(project.id)
    : [];
  const otherInvoices = allProjectInvoices
    .filter((i) => i.id !== invoice.id && i.status !== 'void')
    .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));
  const balance = subtract(parseMoney(invoice.total), parseMoney(invoice.amountPaid));

  // Phase: credit memos. Pull any credits linked to this invoice + the
  // running total of credit-applications netted against it.
  const creditMemos = await listCreditMemosForInvoice(companyId, invoice.id);
  const creditAppsMap = await getInvoiceCreditApplicationsMap(companyId, [
    invoice.id,
  ]);
  const creditAppliedToInvoice = creditAppsMap.get(invoice.id) ?? 0;
  const netBilledAfterCredits = subtract(
    parseMoney(invoice.total),
    creditAppliedToInvoice,
  );

  // VAT pulled straight from the stored row — the form computes it on
  // the post-retainage base at create time, so the stored value is
  // authoritative. Recomputing on view would diverge from invoice.total
  // for pre-formula-change invoices.
  const vatRatePct = template ? Number(template.vatRatePercent) : 0;
  const netOfRetainage = subtract(
    parseMoney(invoice.subtotal),
    parseMoney(invoice.retainageAmount),
  );
  const vatAmount = Number(invoice.taxAmount);

  // Project-credit lines are itemised under the subtotal so VAT reads as
  // charged on the net (subtotal − credit). `invoice.subtotal` is already the
  // net; add the credits back to show the gross work value above them.
  const projectCreditTotal = lines.reduce(
    (s, l) =>
      l.isProjectCredit && Number(l.lineTotal) < 0
        ? s + -Number(l.lineTotal)
        : s,
    0,
  );
  const grossSubtotal = add(parseMoney(invoice.subtotal), projectCreditTotal);

  // Title override (e.g. "VAT Invoice", "Progress Invoice", "Request for
  // Change Order"). Falls back to a sensible default when the template
  // doesn't set one.
  const invoiceTitle =
    template?.titleOverride && template.titleOverride.trim() !== ''
      ? template.titleOverride
      : 'Invoice';

  // Template flags (default-on for unconfigured fields)
  const show = (key: keyof NonNullable<typeof template>, defaultOn = true): boolean =>
    template ? Boolean(template[key]) : defaultOn;

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <Breadcrumbs
        items={[
          ...(fromProject && project
            ? [{ href: `/projects/${project.id}`, label: project.name }]
            : []),
          { href: '/invoices', label: 'Invoices' },
          { label: invoice.number },
        ]}
      />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <BackButton
          listHref="/invoices"
          listLabel="Invoices"
          projectId={fromProject ? invoice.projectId : null}
          projectName={project?.name}
        />
        <div className="flex items-center gap-2">
          <DocumentDownloadButtons type="invoice" id={invoice.id} />
          <InvoiceActionsBar
            id={invoice.id}
            status={invoice.status}
            hasPayments={payments.length > 0}
            allowEdit={allowCreate}
          />
          {allowCreate && customer && invoice.status !== 'void' && (
            <IssueCreditMemoDialog
              scope={{
                customerId: customer.id,
                customerName: customer.name,
                projectId: invoice.projectId,
                projectName: project?.name ?? null,
                invoiceId: invoice.id,
                invoiceNumber: invoice.number,
                defaultAmount: Math.max(balance > 0 ? balance : Number(invoice.total) - creditAppliedToInvoice, 0),
                suggestDeductCO: !!invoice.projectId,
              }}
              triggerLabel="Issue credit memo"
            />
          )}
          {allowCreate && (
            <Link href="/invoices/new">
              <Button size="sm" variant="outline">
                New Invoice
              </Button>
            </Link>
          )}
        </div>
      </div>

      {show('showCompanyBranding') && <DocumentBranding />}

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            {invoiceTitle}
          </p>
          <p className="font-mono text-xs text-slate-500">{invoice.number}</p>
          <h1 className="text-2xl font-semibold text-slate-900">
            {project?.name ?? 'Invoice'}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-600">
            {customer && <span>{customer.name}</span>}
            {project && (
              <>
                <span className="text-slate-400">·</span>
                <Link href={`/projects/${project.id}`} className="hover:underline">
                  {project.name}
                </Link>
              </>
            )}
            {proposal && (
              <>
                <span className="text-slate-400">·</span>
                <Link href={`/proposals/${proposal.id}`} className="hover:underline">
                  {proposal.number}
                </Link>
              </>
            )}
            {co && (
              <>
                <span className="text-slate-400">·</span>
                <Link href={`/change-orders/${co.id}`} className="hover:underline">
                  {co.number}
                </Link>
              </>
            )}
          </div>
          {template && (
            <p className="text-xs text-slate-500 mt-1">
              Template: <span className="font-medium">{template.name}</span>
            </p>
          )}
          {template?.headerNote && show('showHeader') && (
            <p className="text-sm text-slate-700 mt-2 italic">{template.headerNote}</p>
          )}
        </div>
        <StatusBadge entityType="invoice" status={invoice.status} />
      </div>

      <StatusPanel
        entityType="invoice"
        entityId={invoice.id}
        status={invoice.status}
        timestamps={[
          { label: 'Created', value: invoice.createdAt },
          { label: 'Sent', value: invoice.sentAt },
          { label: 'Due', value: invoice.dueDate },
          { label: 'Paid', value: invoice.paidAt },
        ]}
      />

      {/* Orphaned-payments notice: only rendered when the invoice is voided
          AND payment rows exist on it. Voids should make payments vanish
          from every total, so the existence of payment rows on a void is a
          data-cleanliness flag the operator needs to resolve. The button
          deletes the orphans after a two-click confirm; activity log
          captures the action. */}
      {invoice.status === 'void' && payments.length > 0 && allowCreate && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-2">
          <p>
            <strong>
              This voided invoice still has {payments.length} payment row
              {payments.length === 1 ? '' : 's'} attached.
            </strong>{' '}
            Voided invoices vanish from every report total, but the underlying
            payment rows stay until removed. If those payments were duplicates
            (e.g. you re-invoiced and the customer&apos;s cash was re-applied
            to the corrected invoice), delete them here. If the cash was real,
            re-apply it to the right invoice via <em>Record Payment</em> on
            that invoice first, then delete these.
          </p>
          <DeleteOrphanedPaymentsButton
            invoiceId={invoice.id}
            paymentCount={payments.length}
          />
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="Billing type" value={BILLING_TYPE_LABEL[invoice.billingType]} />
        <KPI label="Invoice date" value={invoice.invoiceDate} />
        <KPI label="Due" value={invoice.dueDate ?? '—'} />
        <KPI label="Total" value={formatMoney(invoice.total)} highlight />
      </div>

      {/* Phase 1: Project metadata block — PO, billing label, project
          description. Falls back gracefully when individual fields are
          empty. */}
      {template?.showProjectMetadata && (
        <Card>
          <CardHeader>
            <CardTitle>Project</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {invoice.purchaseOrderNumber && (
              <Row
                label={template.poNumberLabel}
                value={invoice.purchaseOrderNumber}
              />
            )}
            {invoice.billingLabel && (
              <Row
                label={template.billingNumberLabel}
                value={invoice.billingLabel}
              />
            )}
            {project?.name && (
              <Row label="Project name" value={project.name} />
            )}
            {project?.notes && (
              <Row
                label={template.projectDescriptionLabel}
                value={project.notes}
              />
            )}
            {invoice.termsOverride && (
              <Row label="Payment terms" value={invoice.termsOverride} />
            )}
          </CardContent>
        </Card>
      )}

      {/* Bill-to block. Renders address, contact, and TIN. When the
          template has the bill-to TIN section disabled but the customer
          has an address or TIN on file we still render the block — the
          template flag now governs the TIN row only. */}
      {customer && (template?.showBillToTin || customer.billingAddressLine1 || customer.tinNumber) && (
        <Card>
          <CardHeader>
            <CardTitle>Bill to</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <Row label="Client" value={customer.name} />
            {customer.primaryContactName && (
              <Row
                label={template?.billToAttentionLabel ?? 'Attn'}
                value={customer.primaryContactName}
              />
            )}
            {(customer.billingAddressLine1 ||
              customer.billingCity ||
              customer.billingState ||
              customer.billingPostalCode) && (
              <Row
                label="Address"
                value={[
                  customer.billingAddressLine1,
                  customer.billingCity,
                  customer.billingState,
                  customer.billingPostalCode,
                ]
                  .filter(Boolean)
                  .join(', ')}
              />
            )}
            {customer.email && <Row label="Email" value={customer.email} />}
            {customer.phone && <Row label="Phone" value={customer.phone} />}
            {(template?.showBillToTin || customer.tinNumber) && (
              <Row
                label={template?.tinLabel ?? 'TIN'}
                value={customer.tinNumber ?? '—'}
              />
            )}
          </CardContent>
        </Card>
      )}

      {show('showLineItems') && (
        <Card>
          <CardHeader>
            <CardTitle>
              {template?.lineItemLayout === 'lumpsum'
                ? 'Lump sum'
                : template?.lineItemLayout === 'summary'
                  ? 'Billing summary'
                  : `Line items (${lines.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {lines.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">No line items.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Unit cost</TableHead>
                    <TableHead className="text-right">Line total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-slate-900">{l.description}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(l.quantity).toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell className="text-slate-600">{l.unit ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(l.unitCost)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(l.lineTotal)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Totals</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <div className="space-y-1">
            {/* Order: subtotal -> less retainage -> net of retainage ->
                VAT on net -> net amount due. VAT is computed on the
                post-retainage base so retainage held back isn't taxed
                until it gets released. */}
            {projectCreditTotal > 0 ? (
              <>
                <Row label="Subtotal" value={formatMoney(grossSubtotal)} />
                <Row
                  label="Less project credit"
                  value={`(${formatMoney(projectCreditTotal)})`}
                  valueClassName="text-rose-700"
                />
                <Row
                  label="Net subtotal"
                  value={formatMoney(invoice.subtotal)}
                />
              </>
            ) : (
              <Row label="Subtotal" value={formatMoney(invoice.subtotal)} />
            )}
            {show('showRetainage') && Number(invoice.retainageAmount) > 0 && (
              <>
                <Row
                  label={`Less ${(template?.retainageHeldLabel ?? 'retainage held').replace(/^less\s+/i, '').toLowerCase()} (${Number(invoice.retainagePercent).toFixed(2)}%)`}
                  value={`(${formatMoney(invoice.retainageAmount)})`}
                />
                <Row label="Net of retainage" value={formatMoney(netOfRetainage)} />
                {Number(invoice.retainageReleased) > 0 && (
                  <Row
                    label="Retainage released"
                    value={formatMoney(invoice.retainageReleased)}
                    valueClassName="text-emerald-700"
                  />
                )}
              </>
            )}
            {show('showTaxVat') && company.isVatActive && (
              <Row
                label={(() => {
                  const base = template?.vatLabel ?? 'VAT';
                  const ratePart =
                    vatRatePct > 0 ? ` (${vatRatePct.toFixed(2)}%)` : '';
                  const hasRetainage =
                    show('showRetainage') && Number(invoice.retainageAmount) > 0;
                  return hasRetainage
                    ? `${base} on net${ratePart}`
                    : `${base}${ratePart}` || 'Tax / VAT';
                })()}
                value={formatMoney(vatAmount)}
              />
            )}
            <Row
              label={
                show('showTaxVat') && company.isVatActive
                  ? 'Net amount due (incl. VAT)'
                  : 'Net amount due'
              }
              value={formatMoney(invoice.total)}
              bold
            />
          </div>
          {/* Payment summary kept separate from the charge totals so the
              invoice's Subtotal / VAT / Total reads cleanly. Only shown once
              something has been paid against it. */}
          {Number(invoice.amountPaid) > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-200 space-y-1">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">
                Payment summary
              </p>
              <Row
                label="Amount paid"
                value={formatMoney(invoice.amountPaid)}
              />
              <Row
                label="Balance due"
                value={formatMoney(balance)}
                bold
                valueClassName={
                  balance <= 0 ? 'text-emerald-700' : 'text-amber-700'
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Internal: revenue category for the P&L (not part of the printed
          invoice). Lets revenue split by service type on the income statement. */}
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Revenue category</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-2">
          <p className="text-xs text-slate-500">
            Internal only — sets which income line this invoice&apos;s revenue
            shows under on the P&amp;L (Roofing / Waterproofing / Windows &amp;
            Doors / …). Doesn&apos;t change the invoice or any totals.
          </p>
          <div className="max-w-sm">
            <InvoiceRevenueCategoryPicker
              invoiceId={invoice.id}
              current={invoice.accountingAccountId ?? ''}
              accounts={incomeAccounts}
              canEdit={allowCreate}
            />
          </div>
        </CardContent>
      </Card>

      {/* Contract summary. Base contract and change-order work are shown on
          SEPARATE tracks — each foots on its own (value − previously billed −
          this invoice = still billable) — with cumulative retainage held
          shown as its own memo line rather than dangling next to a
          "balance to bill" that never subtracted it. "Billed" figures use
          subtotals (work value, pre-retainage/pre-VAT) so they sit in the
          same units as the contract value.
          Only a contract job gets this block; service / T&M projects have no
          contract value and skip it. */}
      {template?.showProgressBilling &&
        project &&
        Number(project.contractValue) > 0 &&
        (() => {
          const onCoTrack = (i: {
            changeOrderId: string | null;
            billingType: string;
          }): boolean =>
            i.changeOrderId !== null || i.billingType === 'change_order';
          // Prior invoices on the project up to (and including the date of)
          // this one, excluding this invoice itself and voids.
          const priorToDate = otherInvoices.filter(
            (i) => i.invoiceDate <= invoice.invoiceDate,
          );
          const priorBaseBilled = priorToDate
            .filter((i) => !onCoTrack(i))
            .reduce((s, i) => s + Number(i.subtotal), 0);
          const thisSubtotal = Number(invoice.subtotal);
          const thisOnCo = onCoTrack(invoice);
          const thisBase = thisOnCo ? 0 : thisSubtotal;

          const originalContract = Number(project.originalContractValue);
          const baseStill = originalContract - (priorBaseBilled + thisBase);

          // A revised-contract draw nets base + CO billing into ONE track —
          // splitting it here would show the base over-billed and the CO
          // untouched when this draw deliberately covered both.
          const billRevised = !!invoice.billAgainstRevised && !thisOnCo;
          const revisedContract = Number(project.contractValue);
          const priorAllBilled = priorToDate.reduce(
            (s, i) => s + Number(i.subtotal),
            0,
          );
          const revisedStill = revisedContract - priorAllBilled - thisSubtotal;

          // Prior billing grouped by the change order it was billed against,
          // so each CO can show its own remaining balance. A CO-track invoice
          // with no linked CO falls into the "other" bucket.
          const coTrackPriors = priorToDate.filter((i) => onCoTrack(i));
          const billedByCoId = new Map<string, number>();
          let unlinkedCoBilled = 0;
          for (const i of coTrackPriors) {
            if (i.changeOrderId) {
              billedByCoId.set(
                i.changeOrderId,
                (billedByCoId.get(i.changeOrderId) ?? 0) + Number(i.subtotal),
              );
            } else {
              unlinkedCoBilled += Number(i.subtotal);
            }
          }
          const thisCoId = thisOnCo ? invoice.changeOrderId : null;

          // Cumulative retainage withheld (net of releases) across all
          // non-void invoices on the project up to and including this one.
          const retainageHeldToDate =
            priorToDate.reduce(
              (s, i) =>
                s + Number(i.retainageAmount) - Number(i.retainageReleased),
              0,
            ) +
            (Number(invoice.retainageAmount) -
              Number(invoice.retainageReleased));

          const hasCoTrack =
            approvedCOs.length > 0 || coTrackPriors.length > 0 || thisOnCo;

          return (
            <Card>
              <CardHeader>
                <CardTitle>{template.progressBillingLabel}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                {billRevised ? (
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      Revised contract (base + change orders)
                    </p>
                    <Row
                      label="Contract value"
                      value={formatMoney(revisedContract)}
                    />
                    {priorAllBilled > 0 && (
                      <Row
                        label="Previously billed"
                        value={`(${formatMoney(priorAllBilled)})`}
                      />
                    )}
                    {thisSubtotal > 0 && (
                      <Row
                        label="This invoice"
                        value={`(${formatMoney(thisSubtotal)})`}
                      />
                    )}
                    <Row
                      label="Still billable"
                      value={formatMoney(revisedStill)}
                      bold
                    />
                    <p className="text-[11px] text-slate-400">
                      This invoice bills against the revised contract, so base
                      and change-order billing are netted into one track.
                    </p>
                  </div>
                ) : (
                <div className="space-y-1">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">
                    Base contract
                  </p>
                  <Row
                    label="Contract value"
                    value={formatMoney(originalContract)}
                  />
                  {priorBaseBilled > 0 && (
                    <Row
                      label="Previously billed"
                      value={`(${formatMoney(priorBaseBilled)})`}
                    />
                  )}
                  {thisBase > 0 && (
                    <Row
                      label="This invoice"
                      value={`(${formatMoney(thisBase)})`}
                    />
                  )}
                  <Row label="Still billable" value={formatMoney(baseStill)} bold />
                </div>
                )}

                {!billRevised && hasCoTrack && (
                  <div className="space-y-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      Change orders
                    </p>
                    {approvedCOs
                      .slice()
                      .sort(
                        (a, b) =>
                          new Date(a.createdAt).getTime() -
                          new Date(b.createdAt).getTime(),
                      )
                      .map((c) => {
                      const value = Number(c.total);
                      const prevBilled = billedByCoId.get(c.id) ?? 0;
                      const thisAmt = thisCoId === c.id ? thisSubtotal : 0;
                      const still = value - prevBilled - thisAmt;
                      return (
                        <div key={c.id} className="space-y-1">
                          <p className="text-xs font-medium text-slate-600">
                            {c.number}
                            {c.description ? ` · ${c.description}` : ''}
                          </p>
                          <Row label="Approved value" value={formatMoney(value)} />
                          {prevBilled > 0 && (
                            <Row
                              label="Previously billed"
                              value={`(${formatMoney(prevBilled)})`}
                            />
                          )}
                          {thisAmt > 0 && (
                            <Row
                              label="This invoice"
                              value={`(${formatMoney(thisAmt)})`}
                            />
                          )}
                          <Row
                            label="Still billable"
                            value={formatMoney(still)}
                            bold
                          />
                        </div>
                      );
                    })}
                    {unlinkedCoBilled > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-slate-600">
                          Other change-order billing
                        </p>
                        <Row
                          label="Billed"
                          value={`(${formatMoney(unlinkedCoBilled)})`}
                        />
                      </div>
                    )}
                  </div>
                )}

                {show('showRetainage') && retainageHeldToDate > 0 && (
                  <div className="pt-2 border-t border-slate-200">
                    <Row
                      label="Retainage held to date"
                      value={formatMoney(retainageHeldToDate)}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })()}

      {/* Phase 1: Account history — prior invoices for the same project. */}
      {template?.showAccountHistory && otherInvoices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{template.accountHistoryLabel}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice date</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">{template.vatLabel}</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {otherInvoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="text-slate-600">
                      {inv.invoiceDate}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-700">
                      {inv.number}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(inv.total)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {formatMoney(inv.taxAmount)}
                    </TableCell>
                    <TableCell className="text-slate-600 capitalize">
                      {inv.status}
                    </TableCell>
                    <TableCell className="text-slate-600 truncate max-w-xs">
                      {inv.notes ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Phase 1: Wire instructions. Pulls bank fields from the active
          company. Only renders if the template enables this section AND
          the company actually has banking data set. */}
      {template?.showWireInstructions &&
        (company.bankName ||
          company.bankAccountName ||
          company.bankAccountNumber) && (
          <Card>
            <CardHeader>
              <CardTitle>Wire instructions</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <div className="space-y-1">
                {company.bankName && (
                  <Row label="Bank name" value={company.bankName} />
                )}
                {company.bankBranch && (
                  <Row label="Branch" value={company.bankBranch} />
                )}
                {company.bankAccountName && (
                  <Row label="Account name" value={company.bankAccountName} />
                )}
                {company.bankAddress && (
                  <Row label="Address" value={company.bankAddress} />
                )}
                {company.bankAccountNumber && (
                  <Row
                    label="Account number"
                    value={company.bankAccountNumber}
                  />
                )}
              </div>
              {(company.paymentNotes || template.wireInstructionsNote) && (
                <p className="mt-3 text-slate-700 whitespace-pre-wrap">
                  {company.paymentNotes ?? template.wireInstructionsNote}
                </p>
              )}
            </CardContent>
          </Card>
        )}

      {/* Phase 1: Qualifications & exclusions block. */}
      {template?.showQualifications && template.qualificationsText && (
        <Card>
          <CardHeader>
            <CardTitle>Qualifications & exclusions</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap text-slate-800">
            {template.qualificationsText}
          </CardContent>
        </Card>
      )}

      {show('showRetainage') && template?.retainageText && (
        <Card>
          <CardHeader>
            <CardTitle>Retainage</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap text-slate-800">
            {template.retainageText}
          </CardContent>
        </Card>
      )}

      {show('showPaymentTerms') && (template?.paymentTermsText || invoice.termsOverride) && (
        <Card>
          <CardHeader>
            <CardTitle>Payment terms</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap text-slate-800">
            {invoice.termsOverride || template?.paymentTermsText}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Payment history ({payments.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {payments.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No payments recorded yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paid date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-slate-600">{p.paidDate}</TableCell>
                    <TableCell className="text-slate-700">{p.method ?? '—'}</TableCell>
                    <TableCell className="text-slate-700 font-mono text-xs">
                      {p.reference ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(p.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Credit memos ({creditMemos.length})</CardTitle>
            {creditAppliedToInvoice > 0 && (
              <div className="text-xs text-slate-500 tabular-nums">
                {formatMoney(creditAppliedToInvoice)} applied · net billed{' '}
                <span className="font-medium text-slate-900">
                  {formatMoney(netBilledAfterCredits)}
                </span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {creditMemos.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No credit memos issued against this invoice.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Applied</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creditMemos.map((cm) => (
                  <TableRow key={cm.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={{ pathname: `/credit-memos/${cm.id}` }}
                        className="text-blue-600 hover:underline"
                      >
                        {cm.number}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {cm.issueDate}
                    </TableCell>
                    <TableCell className="text-slate-700 text-xs capitalize">
                      {cm.status.replace('_', ' ')}
                    </TableCell>
                    <TableCell className="text-slate-700 text-xs">
                      {cm.reason}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(cm.amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {formatMoney(cm.appliedAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {show('showNotes') && (invoice.notes || template?.notesText) && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap text-slate-800">
            {invoice.notes ?? template?.notesText}
          </CardContent>
        </Card>
      )}

      <CompanyStandardTerms />

      {show('showSignature') && (
        <Card>
          <CardHeader>
            <CardTitle>Signature / approval</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="border border-dashed border-slate-300 rounded-md px-4 py-10 text-center text-slate-400">
              Awaiting customer acknowledgment
            </div>
          </CardContent>
        </Card>
      )}

      {show('showFooter') && template?.footerText && (
        <p className="text-xs text-slate-500 text-center pt-2 italic">
          {template.footerText}
        </p>
      )}

      <ActivityLogCard entityType="invoice" entityId={invoice.id} />
    </div>
  );
}

function KPI({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${
            highlight ? 'text-emerald-700' : 'text-slate-900'
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  bold,
  valueClassName,
}: {
  label: string;
  value: string;
  bold?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? 'pt-1 border-t border-slate-100' : ''}`}>
      <span className={bold ? 'text-slate-900 font-semibold' : 'text-slate-500'}>
        {label}
      </span>
      <span
        className={`tabular-nums ${
          valueClassName ?? (bold ? 'text-slate-900 font-semibold' : 'text-slate-900')
        }`}
      >
        {value}
      </span>
    </div>
  );
}
