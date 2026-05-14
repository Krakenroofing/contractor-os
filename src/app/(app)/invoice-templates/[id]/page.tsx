import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getInvoiceTemplate } from '@/lib/data/invoice-templates';
import {
  HEADER_LAYOUT_LABEL,
  LINE_ITEM_LAYOUT_LABEL,
  SECTION_LABEL,
} from '@/modules/invoice-templates/schema';
import { SetDefaultTemplateButton } from '@/modules/invoice-templates/components/set-default-button';

export const dynamic = 'force-dynamic';

export default async function InvoiceTemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowEdit = canCreate(role, 'invoice_templates');
  const tpl = await getInvoiceTemplate(companyId, id);
  if (!tpl) notFound();

  const sections: Array<keyof typeof SECTION_LABEL> = [
    'showCompanyBranding',
    'showHeader',
    'showBillToTin',
    'showProjectMetadata',
    'showLineItems',
    'showTaxVat',
    'showRetainage',
    'showProgressBilling',
    'showQualifications',
    'showPaymentTerms',
    'showWireInstructions',
    'showNotes',
    'showAccountHistory',
    'showSignature',
    'showFooter',
  ];

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <Breadcrumbs
        items={[
          { href: '/invoice-templates', label: 'Invoice Templates' },
          { label: tpl.name },
        ]}
      />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link href="/invoice-templates">
          <Button variant="outline" size="sm">
            ← Back to Templates
          </Button>
        </Link>
        {allowEdit && (
          <div className="flex items-center gap-2">
            <SetDefaultTemplateButton
              templateId={tpl.id}
              isDefault={tpl.isDefault}
            />
            <Link href={{ pathname: `/invoice-templates/${tpl.id}/edit` }}>
              <Button size="sm" variant="outline">
                Edit
              </Button>
            </Link>
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{tpl.name}</h1>
          {tpl.description && (
            <p className="text-sm text-slate-600 mt-1">{tpl.description}</p>
          )}
        </div>
        {tpl.isDefault && <Badge tone="green">Default</Badge>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Layout</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <Row
            label="Header layout"
            value={
              HEADER_LAYOUT_LABEL[
                tpl.headerLayout as keyof typeof HEADER_LAYOUT_LABEL
              ] ?? tpl.headerLayout
            }
          />
          <Row
            label="Line item layout"
            value={
              LINE_ITEM_LAYOUT_LABEL[
                tpl.lineItemLayout as keyof typeof LINE_ITEM_LAYOUT_LABEL
              ] ?? tpl.lineItemLayout
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Section visibility</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-y-1 gap-x-4">
            {sections.map((key) => {
              const on = Boolean(tpl[key]);
              return (
                <li key={key} className="flex items-center justify-between">
                  <span className="text-slate-700">{SECTION_LABEL[key]}</span>
                  <Badge tone={on ? 'green' : 'slate'}>{on ? 'Visible' : 'Hidden'}</Badge>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Standard text</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-4">
          <TextBlock label="Header note" body={tpl.headerNote} />
          <TextBlock label="Payment terms" body={tpl.paymentTermsText} />
          <TextBlock label="Retainage" body={tpl.retainageText} />
          <TextBlock label="Notes" body={tpl.notesText} />
          <TextBlock label="Footer" body={tpl.footerText} />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-900">{value}</span>
    </div>
  );
}

function TextBlock({ label, body }: { label: string; body: string | null }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">{label}</p>
      {body && body.trim() !== '' ? (
        <p className="whitespace-pre-wrap text-slate-800">{body}</p>
      ) : (
        <p className="text-slate-400 text-sm">Not set</p>
      )}
    </div>
  );
}
