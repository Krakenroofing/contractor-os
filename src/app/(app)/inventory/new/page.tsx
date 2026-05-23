import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listCostCodes } from '@/lib/data/cost-codes';
import { ProductForm } from '@/modules/inventory/components/product-form';

export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) redirect('/inventory');
  const companyId = await getActiveCompanyId();
  const costCodes = await listCostCodes(companyId);
  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Link href="/inventory">
        <Button variant="outline" size="sm">
          ← Back to Products
        </Button>
      </Link>
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">New product</h1>
        <p className="text-sm text-slate-500 mt-1">
          Add a material or product so it shows up in the line-item dropdowns
          on POs, Invoices, and Estimates.
        </p>
      </header>
      <ProductForm
        costCodes={costCodes.map((c) => ({
          id: c.id,
          label: `${c.code} — ${c.description}`,
        }))}
      />
    </div>
  );
}
