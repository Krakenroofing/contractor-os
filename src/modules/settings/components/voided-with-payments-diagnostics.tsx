// Owner-only diagnostic card that surfaces voided invoices that still have
// payment rows attached. Those payments stopped feeding company-wide
// aggregations (AR, payment summary, etc.) the moment the listPayments /
// listInvoicePaymentsForCompany void-filter shipped — but the rows still
// exist in the DB, and the cash they represented may or may not still be
// sitting in the bank. The operator needs to look at each one and decide:
//
//   - Refund the customer (cash was collected, customer needs it back)
//   - Re-apply the cash to a different invoice (customer keeps it; the
//     original invoice was a mistake)
//   - Delete the payment rows entirely (cash never actually arrived — the
//     payment was logged in error)
//
// This card doesn't take any of those actions itself — it just lists what
// needs human attention.

import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveCompanyId } from '@/lib/active-company';
import { getDb, isDatabaseConfigured } from '@/db';
import {
  invoices,
  invoicePayments,
  projects,
  customers,
} from '@/db/schema';
import { formatMoney, parseMoney } from '@/lib/money';
import { DeleteOrphanedPaymentsButton } from '@/modules/payments/components/delete-orphaned-payments-button';

type VoidedRow = {
  invoiceId: string;
  invoiceNumber: string;
  voidedTotal: number;
  projectId: string;
  projectName: string;
  customerName: string;
  paymentCount: number;
  paymentTotal: number;
};

async function loadVoidedWithPayments(companyId: string): Promise<VoidedRow[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;

  // All voided invoices for this company, joined to project + customer for
  // context. One query so the per-row payment lookup below is the only
  // additional work.
  const voidedInvoices = await db
    .select({
      invoiceId: invoices.id,
      invoiceNumber: invoices.number,
      invoiceTotal: invoices.total,
      projectId: projects.id,
      projectName: projects.name,
      customerName: customers.name,
    })
    .from(invoices)
    .innerJoin(projects, eq(invoices.projectId, projects.id))
    .innerJoin(customers, eq(projects.customerId, customers.id))
    .where(and(eq(invoices.companyId, companyId), eq(invoices.status, 'void')))
    .orderBy(desc(invoices.invoiceDate));

  if (voidedInvoices.length === 0) return [];

  // For each voided invoice, look up its payments. Most companies have a
  // handful of voids at most, so the N+1 here is harmless; switch to a
  // single inArray query if voids ever grow large.
  const results: VoidedRow[] = [];
  for (const inv of voidedInvoices) {
    const payments = await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, inv.invoiceId));
    if (payments.length === 0) continue;
    const paymentTotal = payments.reduce(
      (sum, p) => sum + parseMoney(p.amount),
      0,
    );
    results.push({
      invoiceId: inv.invoiceId,
      invoiceNumber: inv.invoiceNumber,
      voidedTotal: parseMoney(inv.invoiceTotal),
      projectId: inv.projectId,
      projectName: inv.projectName,
      customerName: inv.customerName,
      paymentCount: payments.length,
      paymentTotal,
    });
  }
  return results;
}

export async function VoidedWithPaymentsDiagnostics() {
  const companyId = await getActiveCompanyId();
  const rows = await loadVoidedWithPayments(companyId);
  const totalOrphanedCash = rows.reduce((s, r) => s + r.paymentTotal, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Voided invoices with orphaned payments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            No voided invoices have payment rows attached. Cash and invoices
            are consistent.
          </div>
        ) : (
          <>
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <strong>{rows.length}</strong> voided invoice
              {rows.length === 1 ? '' : 's'} have payment rows attached, holding
              a combined <strong>{formatMoney(totalOrphanedCash)}</strong>{' '}
              that no longer flows into any total. Decide per row whether to
              refund the customer, re-apply the cash to another invoice, or
              delete the payment if it was logged in error.
            </div>

            <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer / Project</TableHead>
                    <TableHead className="text-right">Voided total</TableHead>
                    <TableHead className="text-right">Payments</TableHead>
                    <TableHead className="text-right">Cash logged</TableHead>
                    <TableHead className="text-right">Cleanup</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.invoiceId}>
                      <TableCell className="font-mono text-xs">
                        <Link
                          href={{ pathname: `/invoices/${r.invoiceId}` }}
                          className="hover:underline text-slate-900"
                        >
                          {r.invoiceNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-700">
                        <div className="text-sm">{r.customerName}</div>
                        <div className="text-xs text-slate-500">
                          {r.projectName}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">
                        {formatMoney(r.voidedTotal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.paymentCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-amber-700 font-medium">
                        {formatMoney(r.paymentTotal)}
                      </TableCell>
                      <TableCell className="text-right">
                        <DeleteOrphanedPaymentsButton
                          invoiceId={r.invoiceId}
                          paymentCount={r.paymentCount}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <p className="text-xs text-slate-500">
              Click an invoice number to open its detail page, where you can
              view the payment rows. Banking reconciliation lives on a
              separate surface and isn&apos;t affected by these payments — but
              if the cash actually arrived in the bank, you&apos;ll want to
              either refund the customer or apply it to a different invoice
              via <em>Record Payment</em>.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
