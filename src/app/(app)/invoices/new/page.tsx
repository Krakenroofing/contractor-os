import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { getActiveCompany, getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listInvoiceTemplates } from '@/lib/data/invoice-templates';
import { listInventoryItems } from '@/lib/data/inventory-items';
import {
  listInvoices,
  listInvoicesForProject,
} from '@/lib/data/invoices';
import { listChangeOrders } from '@/lib/data/change-orders';
import { listProposals } from '@/lib/data/proposals';
import { getCustomer } from '@/lib/data/customers';
import { listProjects } from '@/lib/data/projects';
import { parseMoney } from '@/lib/money';
import { normalizeStatus } from '@/lib/status-machine';
import { InvoiceForm } from '@/modules/invoices/components/invoice-form';

export const dynamic = 'force-dynamic';

async function nextInvoiceNumber(companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const existing = await listInvoices(companyId);
  const matching = existing
    .map((i) => i.number)
    .filter((n) => n.startsWith(`INV-${year}-`))
    .map((n) => Number(n.slice(`INV-${year}-`.length)))
    .filter((n) => Number.isFinite(n));
  const next = (matching.length === 0 ? 0 : Math.max(...matching)) + 1;
  return `INV-${year}-${String(next).padStart(3, '0')}`;
}

export default async function NewInvoicePage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'invoices')) redirect('/invoices');
  const companyId = await getActiveCompanyId();
  const activeCompany = await getActiveCompany();

  // For each project, also bundle: contract value, sum of prior billed
  // (gross + net), and prior invoice count. The form uses these to power
  // the progress-billing breakdown when the operator enters a % of contract
  // — auto-computing this invoice's subtotal as `cum - prior_billed_gross`,
  // and showing the "Less previously paid" / "Less retention" rollups.
  const projects = await Promise.all(
    (await listProjects(companyId)).map(async (p) => {
      const customer = await getCustomer(companyId, p.customerId);
      const prior = (await listInvoicesForProject(p.id)).filter(
        (i) => normalizeStatus('invoice', i.status) !== 'void',
      );
      const priorBilledGross = prior.reduce(
        (acc, i) => acc + parseMoney(i.subtotal),
        0,
      );
      const priorBilledNet = prior.reduce(
        (acc, i) =>
          acc + (parseMoney(i.subtotal) - parseMoney(i.retainageAmount)),
        0,
      );
      // Default retention % from the most-recent prior invoice — saves the
      // operator from re-typing the same number for each draw. Falls back
      // to undefined if no priors exist (the form leaves the field blank).
      const sortedPrior = [...prior].sort((a, b) =>
        b.invoiceDate.localeCompare(a.invoiceDate),
      );
      const lastRetainagePercent =
        sortedPrior.length > 0
          ? Number(sortedPrior[0].retainagePercent)
          : undefined;
      return {
        id: p.id,
        label: `${p.name}${customer ? ` (${customer.name})` : ''}`,
        contractValue: parseMoney(p.contractValue),
        priorBilledGross: Math.round(priorBilledGross * 100) / 100,
        priorBilledNet: Math.round(priorBilledNet * 100) / 100,
        priorInvoiceCount: prior.length,
        lastRetainagePercent,
      };
    }),
  );
  const proposals = (await listProposals(companyId)).map((p) => ({
    id: p.id,
    projectId: p.projectId,
    label: p.number,
  }));
  const changeOrders = (await listChangeOrders(companyId)).map((c) => ({
    id: c.id,
    projectId: c.projectId,
    label: c.number,
  }));
  const templates = (await listInvoiceTemplates(companyId)).map((t) => ({
    id: t.id,
    name: t.name,
    // Every section flag the template owns. The form hides/shows fields,
    // labels them with the template's overrides, and renders a summary card
    // so the operator can see exactly which sections will appear on the
    // resulting invoice PDF.
    showCompanyBranding: t.showCompanyBranding,
    showHeader: t.showHeader,
    showLineItems: t.showLineItems,
    showPaymentTerms: t.showPaymentTerms,
    showRetainage: t.showRetainage,
    showTaxVat: t.showTaxVat,
    showNotes: t.showNotes,
    showSignature: t.showSignature,
    showFooter: t.showFooter,
    showBillToTin: t.showBillToTin,
    showProjectMetadata: t.showProjectMetadata,
    showWireInstructions: t.showWireInstructions,
    showQualifications: t.showQualifications,
    showAccountHistory: t.showAccountHistory,
    showProgressBilling: t.showProgressBilling,
    lineItemLayout: t.lineItemLayout,
    // Render previews (so the operator can see what will land on the PDF)
    qualificationsText: t.qualificationsText ?? '',
    wireInstructionsNote: t.wireInstructionsNote ?? '',
    // Label overrides used by the project-metadata input fields.
    poNumberLabel: t.poNumberLabel ?? '',
    billingNumberLabel: t.billingNumberLabel ?? '',
  }));

  const products = (await listInventoryItems(companyId)).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    sku: p.sku,
    unit: p.unit,
    defaultCost: Number(p.defaultCost),
  }));

  const today = new Date().toISOString().slice(0, 10);
  const due = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().slice(0, 10);
  })();

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/invoices', label: 'Invoices' },
          { label: 'New invoice' },
        ]}
      />

      <Link href="/invoices">
        <Button variant="outline" size="sm">
          ← Back to Invoices
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">New invoice</h1>
        <p className="text-sm text-slate-500 mt-1">
          Bill against a project. Pick a template to control which sections render on
          the invoice document.
        </p>
      </header>

      <InvoiceForm
        projects={projects}
        proposals={proposals}
        changeOrders={changeOrders}
        templates={templates}
        products={products}
        defaultNumber={await nextInvoiceNumber(companyId)}
        defaultInvoiceDate={today}
        defaultDueDate={due}
        companyVatRatePercent={Number(activeCompany.vatRatePercent)}
      />
    </div>
  );
}
