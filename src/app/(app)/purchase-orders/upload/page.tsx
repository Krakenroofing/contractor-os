import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listCostCodes } from '@/lib/data/cost-codes';
import { listInventoryItems } from '@/lib/data/inventory-items';
import { getCustomer } from '@/lib/data/customers';
import { listProjects } from '@/lib/data/projects';
import { listVendors } from '@/lib/data/vendors';
import { isOcrConfigured } from '@/lib/ocr/po-extract';
import { PoPdfUpload } from '@/modules/purchase-orders/components/po-pdf-upload';

export const dynamic = 'force-dynamic';

export default async function UploadPurchaseOrderPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'purchase_orders')) redirect('/purchase-orders');

  const companyId = await getActiveCompanyId();
  const ocrEnabled = isOcrConfigured();

  const projects = await Promise.all(
    (await listProjects(companyId)).map(async (p) => {
      const customer = await getCustomer(companyId, p.customerId);
      return {
        id: p.id,
        label: `${p.name}${customer ? ` (${customer.name})` : ''}`,
      };
    }),
  );
  const vendors = (await listVendors(companyId)).map((v) => ({ id: v.id, name: v.name }));
  const costCodes = (await listCostCodes(companyId)).map((c) => ({
    id: c.id,
    code: c.code,
    description: c.description,
  }));
  const products = (await listInventoryItems(companyId)).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    sku: p.sku,
    unit: p.unit,
    defaultCost: Number(p.defaultCost),
    defaultCostCodeId: p.defaultCostCodeId ?? null,
  }));

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <Breadcrumbs
        items={[
          { href: '/purchase-orders', label: 'Purchase orders' },
          { label: 'Upload from PDF' },
        ]}
      />

      <Link href="/purchase-orders">
        <Button variant="outline" size="sm">
          ← Back to Purchase Orders
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Create PO from PDF
        </h1>
        <p className="text-sm text-slate-500 mt-1 max-w-3xl">
          Upload a vendor estimate or quote. We&apos;ll read the vendor,
          date, line items, and totals; you review and correct, pick which
          project to bill the cost against, and save as a draft PO. The
          source PDF is saved to the project&apos;s documents for the audit
          trail.
        </p>
      </header>

      {!ocrEnabled ? (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          PDF extraction is not configured on this environment. Ask your admin
          to set <code>GOOGLE_DOCUMENT_AI_*</code> env vars. In the meantime,
          use{' '}
          <Link href="/purchase-orders/new" className="underline">
            manual entry
          </Link>{' '}
          or the &quot;Upload from Excel&quot; button on the new-PO form.
        </div>
      ) : (
        <PoPdfUpload
          projects={projects}
          vendors={vendors}
          costCodes={costCodes}
          products={products}
        />
      )}
    </div>
  );
}
