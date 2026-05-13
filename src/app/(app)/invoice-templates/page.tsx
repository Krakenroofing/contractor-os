import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { isDevDemoMode } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { listInvoiceTemplates } from '@/lib/data/invoice-templates';
import {
  HEADER_LAYOUT_LABEL,
  LINE_ITEM_LAYOUT_LABEL,
} from '@/modules/invoice-templates/schema';
import { SetDefaultTemplateButton } from '@/modules/invoice-templates/components/set-default-button';

export const dynamic = 'force-dynamic';

export default async function InvoiceTemplatesPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'invoice_templates');

  const templates = await listInvoiceTemplates(companyId);

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      {isDevDemoMode() && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
          Demo mode — invoice templates are scoped per company. Pick a template when
          creating an invoice to control which sections render on the document.
        </div>
      )}

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Invoice Templates</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {templates.length} {templates.length === 1 ? 'template' : 'templates'}
          </p>
        </div>
        {allowCreate && (
          <Link href="/invoice-templates/new">
            <Button>New Template</Button>
          </Link>
        )}
      </header>

      {templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">No invoice templates yet.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Header</TableHead>
                <TableHead>Line items</TableHead>
                <TableHead>Default</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium text-slate-900">{t.name}</TableCell>
                  <TableCell className="text-slate-600 text-sm">
                    {t.description ?? '—'}
                  </TableCell>
                  <TableCell className="text-slate-600 text-sm">
                    {HEADER_LAYOUT_LABEL[
                      t.headerLayout as keyof typeof HEADER_LAYOUT_LABEL
                    ] ?? t.headerLayout}
                  </TableCell>
                  <TableCell className="text-slate-600 text-sm">
                    {LINE_ITEM_LAYOUT_LABEL[
                      t.lineItemLayout as keyof typeof LINE_ITEM_LAYOUT_LABEL
                    ] ?? t.lineItemLayout}
                  </TableCell>
                  <TableCell>
                    {t.isDefault ? (
                      <Badge tone="green">Default</Badge>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      {allowCreate && (
                        <SetDefaultTemplateButton
                          templateId={t.id}
                          isDefault={t.isDefault}
                        />
                      )}
                      <Link href={`/invoice-templates/${t.id}`}>
                        <Button size="sm" variant="outline">
                          View
                        </Button>
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
