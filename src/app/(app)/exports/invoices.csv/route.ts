import { NextRequest } from 'next/server';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { listInvoices } from '@/lib/data/invoices';
import { listProjects } from '@/lib/data/projects';
import { listCustomers } from '@/lib/data/customers';
import { parseMoney, round2, subtract } from '@/lib/money';
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

// All active (non-void) invoices, one row each, for reconciling against
// QuickBooks. Optional ?from=&to= filter the invoice DATE (inclusive);
// omit them to pull the full list. Void invoices are excluded — they're
// not real obligations and would just create phantom mismatches.
export async function GET(req: NextRequest) {
  const role = await getActiveRole();
  if (!canView(role, 'exports')) {
    return new Response('Forbidden', { status: 403 });
  }
  const companyId = await getActiveCompanyId();
  const from = dateParam(req.nextUrl.searchParams.get('from'));
  const to = dateParam(req.nextUrl.searchParams.get('to'));

  const [invoices, projects, customers] = await Promise.all([
    listInvoices(companyId),
    listProjects(companyId),
    listCustomers(companyId),
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const active = invoices
    .filter((inv) => inv.status !== 'void')
    .filter((inv) => {
      if (from && inv.invoiceDate < from) return false;
      if (to && inv.invoiceDate > to) return false;
      return true;
    })
    // Oldest invoice date first — matches the chronological scan an
    // accountant does when reconciling a ledger top-to-bottom.
    .sort((a, b) => {
      if (a.invoiceDate !== b.invoiceDate) {
        return a.invoiceDate < b.invoiceDate ? -1 : 1;
      }
      return a.number.localeCompare(b.number);
    });

  const rows: CsvCell[][] = [
    [
      'Invoice #',
      'Status',
      'Billing type',
      'Invoice date',
      'Due date',
      'Customer',
      'Project',
      'PO number',
      'Billing label',
      'Subtotal',
      'Tax / VAT',
      'Retainage held',
      'Retainage released',
      'Total',
      'Amount paid',
      'Balance due',
      'Sent date',
      'Paid date',
      'Notes',
    ],
    ...active.map((inv) => {
      const project = projectById.get(inv.projectId);
      const customer = project ? customerById.get(project.customerId) : null;
      const balance = round2(
        subtract(parseMoney(inv.total), parseMoney(inv.amountPaid)),
      );
      return [
        inv.number,
        inv.status,
        inv.billingType,
        inv.invoiceDate,
        inv.dueDate ?? '',
        customer?.name ?? '',
        project?.name ?? '',
        inv.purchaseOrderNumber ?? '',
        inv.billingLabel ?? '',
        inv.subtotal,
        inv.taxAmount,
        inv.retainageAmount,
        inv.retainageReleased,
        inv.total,
        inv.amountPaid,
        balance,
        inv.sentAt ? inv.sentAt.toISOString().slice(0, 10) : '',
        inv.paidAt ? inv.paidAt.toISOString().slice(0, 10) : '',
        inv.notes ?? '',
      ];
    }),
  ];

  return csvResponse(csvFilename('invoices', from, to), toCsv(rows));
}
