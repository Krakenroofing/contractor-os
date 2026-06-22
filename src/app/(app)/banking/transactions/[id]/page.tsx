import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
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
import {
  getImportedTransaction,
  listLinesForTransactionIds,
} from '@/lib/data/statement-imports';
import { getActiveMatchForTxn } from '@/lib/data/transaction-matches';
import {
  getReceipt,
  listReceiptLines,
  listReceiptAttachments,
} from '@/lib/data/receipts';
import { createSignedReceiptUrl } from '@/lib/storage/receipt-files';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import { getVendor } from '@/lib/data/vendors';
import { getBankAccount } from '@/lib/data/bank-accounts';

export const dynamic = 'force-dynamic';

// Full detail for one imported bank transaction — reached by drilling down
// from the P&L category report (and anywhere else that needs the whole story
// behind a bank line). Shows every split category, the linked receipt with
// its images, and the match audit. Opens in its own tab.
export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'statement_imports')) redirect('/dashboard');
  const company = await getActiveCompany();
  const { id } = await params;

  const txn = await getImportedTransaction(company.id, id);
  if (!txn) notFound();

  const [lines, match, accounts, projects, costCodes, bankAccount] =
    await Promise.all([
      listLinesForTransactionIds(company.id, [id]),
      getActiveMatchForTxn(company.id, id),
      listAccountingAccounts(company.id),
      listProjects(company.id),
      listCostCodes(company.id),
      txn.bankAccountId ? getBankAccount(company.id, txn.bankAccountId) : null,
    ]);

  const vendor = txn.vendorId ? await getVendor(company.id, txn.vendorId) : null;

  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const costCodeName = new Map(
    costCodes.map((c) => [c.id, `${c.code} — ${c.description}`]),
  );

  // Linked receipt (the common case) — pull its lines + images.
  let receiptBlock: {
    receipt: Awaited<ReturnType<typeof getReceipt>>;
    lines: Awaited<ReturnType<typeof listReceiptLines>>;
    images: { url: string | null; name: string; isImage: boolean }[];
  } | null = null;
  if (match?.matchType === 'receipt' && match.receiptId) {
    const [receipt, rLines, attachments] = await Promise.all([
      getReceipt(company.id, match.receiptId),
      listReceiptLines(company.id, match.receiptId),
      listReceiptAttachments(company.id, match.receiptId),
    ]);
    if (receipt) {
      const images = await Promise.all(
        attachments.map(async (a) => ({
          url: await createSignedReceiptUrl(a.storagePath),
          name: a.originalFilename ?? 'attachment',
          isImage: (a.mimeType ?? '').toLowerCase().startsWith('image/'),
        })),
      );
      receiptBlock = { receipt, lines: rLines, images };
    }
  }

  const gross = Math.abs(Number(txn.amount));
  const isDebit = Number(txn.amount) < 0;
  const address = [bankAccount?.name].filter(Boolean).join(' ');

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <Link
          href={
            txn.bankAccountId
              ? `/banking/accounts/${txn.bankAccountId}`
              : '/banking'
          }
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to account
        </Link>
        <h1 className="text-xl font-semibold text-slate-900 mt-1">
          {txn.description || '(no description)'}
        </h1>
        <p className="text-sm text-slate-500">
          {txn.transactionDate} · {address || 'Bank transaction'} ·{' '}
          <span className="font-medium text-slate-900">
            {isDebit ? '−' : '+'}
            {formatMoney(gross)} {txn.currency}
          </span>
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {txn.reconciledAt && <Badge tone="green">Reconciled</Badge>}
          {txn.isReviewed && <Badge tone="blue">Reviewed</Badge>}
          {txn.isIgnored && <Badge tone="slate">Ignored</Badge>}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transaction</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            <Row label="Date" value={txn.transactionDate} />
            <Row label="Amount" value={`${isDebit ? '−' : '+'}${formatMoney(gross)} ${txn.currency}`} />
            <Row label="Payee" value={txn.payee || '—'} />
            <Row label="Vendor" value={vendor?.name || '—'} />
            <Row label="Memo" value={txn.memo || '—'} />
            <Row label="Reference" value={txn.reference || '—'} />
            <Row label="Bank account" value={bankAccount?.name || '—'} />
            <Row label="Notes" value={txn.notes || '—'} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Categorization{lines.length > 0 ? ` · ${lines.length} split lines` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {lines.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Cost code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right w-32">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-slate-900">
                      {l.accountingAccountId
                        ? (accountName.get(l.accountingAccountId) ?? 'Unknown')
                        : <span className="text-amber-700">Uncategorized</span>}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {l.projectId ? (projectName.get(l.projectId) ?? '—') : '—'}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {l.costCodeId ? (costCodeName.get(l.costCodeId) ?? '—') : '—'}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {l.description || '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(Number(l.amount))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-6 text-sm">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                <Row
                  label="Category"
                  value={
                    txn.accountingAccountId
                      ? (accountName.get(txn.accountingAccountId) ?? 'Unknown')
                      : 'Uncategorized'
                  }
                />
                <Row
                  label="Project"
                  value={txn.projectId ? (projectName.get(txn.projectId) ?? '—') : '—'}
                />
                <Row
                  label="Cost code"
                  value={txn.costCodeId ? (costCodeName.get(txn.costCodeId) ?? '—') : '—'}
                />
              </dl>
            </div>
          )}
        </CardContent>
      </Card>

      {receiptBlock?.receipt && (
        <Card>
          <CardHeader>
            <CardTitle>
              Linked receipt ·{' '}
              <Link
                href={`/banking/receipts/${receiptBlock.receipt.id}`}
                className="text-blue-700 hover:underline"
              >
                open ↗
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              <Row label="Receipt date" value={receiptBlock.receipt.receiptDate} />
              <Row
                label="Total"
                value={`${formatMoney(Number(receiptBlock.receipt.total))} ${receiptBlock.receipt.currency}`}
              />
              <Row label="Status" value={receiptBlock.receipt.status} />
              <Row
                label="VAT"
                value={
                  Number(receiptBlock.receipt.vatAmount) > 0
                    ? formatMoney(Number(receiptBlock.receipt.vatAmount))
                    : '—'
                }
              />
            </dl>

            {receiptBlock.images.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {receiptBlock.images.map((img, i) =>
                  img.url ? (
                    img.isImage ? (
                      <a
                        key={i}
                        href={img.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.url}
                          alt={img.name}
                          className="h-40 w-auto rounded border border-slate-200 object-contain bg-white"
                        />
                      </a>
                    ) : (
                      <a
                        key={i}
                        href={img.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-40 w-32 items-center justify-center rounded border border-slate-200 bg-slate-50 text-xs text-blue-700 hover:underline"
                      >
                        {img.name} ↗
                      </a>
                    )
                  ) : (
                    <div
                      key={i}
                      className="flex h-40 w-32 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-400"
                    >
                      {img.name}
                    </div>
                  ),
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {match && match.matchType !== 'receipt' && (
        <Card>
          <CardHeader>
            <CardTitle>Match</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              <Row label="Type" value={match.matchType.replace('_', ' ')} />
              <Row label="Confidence" value={match.confidence} />
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900 text-right">{value}</dd>
    </div>
  );
}
