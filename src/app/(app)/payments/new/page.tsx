import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listInvoices } from '@/lib/data/invoices';
import { listInvoicePaymentsForCompany } from '@/lib/data/invoice-payments';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import { PaymentForm } from '@/modules/payments/components/payment-form';

export const dynamic = 'force-dynamic';

async function nextPaymentNumber(companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const existing = await listInvoicePaymentsForCompany(companyId);
  const matching = existing
    .map((p) => p.paymentNumber)
    .filter((n) => n.startsWith(`PAY-${year}-`))
    .map((n) => Number(n.slice(`PAY-${year}-`.length)))
    .filter((n) => Number.isFinite(n));
  const next = (matching.length === 0 ? 0 : Math.max(...matching)) + 1;
  return `PAY-${year}-${String(next).padStart(3, '0')}`;
}

export default async function NewPaymentPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'payments')) redirect('/payments');
  const companyId = await getActiveCompanyId();

  // Show non-void invoices that aren't fully paid; sort by oldest first so the
  // most overdue invoice surfaces near the top.
  const invoices = (
    await Promise.all(
      (await listInvoices(companyId))
        .filter((i) => i.status !== 'void')
        .map(async (i) => {
          const project = await getProject(companyId, i.projectId);
          const customer = project
            ? await getCustomer(companyId, project.customerId)
            : undefined;
          return {
            id: i.id,
            number: i.number,
            projectName: project?.name ?? 'Unknown project',
            customerName: customer?.name ?? 'Unknown customer',
            total: i.total,
            amountPaid: i.amountPaid,
            invoiceDate: i.invoiceDate,
          };
        }),
    )
  )
    .filter((i) => Number(i.total) - Number(i.amountPaid) > 0)
    .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/payments', label: 'Payments' },
          { label: 'Record payment' },
        ]}
      />

      <Link href="/payments">
        <Button variant="outline" size="sm">
          ← Back to Payments
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Record payment</h1>
        <p className="text-sm text-slate-500 mt-1">
          Pick the invoice, enter the amount and method. The invoice's amount paid,
          balance due, and status update automatically when the payment is saved.
        </p>
      </header>

      <PaymentForm
        invoices={invoices}
        defaultPaymentNumber={await nextPaymentNumber(companyId)}
        defaultPaidDate={new Date().toISOString().slice(0, 10)}
      />
    </div>
  );
}
