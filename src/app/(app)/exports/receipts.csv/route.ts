import { NextRequest } from 'next/server';
import { getActiveCompanyId, getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { listReceipts } from '@/lib/data/receipts';
import { listVendors } from '@/lib/data/vendors';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import { listBankAccounts } from '@/lib/data/bank-accounts';
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

  const [receipts, vendors, projects, costCodes, bankAccounts] = await Promise.all([
    listReceipts(companyId, { limit: 5000 }),
    listVendors(companyId),
    listProjects(companyId),
    listCostCodes(companyId),
    listBankAccounts(companyId, { includeArchived: true }),
  ]);
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const costCodeById = new Map(costCodes.map((c) => [c.id, c]));
  const bankById = new Map(bankAccounts.map((b) => [b.id, b]));

  // Apply date range to the receipt's natural anchor date.
  const filtered = receipts.filter((r) => {
    if (from && r.receiptDate < from) return false;
    if (to && r.receiptDate > to) return false;
    return true;
  });

  const rows: CsvCell[][] = [
    [
      'Receipt date',
      'Vendor',
      'Vendor TIN',
      'Project',
      'Cost code',
      'Payment source',
      'Bank/CC account',
      'Status',
      'Currency',
      'Subtotal (net)',
      'VAT amount',
      'VAT rate %',
      'VAT included',
      'VAT recoverable',
      'VAT quarter',
      'Total (gross)',
      'Billable',
      'Reimbursable',
      'Posted',
      'Notes',
    ],
    ...filtered.map((r) => {
      const vendor = r.vendorId ? vendorById.get(r.vendorId) : null;
      const project = r.projectId ? projectById.get(r.projectId) : null;
      const code = r.costCodeId ? costCodeById.get(r.costCodeId) : null;
      const bank = r.bankAccountId ? bankById.get(r.bankAccountId) : null;
      return [
        r.receiptDate,
        vendor?.name ?? '',
        r.vendorTin ?? '',
        project ? project.name : '',
        code ? `${code.code} — ${code.description}` : '',
        r.paymentSourceType,
        bank?.name ?? '',
        r.status,
        r.currency,
        r.subtotal,
        r.vatAmount,
        r.vatRatePercent ?? '',
        r.vatIncluded ? 'yes' : 'no',
        r.vatRecoverable ? 'yes' : 'no',
        r.vatPeriodQuarter ?? '',
        r.total,
        r.isBillable ? 'yes' : 'no',
        r.isReimbursable ? 'yes' : 'no',
        r.status === 'posted' && r.postedAt
          ? r.postedAt.toISOString().slice(0, 10)
          : '',
        r.notes ?? '',
      ];
    }),
  ];

  void company; // reserved for future per-company branding in the filename
  return csvResponse(csvFilename('receipts', from, to), toCsv(rows));
}
