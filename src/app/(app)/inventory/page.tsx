import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listInventoryItems } from '@/lib/data/inventory-items';
import { getOnHandMap } from '@/lib/data/inventory-movements';
import { ProductsListClient } from '@/modules/inventory/components/products-list-client';
import { CategoryCostCodesCard } from '@/modules/inventory/components/category-cost-codes-card';
import { listCategoryCostCodes } from '@/lib/data/vendor-item-numbers';
import { listCostCodes } from '@/lib/data/cost-codes';

export const dynamic = 'force-dynamic';

export default async function InventoryPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'inventory');
  const items = await listInventoryItems(companyId, { includeArchived: true });
  const onHandMap = await getOnHandMap(
    companyId,
    items.map((i) => i.id),
  );
  const rows = items.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    sku: p.sku,
    unit: p.unit,
    defaultCost: Number(p.defaultCost),
    isTaxable: p.isTaxable,
    archived: p.archivedAt !== null,
    onHand: onHandMap.get(p.id) ?? 0,
  }));

  const activeCount = rows.filter((r) => !r.archived).length;

  // Category defaults (roadmap P4) — one row per category in use.
  const [categoryDefaults, costCodes] = await Promise.all([
    listCategoryCostCodes(companyId),
    listCostCodes(companyId),
  ]);
  const catCounts = new Map<string, number>();
  for (const it of items) {
    const c = it.category?.trim();
    if (c && !it.archivedAt) catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  const categories = [...catCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, count]) => ({
      category,
      count,
      costCodeId: categoryDefaults.get(category.toLowerCase()) ?? null,
    }));
  const costCodeOptions = costCodes.map((c) => ({
    id: c.id,
    label: `${c.code} — ${c.description}`,
  }));

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Inventory</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {activeCount} active {activeCount === 1 ? 'product' : 'products'}
            {rows.length !== activeCount && ` • ${rows.length - activeCount} archived`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {allowCreate && (
            <Link href="/inventory/locations">
              <Button variant="outline">Manage locations</Button>
            </Link>
          )}
          {allowCreate && (
            <Link href="/inventory/import">
              <Button variant="outline">Import from QuickBooks</Button>
            </Link>
          )}
          {allowCreate && (
            <Link href="/inventory/new">
              <Button>New Product</Button>
            </Link>
          )}
        </div>
      </header>

      <CategoryCostCodesCard
        categories={categories}
        costCodes={costCodeOptions}
        canEdit={allowCreate}
      />

      <ProductsListClient products={rows} />
    </div>
  );
}
