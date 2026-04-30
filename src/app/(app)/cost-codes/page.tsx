import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listMockCostCodes } from '@/lib/mock-store';
import { CATEGORY_LABEL, CATEGORY_TONE, type CostCodeCategory } from '@/modules/cost-codes/schema';

export const dynamic = 'force-dynamic';

const FALLBACK_TONE = 'slate' as const;

function categoryTone(c: string) {
  return (CATEGORY_TONE as Record<string, (typeof CATEGORY_TONE)[CostCodeCategory]>)[c] ?? FALLBACK_TONE;
}

function categoryLabel(c: string) {
  return (CATEGORY_LABEL as Record<string, string>)[c] ?? c;
}

export default async function CostCodesPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'cost_codes');
  const costCodes = listMockCostCodes(companyId);

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
        Demo mode — cost codes loaded from the in-memory mock store
        (<code className="font-mono">src/lib/mock-store.ts</code>). These codes are
        the spine of estimates, POs, change orders, and job costing.
      </div>

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Cost Codes</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {costCodes.length} {costCodes.length === 1 ? 'code' : 'codes'} in the library
          </p>
        </div>
        {allowCreate && (
          <Link href="/cost-codes/new">
            <Button>New Cost Code</Button>
          </Link>
        )}
      </header>

      {costCodes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-600">No cost codes yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            Add codes so estimates and POs can roll up by category.
          </p>
          <div className="mt-4 inline-flex">
            <Link href="/cost-codes/new">
              <Button>New Cost Code</Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {costCodes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs text-slate-700">
                    {c.code}
                  </TableCell>
                  <TableCell className="font-medium text-slate-900">
                    {c.description}
                  </TableCell>
                  <TableCell>
                    <Badge tone={categoryTone(c.category)}>
                      {categoryLabel(c.category)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/cost-codes/${c.id}`}>
                      <Button size="sm" variant="outline">
                        View
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
