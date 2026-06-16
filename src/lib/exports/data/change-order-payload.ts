import 'server-only';
import {
  getChangeOrder,
  getChangeOrderLineItems,
} from '@/lib/data/change-orders';
import { getProject } from '@/lib/data/projects';
import { getCustomer } from '@/lib/data/customers';
import { loadCostCodeMap } from '@/lib/data/cost-codes';
import { getActiveCompany } from '@/lib/active-company';
import { buildCompanyInfo } from '@/lib/exports/data/company-info';
import { parseMoney, subtract } from '@/lib/money';
import { REASON_LABEL, STATUS_LABEL } from '@/modules/change-orders/schema';
import type {
  DocumentPayload,
  DocumentMeta,
  DocumentSection,
  DocumentSignatureBlock,
} from '@/lib/exports/types';

export async function buildChangeOrderPayload(
  companyId: string,
  changeOrderId: string,
): Promise<DocumentPayload | null> {
  const co = await getChangeOrder(companyId, changeOrderId);
  if (!co) return null;

  const company = await getActiveCompany();
  const project = await getProject(companyId, co.projectId);
  const customer = project
    ? await getCustomer(companyId, project.customerId)
    : undefined;
  const lines = await getChangeOrderLineItems(co.id);
  const codeMap = await loadCostCodeMap(
    companyId,
    lines.map((l) => l.costCodeId),
  );

  const subtotal = parseMoney(co.subtotal);
  const total = parseMoney(co.total);
  const markup = subtract(total, subtotal);

  const meta: DocumentMeta[] = [
    { label: 'CO #', value: co.number },
    { label: 'Reason', value: REASON_LABEL[co.reason] ?? co.reason },
  ];
  if (co.submittedAt) meta.push({ label: 'Submitted', value: co.submittedAt });
  if (co.approvedAt) meta.push({ label: 'Approved', value: co.approvedAt });
  meta.push({
    label: 'Schedule impact',
    value: `${co.scheduleImpactDays} day${co.scheduleImpactDays === 1 ? '' : 's'}`,
  });

  const sections: DocumentSection[] = [];
  if (co.description && co.description.trim() !== '') {
    sections.push({ title: 'Scope description', body: co.description });
  }

  // Approved COs that carry a typed customer signature show it as a signed
  // approval block; everything else gets a blank line to sign.
  const signatureBlock: DocumentSignatureBlock =
    co.status === 'approved'
      ? {
          label: 'Customer approval',
          signerName: co.customerSignedName ?? null,
        }
      : { label: 'Customer approval' };

  return {
    type: 'change_order',
    title: 'Change Order',
    number: co.number,
    statusLabel: STATUS_LABEL[co.status] ?? co.status,
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
    showLineCostCode: true,
    showLineMarkup: true,
    lines: lines.map((l) => ({
      code: codeMap.get(l.costCodeId)?.code ?? null,
      description: l.description,
      unit: l.unit,
      quantity: Number(l.quantity),
      unitCost: Number(l.unitCost),
      markupPercent: Number(l.markupPercent),
      lineTotal: Number(l.lineTotal),
    })),
    totals: [
      { label: 'Subtotal (cost)', value: subtotal },
      { label: 'Markup', value: markup },
      // Deduct (negative) COs carry a signed total; the renderer formats it
      // as -$X directly, so we don't set `negative` (which would wrap an
      // already-negative value in parentheses).
      { label: 'Change order total', value: total, bold: true },
    ],
    sections,
    signatureBlock,
    footerNote: null,
  };
}
