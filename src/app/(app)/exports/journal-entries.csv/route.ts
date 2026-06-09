import { NextRequest } from 'next/server';
import { getActiveCompany, getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { listReceipts } from '@/lib/data/receipts';
import { listPayments } from '@/lib/data/invoice-payments';
import { listInvoices } from '@/lib/data/invoices';
import { listBankAccounts } from '@/lib/data/bank-accounts';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { listVendors } from '@/lib/data/vendors';
import {
  listImportedTransactions,
  listLinesForTransactionIds,
} from '@/lib/data/statement-imports';
import { listActiveMatchesForCompany } from '@/lib/data/transaction-matches';
import { buildJournalEntries } from '@/modules/exports/lib/journal-entries';
import {
  csvFilename,
  csvResponse,
  toCsv,
  type CsvCell,
} from '@/modules/reports/lib/csv';

export const dynamic = 'force-dynamic';

function dateParam(value: string | null): string {
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  return value;
}

export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'exports')) {
    return new Response('Forbidden', { status: 403 });
  }
  const companyId = await getActiveCompanyId();
  const company = await getActiveCompany();
  const from = dateParam(req.nextUrl.searchParams.get('from'));
  const to = dateParam(req.nextUrl.searchParams.get('to'));

  const [
    receipts,
    invoicePayments,
    invoices,
    bankAccounts,
    accountingAccounts,
    vendors,
    importedTransactions,
    transactionMatches,
  ] = await Promise.all([
    listReceipts(companyId, { limit: 5000 }),
    listPayments(companyId),
    listInvoices(companyId),
    listBankAccounts(companyId, { includeArchived: true }),
    listAccountingAccounts(companyId),
    listVendors(companyId),
    listImportedTransactions(companyId, { limit: 5000, includeIgnored: true }),
    listActiveMatchesForCompany(companyId),
  ]);

  const importedTransactionLines = await listLinesForTransactionIds(
    companyId,
    importedTransactions.map((t) => t.id),
  );

  const journalRows = buildJournalEntries({
    fromDate: from || undefined,
    toDate: to || undefined,
    isVatActive: company.isVatActive,
    receipts,
    invoicePayments,
    invoices,
    bankAccounts,
    accountingAccounts,
    vendors,
    importedTransactions,
    importedTransactionLines,
    transactionMatches,
  });

  const rows: CsvCell[][] = [
    [
      'Date',
      'Memo',
      'Account',
      'Debit',
      'Credit',
      'Source',
      'Source id',
      'Reference',
    ],
    ...journalRows.map((r) => [
      r.date,
      r.memo,
      r.account,
      r.debit,
      r.credit,
      r.source,
      r.sourceRefId,
      r.reference,
    ]),
  ];

  return csvResponse(csvFilename('journal-entries', from, to), toCsv(rows));
}
