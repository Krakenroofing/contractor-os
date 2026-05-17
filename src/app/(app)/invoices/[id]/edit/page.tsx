import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { InvoiceEditForm } from '@/modules/invoices/components/invoice-edit-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getInvoice, getInvoiceLineItems } from '@/lib/data/invoices';
import { getProject } from '@/lib/data/projects';
import { getCustomer } from '@/lib/data/customers';
import { listChangeOrdersForProject } from '@/lib/data/change-orders';

export const dynamic = 'force-dynamic';

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const role = await getActiveRole();
  if (!canCreate(role, 'invoices')) redirect('/invoices');

  const companyId = await getActiveCompanyId();
  const invoice = await getInvoice(companyId, id);
  if (!invoice) notFound();

  // Voided invoices are immutable. Everything else can be edited — payment
  // links survive across edits and recompute reconciles status against the
  // new total.
  if (invoice.status === 'void') {
    redirect(`/invoices/${id}` as never);
  }

  const project = await getProject(companyId, invoice.projectId);
  const customer = project
    ? await getCustomer(companyId, project.customerId)
    : undefined;
  const lines = await getInvoiceLineItems(invoice.id);
  // Load every CO on the project so the operator can retroactively tag this
  // invoice as billing against a specific CO (or null = base contract).
  const projectChangeOrders = await listChangeOrdersForProject(invoice.projectId);

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/invoices', label: 'Invoices' },
          { href: `/invoices/${invoice.id}`, label: invoice.number },
          { label: 'Edit' },
        ]}
      />

      <div className="flex items-center justify-between">
        <Link href={{ pathname: `/invoices/${invoice.id}` }}>
          <Button variant="outline" size="sm">
            ← Back to invoice
          </Button>
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Edit invoice</h1>
        <p className="text-sm text-slate-500 mt-1">
          Edit line items, totals, retainage, tax, and dates. Existing payments
          stay linked; balance and status auto-derive against the new total.
        </p>
      </header>

      <InvoiceEditForm
        initial={{
          id: invoice.id,
          number: invoice.number,
          projectId: invoice.projectId,
          projectLabel: project?.name ?? 'Unknown project',
          customerLabel: customer?.name ?? 'Unknown customer',
          status: invoice.status,
          billingType: invoice.billingType,
          changeOrderId: invoice.changeOrderId ?? '',
          invoiceDate: invoice.invoiceDate,
          dueDate: invoice.dueDate ?? '',
          taxAmount: invoice.taxAmount,
          retainagePercent: invoice.retainagePercent,
          retainageAmount: invoice.retainageAmount,
          expectedRetainageReleaseDate: invoice.expectedRetainageReleaseDate ?? '',
          amountPaid: invoice.amountPaid,
          notes: invoice.notes ?? '',
          termsOverride: invoice.termsOverride ?? '',
          purchaseOrderNumber: invoice.purchaseOrderNumber ?? '',
          billingLabel: invoice.billingLabel ?? '',
          lines: lines.map((l) => ({
            description: l.description,
            unit: l.unit ?? '',
            quantity: Number(l.quantity).toString(),
            unitCost: Number(l.unitCost).toString(),
          })),
        }}
        changeOrderOptions={projectChangeOrders.map((co) => ({
          id: co.id,
          label: `${co.number} — ${co.description.slice(0, 60)}`,
        }))}
      />
    </div>
  );
}
