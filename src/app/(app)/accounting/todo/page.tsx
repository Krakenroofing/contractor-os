import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listAccountingReviewItems } from '@/lib/data/accounting-review';

export const dynamic = 'force-dynamic';

// Accounting to-do: bank transactions that slipped through with a
// categorization problem (reviewed-but-uncategorized, or a split with a line
// missing its category). One place to find and fix everything that needs
// attention.
export default async function AccountingTodoPage() {
  const role = await getActiveRole();
  if (!canView(role, 'statement_imports')) redirect('/dashboard');
  const company = await getActiveCompany();
  const items = await listAccountingReviewItems(company.id);

  const reviewedNoCat = items.filter((i) => i.issue === 'reviewed_no_category');
  const incompleteSplits = items.filter((i) => i.issue === 'incomplete_split');

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Accounting to-do</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Transactions that need a category fixed — {items.length}{' '}
          {items.length === 1 ? 'item' : 'items'} for {company.name}.
        </p>
      </header>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50 p-10 text-center text-sm text-emerald-800">
          ✓ All clear — every reviewed transaction is categorized and no split
          has a missing category.
        </div>
      ) : (
        <>
          <IssueSection
            title="Reviewed but uncategorized"
            blurb="Marked reviewed but no category was set — these won't appear in the P&L or VAT reports until categorized."
            items={reviewedNoCat}
          />
          <IssueSection
            title="Splits with a missing category"
            blurb="Split into lines (e.g. cost + VAT) where at least one line still needs a category — typically a cost line left to 'categorize later'."
            items={incompleteSplits}
            showLineHint
          />
        </>
      )}
    </div>
  );
}

function IssueSection({
  title,
  blurb,
  items,
  showLineHint = false,
}: {
  title: string;
  blurb: string;
  items: Awaited<ReturnType<typeof listAccountingReviewItems>>;
  showLineHint?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {title}{' '}
          <span className="text-slate-400 font-normal">({items.length})</span>
        </CardTitle>
        <p className="text-sm text-slate-500">{blurb}</p>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Date</TableHead>
              <TableHead>Description</TableHead>
              {showLineHint && <TableHead className="w-40">Lines to fix</TableHead>}
              <TableHead className="text-right w-32">Amount</TableHead>
              <TableHead className="text-right w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="tabular-nums text-slate-700">
                  {i.transactionDate}
                </TableCell>
                <TableCell className="text-slate-900">
                  {i.description || '—'}
                </TableCell>
                {showLineHint && (
                  <TableCell className="text-amber-700">
                    {i.uncategorizedLines} of {i.lineCount} line
                    {i.lineCount === 1 ? '' : 's'}
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums">
                  {formatMoney(Math.abs(Number(i.amount)))}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/banking/accounts/${i.bankAccountId}?q=${encodeURIComponent(
                      i.description ?? '',
                    )}`}
                    className="text-blue-700 hover:underline"
                  >
                    Fix →
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
