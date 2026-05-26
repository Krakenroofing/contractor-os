import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getCostCode, isGlobalCostCode } from '@/lib/data/cost-codes';
import { CATEGORY_LABEL, CATEGORY_TONE, type CostCodeCategory } from '@/modules/cost-codes/schema';
import { CostCodeEditForm } from '@/modules/cost-codes/components/cost-code-edit-form';
import { DIVISION_NAME_BY_CODE } from '@/lib/data/cost-code-defaults';

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
  const allowEdit = canCreate(role, 'cost_codes');
  const code = await getCostCode(companyId, id);
  if (!code) notFound();

  const isGlobal = isGlobalCostCode(code);
  const divisionLabel = code.division
    ? DIVISION_NAME_BY_CODE[code.division]
      ? `${code.division} — ${DIVISION_NAME_BY_CODE[code.division]}`
      : code.division
    : '—';

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
        {allowEdit && (
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
        <div className="flex flex-col items-end gap-2">
          <Badge tone={categoryTone(code.category)}>{categoryLabel(code.category)}</Badge>
          {isGlobal ? <Badge tone="blue">Global library</Badge> : <Badge tone="slate">Custom</Badge>}
          {code.isActive ? (
            <Badge tone="green">Active</Badge>
          ) : (
            <Badge tone="amber">Inactive</Badge>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cost code</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <Row label="Code" value={code.code} />
          <Row label="Name" value={code.description} />
          <Row label="Division" value={divisionLabel} />
          <Row label="Category" value={categoryLabel(code.category)} />
          <Row label="Sort order" value={String(code.sortOrder)} />
          <Row label="Status" value={code.isActive ? 'Active' : 'Inactive'} />
          <Row label="Source" value={isGlobal ? 'Global library (read-only)' : 'Company library'} />
          {code.notes && <Row label="Notes" value={code.notes} />}
        </CardContent>
      </Card>

      {allowEdit && !isGlobal && (
        <Card>
          <CardHeader>
            <CardTitle>Edit</CardTitle>
          </CardHeader>
          <CardContent>
            <CostCodeEditForm
              id={code.id}
              defaults={{
                description: code.description,
                category: code.category as CostCodeCategory,
                division: code.division,
                sortOrder: code.sortOrder,
                notes: code.notes,
                defaultCost: code.defaultCost,
              }}
            />
          </CardContent>
        </Card>
      )}

      {isGlobal && allowEdit && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-900">
          This code lives in the standard global library and is read-only. To
          customise it for your company, create a new code with a different
          identifier and use that one in estimates / POs going forward.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>How this code is used</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600 space-y-2">
          <p>
            Every estimate, PO, change order, and job-cost entry references a
            cost code. Job-cost actuals and change orders roll up by code so
            you can see budget vs. committed vs. actual on each project.
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
