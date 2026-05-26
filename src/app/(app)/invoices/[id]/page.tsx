import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
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
import { formatMoney, parseMoney, subtract } from '@/lib/money';
import {
  getInvoice,
  getInvoiceLineItems,
  listInvoicesForProject,
} from '@/lib/data/invoices';
import { getInvoicePayments } from '@/lib/data/invoice-payments';
import { getInvoiceTemplate } from '@/lib/data/invoice-templates';
import { getChangeOrder } from '@/lib/data/change-orders';
import { getProposal } from '@/lib/data/proposals';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
  const template = invoice.templateId
    ? await getInvoiceTemplate(companyId, invoice.templateId)
    : undefined;
  const lines = await getInvoiceLineItems(invoice.id);
  const payments = await getInvoicePayments(invoice.id);

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
  // Prior-billed split by contract source. When this invoice is tagged to
  // a CO, the progress block compares against billings on the SAME source
  // only — otherwise base-contract billings inflate the "prior billed"
  // figure on a CO invoice and the % calc is meaningless.
  const priorOnSameSource = otherInvoices
    .filter((i) => i.invoiceDate <= invoice.invoiceDate)
    .filter((i) => (i.changeOrderId ?? null) === (invoice.changeOrderId ?? null))
    .reduce((sum, i) => sum + Number(i.total), 0);
  // Kept for backwards compatibility with code paths that still read the
  // whole-project figure. Most callers should prefer priorOnSameSource.
  const priorBilledOnProject = otherInvoices
    .filter((i) => i.invoiceDate <= invoice.invoiceDate)
    .reduce((sum, i) => sum + Number(i.total), 0);
  void priorBilledOnProject;

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
          { href: '/invoices', label: 'Invoices' },
          { label: invoice.number },
        ]}
      />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link href="/invoices">
          <Button variant="outline" size="sm">
            ← Back to Invoices
          </Button>
        </Link>
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
            <Row label="Subtotal" value={formatMoney(invoice.subtotal)} />
            {show('showRetainage') && Number(invoice.retainageAmount) > 0 && (
              <>
                <Row
                  label={`Less ${template?.retainageHeldLabel?.toLowerCase() ?? 'retainage held'} (${Number(invoice.retainagePercent).toFixed(2)}%)`}
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
            {show('showTaxVat') && (
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
            <Row label="Net amount due" value={formatMoney(invoice.total)} bold />
            <Row label="Amount paid" value={formatMoney(invoice.amountPaid)} />
            <Row
              label="Balance due"
              value={formatMoney(balance)}
              bold
              valueClassName={
                balance <= 0 ? 'text-emerald-700' : 'text-amber-700'
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Phase 1: Progress billing summary. When the invoice is tagged to a
          specific CO, the denominator is that CO's value alone — otherwise
          we'd compare CO-3 billings to (base + every CO), which always
          understates the % billed. Base-contract invoices compare against
          the original contract (NOT contract + COs) for the same reason. */}
      {template?.showProgressBilling && project && (() => {
        const sourceValue = invoice.changeOrderId && co
          ? Number(co.total)
          : Number(project.originalContractValue);
        const sourceLabel = co
          ? `Bills against ${co.number}`
          : 'Bills against base contract';
        const sourceValueLabel = co
          ? `${co.number} value`
          : template.contractValueLabel;
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle>{template.progressBillingLabel}</CardTitle>
                <span className="text-xs uppercase tracking-wide text-slate-500">
                  {sourceLabel}
                </span>
              </div>
            </CardHeader>
            <CardContent className="text-sm">
              <div className="space-y-1">
                <Row
                  label={template.contractValueLabel}
                  value={formatMoney(project.originalContractValue)}
                />
                <Row
                  label={template.changeOrdersLabel}
                  value={formatMoney(project.totalChangeOrders)}
                />
                <Row
                  label="Revised project value"
                  value={formatMoney(project.contractValue)}
                />
                <Row
                  label={sourceValueLabel}
                  value={formatMoney(sourceValue)}
                  bold
                />
                <Row
                  label={`% billed against ${co ? co.number : 'base contract'} (this invoice)`}
                  value={
                    sourceValue > 0
                      ? `${(
                          (Number(invoice.subtotal) / sourceValue) *
                          100
                        ).toFixed(2)}%`
                      : '—'
                  }
                />
                <Row
                  label={`${template.priorBilledLabel} (${co ? co.number : 'base contract'})`}
                  value={`(${formatMoney(priorOnSameSource)})`}
                />
                {Number(invoice.retainageAmount) > 0 && (
                  <Row
                    label={template.retainageHeldLabel}
                    value={`(${formatMoney(invoice.retainageAmount)})`}
                  />
                )}
                <Row
                  label="Invoice subtotal"
                  value={formatMoney(invoice.subtotal)}
                />
                {vatRatePct > 0 && (
                  <Row
                    label={`${template.vatLabel} (${vatRatePct.toFixed(2)}%)`}
                    value={formatMoney(vatAmount)}
                  />
                )}
                <Row
                  label="Invoice final total"
                  value={formatMoney(invoice.total)}
                  bold
                />
              </div>
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
                    <TableCell className="font-mono text-xs text-slate-700">
                      {cm.number}
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
