import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { getActiveCompany, getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listInvoiceTemplates } from '@/lib/data/invoice-templates';
import { listInvoices } from '@/lib/data/invoices';
import { listChangeOrders } from '@/lib/data/change-orders';
import { listProposals } from '@/lib/data/proposals';
import { getCustomer } from '@/lib/data/customers';
import { listProjects } from '@/lib/data/projects';
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

  const projects = await Promise.all(
    (await listProjects(companyId)).map(async (p) => {
      const customer = await getCustomer(companyId, p.customerId);
      return {
        id: p.id,
        label: `${p.number} — ${p.name}${customer ? ` (${customer.name})` : ''}`,
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
        defaultNumber={await nextInvoiceNumber(companyId)}
        defaultInvoiceDate={today}
        defaultDueDate={due}
        companyVatRatePercent={Number(activeCompany.vatRatePercent)}
      />
    </div>
  );
}
