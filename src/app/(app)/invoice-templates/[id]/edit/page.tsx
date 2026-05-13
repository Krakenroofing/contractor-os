import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getInvoiceTemplate } from '@/lib/data/invoice-templates';
import { InvoiceTemplateForm } from '@/modules/invoice-templates/components/template-form';

export const dynamic = 'force-dynamic';

export default async function EditInvoiceTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const role = await getActiveRole();
  if (!canCreate(role, 'invoice_templates')) redirect('/invoice-templates');
  const companyId = await getActiveCompanyId();
  const tpl = await getInvoiceTemplate(companyId, id);
  if (!tpl) notFound();

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <Breadcrumbs
        items={[
          { href: '/invoice-templates', label: 'Invoice Templates' },
          { href: `/invoice-templates/${tpl.id}`, label: tpl.name },
          { label: 'Edit' },
        ]}
      />

      <Link href={`/invoice-templates/${tpl.id}`}>
        <Button variant="outline" size="sm">
          ← Back to Template
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Edit template: {tpl.name}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Updates apply to every invoice that uses this template — the next
          time the invoice is opened or downloaded.
        </p>
      </header>

      <InvoiceTemplateForm editId={tpl.id} defaults={tpl} />
    </div>
  );
}
