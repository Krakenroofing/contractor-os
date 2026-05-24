import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getInventoryItem } from '@/lib/data/inventory-items';
import { listCostCodes } from '@/lib/data/cost-codes';
import { ProductForm } from '@/modules/inventory/components/product-form';

export const dynamic = 'force-dynamic';

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) redirect('/inventory');
  const companyId = await getActiveCompanyId();
  const [item, costCodes] = await Promise.all([
    getInventoryItem(companyId, id),
    listCostCodes(companyId),
  ]);
  if (!item) notFound();

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/inventory', label: 'Inventory' },
          { href: `/inventory/${item.id}`, label: item.name },
          { label: 'Edit' },
        ]}
      />
      <Link href={`/inventory/${item.id}`}>
        <Button variant="outline" size="sm">
          ← Back to {item.name}
        </Button>
      </Link>
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Edit product</h1>
      </header>
      <ProductForm
        mode={{ kind: 'edit', id: item.id }}
        initial={{
          id: item.id,
          name: item.name,
          category: item.category ?? '',
          sku: item.sku ?? '',
          unit: item.unit ?? '',
          defaultCost: Number(item.defaultCost).toString(),
          defaultCostCodeId: item.defaultCostCodeId ?? '',
          isTaxable: item.isTaxable ? 'yes' : 'no',
          qbGlAccountText: item.qbGlAccountText ?? '',
          notes: item.notes ?? '',
        }}
        costCodes={costCodes.map((c) => ({
          id: c.id,
          label: `${c.code} — ${c.description}`,
        }))}
      />
    </div>
  );
}
