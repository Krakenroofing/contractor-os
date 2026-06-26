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
import { add, formatMoney, parseMoney } from '@/lib/money';
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

/** "2026-04-12" → { key: "2026-Q2", label: "Q2 2026" }. */
function quarterFromIso(iso: string): { key: string; label: string } {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const q = Math.min(4, Math.max(1, Math.ceil(month / 3)));
  return { key: `${year}-Q${q}`, label: `Q${q} ${year}` };
}

function currentQuarterKey(asOf: Date = new Date()): string {
  const year = asOf.getUTCFullYear();
  const q = Math.min(4, Math.max(1, Math.ceil((asOf.getUTCMonth() + 1) / 3)));
  return `${year}-Q${q}`;
}

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

  // Pull the filtered list for the table AND every posted receipt (capped)
  // for the VAT-offset rollup. The rollup is intentionally independent of
  // the user's filters — the question it answers ("which quarter does our
  // VAT offset roll up into?") is global, not list-scoped.
  const [receipts, projects, vendors, allPostedForVat] = await Promise.all([
    listReceipts(company.id, filters),
    listProjects(company.id),
    listVendors(company.id),
    company.isVatActive
      ? listReceipts(company.id, { status: 'posted', limit: 5000 })
      : Promise.resolve([]),
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p.name]));
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

  // VAT offset by quarter — accrue input VAT from posted, recoverable
  // receipts, bucketed by receiptDate quarter. Only renders when the
  // company has VAT enabled.
  type VatQuarterBucket = {
    key: string;
    label: string;
    receiptCount: number;
    inputVat: number;
    subtotal: number;
  };
  const vatBucketMap = new Map<string, VatQuarterBucket>();
  if (company.isVatActive) {
    for (const r of allPostedForVat) {
      if (!r.vatRecoverable) continue;
      const q = quarterFromIso(r.receiptDate);
      const bucket: VatQuarterBucket = vatBucketMap.get(q.key) ?? {
        key: q.key,
        label: q.label,
        receiptCount: 0,
        inputVat: 0,
        subtotal: 0,
      };
      bucket.receiptCount += 1;
      bucket.inputVat = add(bucket.inputVat, parseMoney(r.vatAmount));
      bucket.subtotal = add(bucket.subtotal, parseMoney(r.subtotal));
      vatBucketMap.set(q.key, bucket);
    }
  }
  // Descending by quarter key (lex-sorted YYYY-Qn matches chronological).
  const vatBuckets = Array.from(vatBucketMap.values()).sort((a, b) =>
    b.key.localeCompare(a.key),
  );
  const thisQuarterKey = currentQuarterKey();

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
        <div className="flex gap-2">
          <Link href={{ pathname: '/banking/rules' }}>
            <Button variant="outline">Rules</Button>
          </Link>
          {canAdd && (
            <>
              <Link href={{ pathname: '/banking/receipts/bulk' }}>
                <Button variant="outline">Bulk upload</Button>
              </Link>
              <Link href={{ pathname: '/banking/receipts/new' }}>
                <Button>New receipt</Button>
              </Link>
            </>
          )}
        </div>
      </div>

      <ReceiptsFilterBar
        initial={raw}
        vendors={vendors.map((v) => ({ id: v.id, label: v.name }))}
        projects={projects.map((p) => ({
          id: p.id,
          label: p.name,
        }))}
      />

      {company.isVatActive && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle>VAT offset by quarter</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  Posted receipts marked VAT-recoverable, bucketed by receipt
                  date. Each quarter&apos;s input VAT offsets the output VAT
                  due for that same quarter.
                </p>
              </div>
              <Link href={{ pathname: '/reports/vat-quarterly' }}>
                <Button size="sm" variant="outline">
                  Full VAT report →
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {vatBuckets.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">
                No posted receipts with recoverable VAT yet. Once you post a
                receipt with recoverable VAT, it will appear here under its
                quarter and start offsetting that quarter&apos;s VAT due.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quarter</TableHead>
                    <TableHead className="text-right">Receipts</TableHead>
                    <TableHead className="text-right">Subtotal (ex-VAT)</TableHead>
                    <TableHead className="text-right">Input VAT (offset)</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vatBuckets.map((b) => {
                    const isCurrent = b.key === thisQuarterKey;
                    return (
                      <TableRow key={b.key}>
                        <TableCell className="font-medium text-slate-900">
                          {b.label}
                          {isCurrent && (
                            <span className="ml-2 inline-block rounded bg-blue-100 text-blue-800 px-1.5 py-0.5 text-[11px] uppercase tracking-wide">
                              this quarter
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-600">
                          {b.receiptCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-700">
                          {formatMoney(b.subtotal)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium text-emerald-700">
                          {formatMoney(b.inputVat)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={{
                              pathname: '/banking/receipts',
                              query: {
                                status: 'posted',
                                dateFrom: `${b.key.slice(0, 4)}-${
                                  { Q1: '01', Q2: '04', Q3: '07', Q4: '10' }[
                                    b.key.slice(-2) as 'Q1' | 'Q2' | 'Q3' | 'Q4'
                                  ]
                                }-01`,
                                dateTo: `${b.key.slice(0, 4)}-${
                                  { Q1: '03', Q2: '06', Q3: '09', Q4: '12' }[
                                    b.key.slice(-2) as 'Q1' | 'Q2' | 'Q3' | 'Q4'
                                  ]
                                }-${
                                  { Q1: '31', Q2: '30', Q3: '30', Q4: '31' }[
                                    b.key.slice(-2) as 'Q1' | 'Q2' | 'Q3' | 'Q4'
                                  ]
                                }`,
                              },
                            }}
                          >
                            <Button size="sm" variant="outline">
                              View {b.receiptCount}{' '}
                              {b.receiptCount === 1 ? 'receipt' : 'receipts'}
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
      )}

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
                  const q = quarterFromIso(r.receiptDate);
                  const showsOffset =
                    company.isVatActive &&
                    r.status === 'posted' &&
                    r.vatRecoverable &&
                    Number(r.vatAmount) > 0;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs font-mono">
                        <Link
                          href={{ pathname: `/banking/receipts/${r.id}` }}
                          className="hover:underline"
                        >
                          {r.receiptDate}
                        </Link>
                        <div
                          className={`mt-0.5 text-[10px] uppercase tracking-wide ${
                            showsOffset ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                        >
                          {q.label}
                          {showsOffset && ' offset'}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.vendorId ? vendorById.get(r.vendorId) ?? '—' : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-700">
                        {projectDisplay(r.id)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        <Link
                          href={{ pathname: `/banking/receipts/${r.id}` }}
                          className="block hover:underline"
                        >
                          {lineCount}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Link
                          href={{ pathname: `/banking/receipts/${r.id}` }}
                          className="block hover:underline"
                        >
                          {formatMoney(r.subtotal, r.currency)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-amber-700">
                        <Link
                          href={{ pathname: `/banking/receipts/${r.id}` }}
                          className="block hover:underline"
                        >
                          {Number(r.vatAmount) > 0
                            ? formatMoney(r.vatAmount, r.currency)
                            : '—'}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        <Link
                          href={{ pathname: `/banking/receipts/${r.id}` }}
                          className="block hover:underline"
                        >
                          {formatMoney(r.total, r.currency)}
                        </Link>
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
