import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate, canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import {
  listReceipts,
  listReceiptLinesForReceiptIds,
  type ListReceiptsFilters,
} from '@/lib/data/receipts';
import { listProjects } from '@/lib/data/projects';
import { listVendors } from '@/lib/data/vendors';
import {
  RECEIPT_STATUS_LABEL,
  receiptStatusValues,
} from '@/modules/receipts/schema';
import { ReceiptsFilterBar } from '@/modules/receipts/components/receipts-filter-bar';

export const dynamic = 'force-dynamic';

function firstString(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

function parseFilters(
  sp: Record<string, string | string[] | undefined>,
): {
  filters: ListReceiptsFilters;
  raw: {
    status: string;
    vendorId: string;
    projectId: string;
    dateFrom: string;
    dateTo: string;
    amountMin: string;
    amountMax: string;
  };
} {
  const status = firstString(sp.status);
  const vendorId = firstString(sp.vendorId);
  const projectId = firstString(sp.projectId);
  const dateFrom = firstString(sp.dateFrom);
  const dateTo = firstString(sp.dateTo);
  const amountMin = firstString(sp.amountMin);
  const amountMax = firstString(sp.amountMax);

  const filters: ListReceiptsFilters = { limit: 200 };
  if (
    status &&
    (receiptStatusValues as readonly string[]).includes(status)
  ) {
    filters.status = status as ListReceiptsFilters['status'];
  }
  if (vendorId) filters.vendorId = vendorId;
  if (projectId) filters.projectId = projectId;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) filters.dateFrom = dateFrom;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) filters.dateTo = dateTo;
  const minN = Number(amountMin);
  const maxN = Number(amountMax);
  if (amountMin && Number.isFinite(minN)) filters.amountMin = minN;
  if (amountMax && Number.isFinite(maxN)) filters.amountMax = maxN;

  return {
    filters,
    raw: { status, vendorId, projectId, dateFrom, dateTo, amountMin, amountMax },
  };
}

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'receipts')) redirect('/banking' as never);
  const company = await getActiveCompany();
  const sp = await searchParams;
  const { filters, raw } = parseFilters(sp);

  const [receipts, projects, vendors] = await Promise.all([
    listReceipts(company.id, filters),
    listProjects(company.id),
    listVendors(company.id),
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p.number + ' — ' + p.name]));
  const vendorById = new Map(vendors.map((v) => [v.id, v.name]));

  // Pull lines for visible receipts so the Project column reflects multi-line.
  const lines = await listReceiptLinesForReceiptIds(
    company.id,
    receipts.map((r) => r.id),
  );
  const linesByReceipt = new Map<string, typeof lines>();
  for (const l of lines) {
    const arr = linesByReceipt.get(l.receiptId) ?? [];
    arr.push(l);
    linesByReceipt.set(l.receiptId, arr);
  }

  function projectDisplay(receiptId: string): string {
    const rl = linesByReceipt.get(receiptId) ?? [];
    const projectIds = Array.from(
      new Set(rl.map((l) => l.projectId).filter((p): p is string => Boolean(p))),
    );
    if (projectIds.length === 0) return '—';
    if (projectIds.length === 1) {
      return projectById.get(projectIds[0]) ?? '—';
    }
    return `Multiple (${projectIds.length})`;
  }

  const canAdd = canCreate(role, 'receipts');
  const anyFilterApplied = Boolean(
    raw.status ||
      raw.vendorId ||
      raw.projectId ||
      raw.dateFrom ||
      raw.dateTo ||
      raw.amountMin ||
      raw.amountMax,
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={{ pathname: '/banking' }}
            className="text-xs text-slate-500 hover:text-slate-900"
          >
            ← Back to Banking
          </Link>
          <h1 className="text-xl font-semibold text-slate-900 mt-1">
            Receipts
          </h1>
          <p className="text-sm text-slate-500">
            Upload receipts, split across projects + cost codes per line, post
            to job costs when ready.{' '}
            {company.isVatActive
              ? 'VAT split on TRB.'
              : 'No VAT — Kraken posts gross.'}
          </p>
        </div>
        {canAdd && (
          <Link href={{ pathname: '/banking/receipts/new' }}>
            <Button>New receipt</Button>
          </Link>
        )}
      </div>

      <ReceiptsFilterBar
        initial={raw}
        vendors={vendors.map((v) => ({ id: v.id, label: v.name }))}
        projects={projects.map((p) => ({
          id: p.id,
          label: `${p.number} — ${p.name}`,
        }))}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            {anyFilterApplied
              ? `Filtered receipts (${receipts.length})`
              : 'Recent receipts'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {receipts.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm text-slate-600">
                {anyFilterApplied
                  ? 'No receipts match these filters.'
                  : 'No receipts yet. Add one to start tracking field spend.'}
              </p>
              {!anyFilterApplied && canAdd && (
                <Link href={{ pathname: '/banking/receipts/new' }}>
                  <Button>Add your first receipt</Button>
                </Link>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead className="text-right">VAT</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((r) => {
                  const lineCount = (linesByReceipt.get(r.id) ?? []).length;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs font-mono">
                        <Link
                          href={{ pathname: `/banking/receipts/${r.id}` }}
                          className="hover:underline"
                        >
                          {r.receiptDate}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.vendorId ? vendorById.get(r.vendorId) ?? '—' : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-700">
                        {projectDisplay(r.id)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {lineCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(r.subtotal, r.currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-amber-700">
                        {Number(r.vatAmount) > 0
                          ? formatMoney(r.vatAmount, r.currency)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(r.total, r.currency)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <span
                          className={
                            r.status === 'posted'
                              ? 'inline-block rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5'
                              : r.status === 'void'
                                ? 'inline-block rounded bg-slate-200 text-slate-700 px-1.5 py-0.5'
                                : r.status === 'submitted'
                                  ? 'inline-block rounded bg-blue-100 text-blue-800 px-1.5 py-0.5'
                                  : 'inline-block rounded bg-amber-100 text-amber-800 px-1.5 py-0.5'
                          }
                        >
                          {RECEIPT_STATUS_LABEL[r.status]}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
