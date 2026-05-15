import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

function parseStr(v: string | string[] | undefined): string {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v[0]?.trim() ?? '';
  return '';
}

// Naive default range: current calendar quarter. The accountant can override.
function defaultQuarterRange(asOf: Date): { from: string; to: string } {
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth() + 1;
  const q = Math.min(4, Math.max(1, Math.ceil(m / 3)));
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  // Last day of endMonth: use day 0 of the month AFTER.
  const lastDay = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
  return {
    from: `${y}-${String(startMonth).padStart(2, '0')}-01`,
    to: `${y}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

export default async function ExportsHubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'exports')) redirect('/dashboard' as never);
  const company = await getActiveCompany();
  const sp = await searchParams;
  const def = defaultQuarterRange(new Date());
  const from = parseStr(sp.from) || def.from;
  const to = parseStr(sp.to) || def.to;
  const qs = `?from=${from}&to=${to}`;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Exports for accountant
        </h1>
        <p className="text-sm text-slate-500">
          Clean CSVs you can hand to {company.name}&rsquo;s accountant or
          import into a tax/bookkeeping tool. Date filters apply to the
          receipts and journal-entries exports — the others always pull the
          full list.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Date range</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label htmlFor="from">From</Label>
              <Input id="from" name="from" type="date" defaultValue={from} />
            </div>
            <div>
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" type="date" defaultValue={to} />
            </div>
            <div className="flex items-end">
              <Button type="submit" variant="outline" className="w-full">
                Apply range
              </Button>
            </div>
          </form>
          <p className="mt-2 text-xs text-slate-500">
            Defaults to the current quarter. Range is inclusive on both sides.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ExportCard
          title="Journal-entry export"
          description={
            <>
              Double-entry rows for every <strong>posted receipt</strong>,
              <strong> invoice payment</strong>, <strong>matched transfer</strong>,
              and <strong>owner contribution / draw</strong> in the date range.
              VAT splits out automatically for{' '}
              {company.isVatActive ? company.name : 'VAT-active companies'} —
              recoverable VAT debits a separate VAT Input row, non-recoverable
              VAT stays baked into the expense line.
            </>
          }
          href={`/exports/journal-entries.csv${qs}`}
          filterLabel={`${from} → ${to}`}
        />

        <ExportCard
          title="Receipts"
          description={
            <>
              Every receipt in the date range, with full VAT split
              (subtotal / VAT / total), payment source, project, cost code,
              status, billable / reimbursable flags, and notes.
            </>
          }
          href={`/exports/receipts.csv${qs}`}
          filterLabel={`${from} → ${to}`}
        />

        <ExportCard
          title="Chart of Accounts"
          description="All accounting accounts (code, name, type, parent, currency, archive status). Useful as a one-time COA seed in your accountant's tool."
          href="/exports/chart-of-accounts.csv"
          filterLabel="Full list"
        />

        <ExportCard
          title="Vendors"
          description="All vendors with contact details, tax IDs, W-9 status, payment terms, and default cost code / cost type / accounting category."
          href="/exports/vendors.csv"
          filterLabel="Full list"
        />

        <ExportCard
          title="Customers"
          description="All customers with billing address, type, contact details, and TIN."
          href="/exports/customers.csv"
          filterLabel="Full list"
        />
      </div>

      <Card>
        <CardContent className="p-4 text-xs text-slate-500 space-y-1">
          <p>
            <strong>How journal accounts map.</strong> Receipts debit their
            assigned category (or &ldquo;Uncategorized Expense&rdquo; if blank)
            and credit the paired bank/credit-card account (or
            &ldquo;Cash on hand&rdquo; for cash receipts). Invoice payments
            debit the bank label stored on the payment row and credit the
            company&rsquo;s default Income account — your accountant will
            usually reclassify the credit to Accounts Receivable on accrual
            books.
          </p>
          <p>
            <strong>Stateless export.</strong> The CSVs don&rsquo;t track
            what&rsquo;s already been exported. Pick a clean date range each
            time (e.g. one calendar quarter) to avoid double-importing on the
            accountant&rsquo;s side.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ExportCard({
  title,
  description,
  href,
  filterLabel,
}: {
  title: string;
  description: React.ReactNode;
  href: string;
  filterLabel: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-600">{description}</p>
        <p className="text-[11px] uppercase tracking-wide text-slate-500">
          Window: {filterLabel}
        </p>
        <a href={href} download>
          <Button size="sm">Download CSV</Button>
        </a>
      </CardContent>
    </Card>
  );
}
