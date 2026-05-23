import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { QbImporter } from '@/modules/inventory/components/qb-importer';

export const dynamic = 'force-dynamic';

export default async function ImportProductsPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'inventory')) redirect('/inventory');
  return (
    <div className="p-8 max-w-5xl space-y-6">
      <Link href="/inventory">
        <Button variant="outline" size="sm">
          ← Back to Products
        </Button>
      </Link>
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Import products from QuickBooks
        </h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          Upload the <em>Product/Service List</em> export from QuickBooks Online.
          We parse the file in the browser, show you the rows, then post the
          confirmed list. Existing SKUs are skipped. The Quantity-On-Hand
          column is ignored.
        </p>
      </header>
      <QbImporter />
    </div>
  );
}
