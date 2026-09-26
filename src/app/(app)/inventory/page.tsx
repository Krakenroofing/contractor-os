import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  derivedSuppliersByItem,
  listInventoryItems,
} from '@/lib/data/inventory-items';
import { listVendors } from '@/lib/data/vendors';
import { getOnHandMap } from '@/lib/data/inventory-movements';
import { ProductsListClient } from '@/modules/inventory/components/products-list-client';
import { CategoryCostCodesCard } from '@/modules/inventory/components/category-cost-codes-card';
import {
  listCategoryDefaults,
  listInventoryCategories,
} from '@/lib/data/vendor-item-numbers';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { costAccountOptions } from '@/modules/accounting/lib/cost-account-options';
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
  const [derived, vendors] = await Promise.all([
    derivedSuppliersByItem(companyId),
    listVendors(companyId),
  ]);
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  const managedForGroups = await listInventoryCategories(companyId);
  const groupOfCategory = new Map(
    managedForGroups.map((c) => [c.name.toLowerCase(), c.group]),
  );
  const rows = items.map((p) => ({
    ...(p.supplierVendorId && vendorName.has(p.supplierVendorId)
      ? {
          supplierName: vendorName.get(p.supplierVendorId)!,
          supplierSource: 'set' as const,
          supplierPoNumber: null,
        }
      : derived.has(p.id)
        ? {
            supplierName: derived.get(p.id)!.vendorName,
            supplierSource: 'po' as const,
            supplierPoNumber: derived.get(p.id)!.poNumber,
          }
        : { supplierName: null, supplierSource: null, supplierPoNumber: null }),
    id: p.id,
    name: p.name,
    category: p.category,
    group: p.category ? (groupOfCategory.get(p.category.trim().toLowerCase()) ?? null) : null,
    sku: p.sku,
    unit: p.unit,
    defaultCost: Number(p.defaultCost),
    isTaxable: p.isTaxable,
    archived: p.archivedAt !== null,
    onHand: onHandMap.get(p.id) ?? 0,
  }));

  const activeCount = rows.filter((r) => !r.archived).length;

  // Category defaults (roadmap P4) — one row per category in use.
  const [categoryDefaults, costCodes, accounts] = await Promise.all([
    listCategoryDefaults(companyId),
    listCostCodes(companyId),
    listAccountingAccounts(companyId),
  ]);
  const catCounts = new Map<string, number>();
  for (const it of items) {
    const c = it.category?.trim().toLowerCase();
    if (c && !it.archivedAt) catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  // The managed Group > Category list when the company has one (every
  // category, even empty ones); otherwise the categories in use.
  const managed = managedForGroups;
  const categories = (
    managed.length > 0
      ? managed.map((c) => ({ category: c.name, group: c.group }))
      : [...catCounts.keys()].sort().map((c) => ({
          category: items.find((i) => i.category?.trim().toLowerCase() === c)!
            .category!.trim(),
          group: null as string | null,
        }))
  ).map(({ category, group }) => ({
    category,
    group,
    count: catCounts.get(category.toLowerCase()) ?? 0,
    costCodeId: categoryDefaults.get(category.toLowerCase())?.costCodeId ?? null,
    accountId: categoryDefaults.get(category.toLowerCase())?.accountId ?? null,
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
        accounts={costAccountOptions(accounts)}
        canEdit={allowCreate}
        managed={managed.length > 0}
        groups={[...new Set(managed.map((c) => c.group))]}
      />

      <ProductsListClient products={rows} />
    </div>
  );
}
