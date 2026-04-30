import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { VendorForm } from '@/modules/vendors/components/vendor-form';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export default async function NewVendorPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'vendors')) redirect('/vendors');
  return (
    <div className="p-8 max-w-3xl space-y-6">
      <Link href="/vendors">
        <Button variant="outline" size="sm">
          ← Back to Vendors
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">New vendor</h1>
        <p className="text-sm text-slate-500 mt-1">
          Add a supplier or subcontractor so you can issue POs against them.
        </p>
      </header>

      <VendorForm />
    </div>
  );
}
