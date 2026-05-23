import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/money';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getInventoryItem } from '@/lib/data/inventory-items';
import { ArchiveProductForm } from '@/modules/inventory/components/archive-product-form';

export const dynamic = 'force-dynamic';

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowEdit = canCreate(role, 'inventory');
  const item = await getInventoryItem(companyId, id);
  if (!item) notFound();

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/inventory', label: 'Products' },
          { label: item.name },
        ]}
      />

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{item.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
            {item.category && <span>{item.category}</span>}
            {item.archivedAt && <Badge tone="slate">Archived</Badge>}
            {!item.archivedAt &&
              (item.isTaxable ? (
                <Badge tone="blue">Taxable</Badge>
              ) : (
                <Badge tone="slate">Exempt</Badge>
              ))}
          </div>
        </div>
        {allowEdit && (
          <div className="flex items-center gap-2">
            <Link href={`/inventory/${item.id}/edit`}>
              <Button variant="outline">Edit</Button>
            </Link>
            <ArchiveProductForm
              id={item.id}
              archived={item.archivedAt !== null}
            />
          </div>
        )}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <Pair label="SKU" value={item.sku ?? '—'} />
            <Pair label="Unit" value={item.unit ?? '—'} />
            <Pair label="Default cost" value={formatMoney(item.defaultCost)} />
            <Pair
              label="QuickBooks expense account"
              value={item.qbGlAccountText ?? '—'}
            />
          </dl>
          {item.notes && (
            <div className="mt-4 border-t pt-4 text-sm">
              <div className="text-slate-500 mb-1">Notes</div>
              <div className="text-slate-800 whitespace-pre-wrap">{item.notes}</div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  );
}
