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
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { formatMoney, parseMoney, subtract } from '@/lib/money';
import { getInvoice, getInvoiceLineItems } from '@/lib/data/invoices';
import { getInvoicePayments } from '@/lib/data/invoice-payments';
import { getInvoiceTemplate } from '@/lib/data/invoice-templates';
import { getChangeOrder } from '@/lib/data/change-orders';
import { getProposal } from '@/lib/data/proposals';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import { BILLING_TYPE_LABEL } from '@/modules/invoices/schema';
import { ActivityLogCard } from '@/modules/status/components/activity-log-card';
import { StatusBadge } from '@/modules/status/components/status-badge';
import { StatusPanel } from '@/modules/status/components/status-panel';

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

  const balance = subtract(parseMoney(invoice.total), parseMoney(invoice.amountPaid));

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
          {allowCreate && invoice.status === 'draft' && (
            <Link href={{ pathname: `/invoices/${invoice.id}/edit` }}>
              <Button size="sm" variant="outline">
                Edit
              </Button>
            </Link>
          )}
          {allowCreate && (
            <Link href="/invoices/new">
              <Button size="sm">New Invoice</Button>
            </Link>
          )}
        </div>
      </div>

      {show('showCompanyBranding') && <DocumentBranding />}

      <div className="flex items-start justify-between gap-4">
        <div>
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
                  {project.number}
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="Billing type" value={BILLING_TYPE_LABEL[invoice.billingType]} />
        <KPI label="Invoice date" value={invoice.invoiceDate} />
        <KPI label="Due" value={invoice.dueDate ?? '—'} />
        <KPI label="Total" value={formatMoney(invoice.total)} highlight />
      </div>

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
            <Row label="Subtotal" value={formatMoney(invoice.subtotal)} />
            {show('showTaxVat') && (
              <Row label="Tax / VAT" value={formatMoney(invoice.taxAmount)} />
            )}
            {show('showRetainage') && Number(invoice.retainageAmount) > 0 && (
              <>
                <Row
                  label={`Retainage held (${Number(invoice.retainagePercent).toFixed(2)}%)`}
                  value={`(${formatMoney(invoice.retainageAmount)})`}
                />
                {Number(invoice.retainageReleased) > 0 && (
                  <Row
                    label="Retainage released"
                    value={formatMoney(invoice.retainageReleased)}
                    valueClassName="text-emerald-700"
                  />
                )}
              </>
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
