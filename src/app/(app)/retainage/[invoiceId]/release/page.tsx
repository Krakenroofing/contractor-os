import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getInvoice, listInvoices } from '@/lib/data/invoices';
import { getInvoicePayments } from '@/lib/data/invoice-payments';
import { listRetainageReleases } from '@/lib/data/retainage-releases';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import {
  RetainageReleaseForm,
  type RetainageInvoiceOption,
  type RetainagePaymentOption,
} from '@/modules/retainage/components/release-form';

export const dynamic = 'force-dynamic';

async function nextReleaseNumber(companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const existing = await listRetainageReleases(companyId);
  const matching = existing
    .map((r) => r.releaseNumber)
    .filter((n) => n.startsWith(`RTN-${year}-`))
    .map((n) => Number(n.slice(`RTN-${year}-`.length)))
    .filter((n) => Number.isFinite(n));
  const next = (matching.length === 0 ? 0 : Math.max(...matching)) + 1;
  return `RTN-${year}-${String(next).padStart(3, '0')}`;
}

export default async function NewRetainageReleasePage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const role = await getActiveRole();
  if (!canCreate(role, 'retainage')) redirect('/retainage');
  const companyId = await getActiveCompanyId();

  const { invoiceId } = await params;
  const targetInvoice = await getInvoice(companyId, invoiceId);
  if (!targetInvoice) redirect('/retainage');

  // Build the dropdown of invoices that still have retainage to release.
  const invoiceOptions: RetainageInvoiceOption[] = (
    await Promise.all(
      (await listInvoices(companyId))
        .filter(
          (i) =>
            i.status !== 'void' &&
            Number(i.retainageAmount) - Number(i.retainageReleased) > 0,
        )
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
            retainageAmount: i.retainageAmount,
            retainageReleased: i.retainageReleased,
            expectedReleaseDate: i.expectedRetainageReleaseDate,
          };
        }),
    )
  ).sort((a, b) => a.number.localeCompare(b.number));

  // Ensure the targeted invoice is in the option list even if its balance is
  // already zero (so the form still resolves the default selection).
  if (!invoiceOptions.some((i) => i.id === targetInvoice.id)) {
    const project = await getProject(companyId, targetInvoice.projectId);
    const customer = project
      ? await getCustomer(companyId, project.customerId)
      : undefined;
    invoiceOptions.unshift({
      id: targetInvoice.id,
      number: targetInvoice.number,
      projectName: project?.name ?? 'Unknown project',
      customerName: customer?.name ?? 'Unknown customer',
      retainageAmount: targetInvoice.retainageAmount,
      retainageReleased: targetInvoice.retainageReleased,
      expectedReleaseDate: targetInvoice.expectedRetainageReleaseDate,
    });
  }

  // Payments belonging to the target invoice (offered as optional link).
  const payments: RetainagePaymentOption[] = (
    await getInvoicePayments(targetInvoice.id)
  ).map((p) => ({
    id: p.id,
    paymentNumber: p.paymentNumber,
    paidDate: p.paidDate,
    amount: p.amount,
    invoiceId: p.invoiceId,
  }));

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/retainage', label: 'Retainage' },
          { label: 'Release retainage' },
        ]}
      />

      <Link href="/retainage">
        <Button variant="outline" size="sm">
          ← Back to Retainage
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Release retainage</h1>
        <p className="text-sm text-slate-500 mt-1">
          Pick the invoice, enter the release amount, and optionally link a payment.
          The invoice's released total and the project's retainage balance update
          automatically when the release is saved.
        </p>
      </header>

      <RetainageReleaseForm
        invoices={invoiceOptions}
        payments={payments}
        defaultReleaseNumber={await nextReleaseNumber(companyId)}
        defaultReleaseDate={new Date().toISOString().slice(0, 10)}
        defaultInvoiceId={targetInvoice.id}
      />
    </div>
  );
}
