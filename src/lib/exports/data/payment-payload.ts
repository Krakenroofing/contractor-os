import 'server-only';
import { getPayment } from '@/lib/data/invoice-payments';
import { getInvoice } from '@/lib/data/invoices';
import { getProject } from '@/lib/data/projects';
import { getCustomer } from '@/lib/data/customers';
import { getActiveCompany } from '@/lib/active-company';
import { buildCompanyInfo } from '@/lib/exports/data/company-info';
import { parseMoney, subtract } from '@/lib/money';
import { METHOD_LABEL, type PaymentMethod } from '@/modules/payments/schema';
import type {
  DocumentPayload,
  DocumentMeta,
  DocumentSection,
  DocumentTotalsRow,
} from '@/lib/exports/types';

export async function buildPaymentPayload(
  companyId: string,
  paymentId: string,
): Promise<DocumentPayload | null> {
  const payment = await getPayment(companyId, paymentId);
  if (!payment) return null;

  const company = await getActiveCompany();
  const invoice = await getInvoice(companyId, payment.invoiceId);
  const project = invoice
    ? await getProject(companyId, invoice.projectId)
    : undefined;
  const customer = project
    ? await getCustomer(companyId, project.customerId)
    : undefined;

  const amount = parseMoney(payment.amount);
  const method = (payment.method ?? 'other') as PaymentMethod;
  const methodLabel = METHOD_LABEL[method] ?? payment.method ?? '—';

  // Empty payment numbers happen (auto-recorded payments); fall back to a
  // stable id-derived label so the filename and header still read sensibly.
  const number =
    payment.paymentNumber && payment.paymentNumber.trim() !== ''
      ? payment.paymentNumber
      : `PMT-${payment.id.slice(0, 8)}`;

  const meta: DocumentMeta[] = [
    { label: 'Receipt #', value: number },
    { label: 'Paid date', value: payment.paidDate },
    { label: 'Method', value: methodLabel },
  ];
  if (payment.reference) {
    meta.push({ label: 'Reference', value: payment.reference });
  }
  if (payment.bankAccount) {
    meta.push({ label: 'Deposited to', value: payment.bankAccount });
  }
  if (invoice) {
    meta.push({ label: 'Applied to invoice', value: invoice.number });
  }

  const totals: DocumentTotalsRow[] = [
    { label: 'Amount received', value: amount, bold: true },
  ];
  if (invoice) {
    const balanceAfter = subtract(
      parseMoney(invoice.total),
      parseMoney(invoice.amountPaid),
    );
    totals.push({ label: 'Invoice total', value: parseMoney(invoice.total) });
    totals.push({
      label: 'Invoice paid to date',
      value: parseMoney(invoice.amountPaid),
    });
    totals.push({ label: 'Invoice balance due', value: balanceAfter, bold: true });
  }

  const sections: DocumentSection[] = [];
  if (payment.notes && payment.notes.trim() !== '') {
    sections.push({ title: 'Notes', body: payment.notes });
  }

  return {
    type: 'payment',
    title: 'Payment Receipt',
    number,
    company: await buildCompanyInfo(company),
    recipientLabel: 'Received from',
    customer: customer
      ? {
          name: customer.name,
          contact: customer.primaryContactName,
          email: customer.email,
          phone: customer.phone,
          addressLine1: customer.billingAddressLine1,
          city: customer.billingCity,
          state: customer.billingState,
          postalCode: customer.billingPostalCode,
        }
      : undefined,
    project: project
      ? {
          name: project.name,
          description: project.notes,
        }
      : undefined,
    meta,
    totals,
    sections,
    footerNote: null,
  };
}
