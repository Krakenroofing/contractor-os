import 'server-only';
import {
  getCreditMemo,
  listApplicationsForCreditMemo,
} from '@/lib/data/credit-memos';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import { getInvoice } from '@/lib/data/invoices';
import { getActiveCompany } from '@/lib/active-company';
import { buildCompanyInfo } from '@/lib/exports/data/company-info';
import { formatMoney, parseMoney, subtract } from '@/lib/money';
import type {
  DocumentPayload,
  DocumentMeta,
  DocumentSection,
  DocumentDataTable,
} from '@/lib/exports/types';

const KIND_LABEL: Record<string, string> = {
  invoice_application: 'Applied to invoice',
  cash_refund: 'Cash refund',
};

export async function buildCreditMemoPayload(
  companyId: string,
  creditMemoId: string,
): Promise<DocumentPayload | null> {
  const cm = await getCreditMemo(companyId, creditMemoId);
  if (!cm) return null;

  const company = await getActiveCompany();
  const customer = await getCustomer(companyId, cm.customerId);
  const project = cm.projectId
    ? await getProject(companyId, cm.projectId)
    : undefined;
  const sourceInvoice = cm.invoiceId
    ? await getInvoice(companyId, cm.invoiceId)
    : undefined;
  const applications = await listApplicationsForCreditMemo(companyId, cm.id);

  const amount = parseMoney(cm.amount);
  const applied = parseMoney(cm.appliedAmount);
  const open = Math.max(subtract(amount, applied), 0);

  const currency = company.defaultCurrency ?? 'USD';

  const meta: DocumentMeta[] = [
    { label: 'Credit memo #', value: cm.number },
    { label: 'Issue date', value: cm.issueDate },
    { label: 'Status', value: cm.status.replace(/_/g, ' ') },
  ];
  if (sourceInvoice) {
    meta.push({ label: 'Source invoice', value: sourceInvoice.number });
  }

  const sections: DocumentSection[] = [];
  if (cm.reason && cm.reason.trim() !== '') {
    sections.push({ title: 'Reason', body: cm.reason });
  }
  if (cm.notes && cm.notes.trim() !== '') {
    sections.push({ title: 'Notes', body: cm.notes });
  }

  // Application history — only render the table when there's something to
  // show, otherwise the open balance in the totals stack tells the story.
  const dataTables: DocumentDataTable[] = [];
  if (applications.length > 0) {
    dataTables.push({
      title: 'Application history',
      columns: [
        { label: 'Date', widthPct: 22 },
        { label: 'Kind', widthPct: 30 },
        { label: 'Reference', widthPct: 28 },
        { label: 'Amount', align: 'right', widthPct: 20 },
      ],
      rows: applications.map((a) => [
        a.appliedAt,
        KIND_LABEL[a.kind] ?? a.kind,
        a.kind === 'cash_refund'
          ? [a.bankAccount, a.reference].filter(Boolean).join(' · ') || '—'
          : a.reference || '—',
        formatMoney(parseMoney(a.amount), currency),
      ]),
    });
  }

  return {
    type: 'credit_memo',
    title: 'Credit Memo',
    number: cm.number,
    statusLabel: cm.status.replace(/_/g, ' '),
    company: await buildCompanyInfo(company),
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
          tinNumber: customer.tinNumber,
        }
      : undefined,
    project: project
      ? {
          name: project.name,
          description: project.notes,
        }
      : undefined,
    meta,
    totals: [
      { label: 'Credit amount', value: amount, bold: true },
      { label: 'Applied', value: applied, negative: true },
      { label: 'Open balance', value: open, bold: true },
    ],
    sections,
    dataTables: dataTables.length > 0 ? dataTables : undefined,
    footerNote: null,
  };
}
