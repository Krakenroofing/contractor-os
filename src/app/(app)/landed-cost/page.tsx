import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { isDevDemoMode } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listLandedCosts } from '@/lib/data/landed-costs';
import { getProject } from '@/lib/data/projects';
import { LandedCostCalculator } from '@/modules/landed-cost/components/landed-cost-calculator';

export const dynamic = 'force-dynamic';

export default async function LandedCostPage() {
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'landed_cost');
  const saved = await listLandedCosts(companyId);
  const savedWithProject = await Promise.all(
    saved.map(async (l) => ({
      l,
      project: l.projectId ? await getProject(companyId, l.projectId) : undefined,
    })),
  );

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      {isDevDemoMode() && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900">
          Demo mode — saved entries below come from the mock store and feed purchase
          orders + project job costing. The calculator below is a scratch pad (in-memory
          only).
        </div>
      )}

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Landed Cost / Shipping</h1>
          <p className="text-sm text-slate-500 mt-1">
            Build up true landed cost from vendor price through US handling, freight,
            duty, VAT, and local fees — and use it as the cost basis on POs and project
            job costing.
          </p>
        </div>
        {allowCreate && (
          <Link href="/shipping/calculator">
            <Button>+ New estimate</Button>
          </Link>
        )}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Saved entries ({saved.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {saved.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No saved landed-cost entries yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead className="text-right">CIF</TableHead>
                  <TableHead className="text-right">Duty + VAT</TableHead>
                  <TableHead className="text-right">Total landed</TableHead>
                  <TableHead className="text-right">Per unit</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {savedWithProject.map(({ l, project }) => {
                  const dutyPlusVat =
                    Number(l.dutyAmount) + Number(l.vatAmount);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium text-slate-900">
                        {l.name}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {project ? (
                          <Link
                            href={`/projects/${project.id}`}
                            className="hover:underline"
                          >
                            {project.number}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {l.carrier ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(l.cif)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">
                        {formatMoney(dutyPlusVat)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(l.totalLandedCost)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(l.perUnitCost)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/landed-cost/${l.id}`}>
                          <Button size="sm" variant="outline">
                            View
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calculator (scratch pad)</CardTitle>
        </CardHeader>
        <CardContent>
          <LandedCostCalculator />
        </CardContent>
      </Card>
    </div>
  );
}
