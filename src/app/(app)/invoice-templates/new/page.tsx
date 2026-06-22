import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { getActiveRole } from '@/lib/active-role';
import { getActiveCompany } from '@/lib/active-company';
import { canCreate } from '@/lib/permissions';
import { InvoiceTemplateForm } from '@/modules/invoice-templates/components/template-form';

export const dynamic = 'force-dynamic';

export default async function NewInvoiceTemplatePage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'invoice_templates')) redirect('/invoice-templates');
  const company = await getActiveCompany();

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/invoice-templates', label: 'Invoice Templates' },
          { label: 'New template' },
        ]}
      />

      <Link href="/invoice-templates">
        <Button variant="outline" size="sm">
          ← Back to Templates
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">New invoice template</h1>
        <p className="text-sm text-slate-500 mt-1">
          Define which sections render and what standard text appears. Pick this
          template when creating new invoices for the active company.
        </p>
      </header>

      <InvoiceTemplateForm isVatActive={company.isVatActive} />
    </div>
  );
}
