import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { InvoiceHeaderEditForm } from '@/modules/invoices/components/invoice-header-edit-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getInvoice } from '@/lib/data/invoices';

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

  // Only drafts are editable. Non-drafts have payments / retainage / sent
  // timestamps depending on them — go through the status panel instead.
  if (invoice.status !== 'draft') {
    redirect(`/invoices/${id}` as never);
  }

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/invoices', label: 'Invoices' },
          { href: `/invoices/${invoice.id}`, label: invoice.number },
          { label: 'Edit' },
        ]}
      />

      <Link href={{ pathname: `/invoices/${invoice.id}` }}>
        <Button variant="outline" size="sm">
          ← Back to invoice
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Edit invoice</h1>
        <p className="text-sm text-slate-500 mt-1">
          Header-only edit. Line items, totals, and retainage amounts aren&apos;t
          editable here — re-create the invoice from scratch if you need to
          change them. Invoice number is locked.
        </p>
      </header>

      <InvoiceHeaderEditForm
        id={invoice.id}
        initial={{
          invoiceDate: invoice.invoiceDate,
          dueDate: invoice.dueDate ?? '',
          billingType: invoice.billingType,
          expectedRetainageReleaseDate:
            invoice.expectedRetainageReleaseDate ?? '',
          notes: invoice.notes ?? '',
          termsOverride: invoice.termsOverride ?? '',
        }}
      />
    </div>
  );
}
