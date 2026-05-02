import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getCostCode } from '@/lib/data/cost-codes';
import { CATEGORY_LABEL, CATEGORY_TONE, type CostCodeCategory } from '@/modules/cost-codes/schema';

export const dynamic = 'force-dynamic';

function categoryTone(c: string) {
  return (CATEGORY_TONE as Record<string, (typeof CATEGORY_TONE)[CostCodeCategory]>)[c] ?? 'slate';
}

function categoryLabel(c: string) {
  return (CATEGORY_LABEL as Record<string, string>)[c] ?? c;
}

export default async function CostCodeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'cost_codes');
  const code = await getCostCode(companyId, id);
  if (!code) notFound();

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <Breadcrumbs
        items={[
          { href: '/cost-codes', label: 'Cost Codes' },
          { label: code.code },
        ]}
      />

      <div className="flex items-center justify-between">
        <Link href="/cost-codes">
          <Button variant="outline" size="sm">
            ← Back to Cost Codes
          </Button>
        </Link>
        {allowCreate && (
          <Link href="/cost-codes/new">
            <Button size="sm">New Cost Code</Button>
          </Link>
        )}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-slate-500">{code.code}</p>
          <h1 className="text-2xl font-semibold text-slate-900">{code.description}</h1>
        </div>
        <Badge tone={categoryTone(code.category)}>{categoryLabel(code.category)}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cost code</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <Row label="Code" value={code.code} />
          <Row label="Name" value={code.description} />
          <Row label="Category" value={categoryLabel(code.category)} />
          <Row label="Library" value="Default" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How this code is used</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600 space-y-2">
          <p>
            Once estimates and POs are wired up, every line item references a cost code.
            Job-cost actuals and change orders roll up by code so you can see budget vs.
            committed vs. actual on each project.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Estimate line items pick a code per row</li>
            <li>POs commit material / subcontract dollars to the code</li>
            <li>Labor entries post hours × rate to a labor code</li>
            <li>Change orders adjust budget on existing codes</li>
          </ul>
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
