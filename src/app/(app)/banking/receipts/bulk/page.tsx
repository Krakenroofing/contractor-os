import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { ReceiptBulkUploader } from '@/modules/receipts/components/bulk-uploader';

export const dynamic = 'force-dynamic';

export default async function BulkReceiptsPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'receipts')) {
    redirect('/banking/receipts' as never);
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link
          href={{ pathname: '/banking/receipts' }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to Receipts
        </Link>
        <h1 className="text-xl font-semibold text-slate-900 mt-1">
          Bulk upload receipts
        </h1>
        <p className="text-sm text-slate-500">
          Drop a batch of receipt photos / PDFs. Each file becomes its own
          draft receipt with the file attached. Fill in vendor / project /
          cost code on each draft after upload.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
        </CardHeader>
        <CardContent>
          <ReceiptBulkUploader />
        </CardContent>
      </Card>
    </div>
  );
}
