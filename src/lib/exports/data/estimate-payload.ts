import 'server-only';
import { getEstimate, getEstimateLineItems } from '@/lib/data/estimates';
import { getProject } from '@/lib/data/projects';
import { getCustomer } from '@/lib/data/customers';
import { loadCostCodeMap } from '@/lib/data/cost-codes';
import { getActiveCompany } from '@/lib/active-company';
import { buildCompanyInfo } from '@/lib/exports/data/company-info';
import { parseMoney, subtract } from '@/lib/money';
import type { DocumentPayload, DocumentMeta } from '@/lib/exports/types';

export async function buildEstimatePayload(
  companyId: string,
  estimateId: string,
): Promise<DocumentPayload | null> {
  const estimate = await getEstimate(companyId, estimateId);
  if (!estimate) return null;

  const company = await getActiveCompany();
  const project = await getProject(companyId, estimate.projectId);
  const customer = project
    ? await getCustomer(companyId, project.customerId)
    : undefined;
  const lines = await getEstimateLineItems(estimate.id);
  const codeMap = await loadCostCodeMap(
    companyId,
    lines.map((l) => l.costCodeId),
  );

  const subtotal = parseMoney(estimate.subtotal);
  const total = parseMoney(estimate.total);
  const markup = subtract(total, subtotal);

  const meta: DocumentMeta[] = [
    { label: 'Estimate #', value: estimate.number },
    { label: 'Version', value: String(estimate.version) },
  ];
  if (estimate.validUntil) {
    meta.push({ label: 'Valid until', value: estimate.validUntil });
  }

  return {
    type: 'estimate',
    title: 'Estimate',
    number: estimate.number,
    statusLabel: estimate.status,
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
          number: project.number,
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
      { label: 'Total', value: total, bold: true },
    ],
    sections: [],
    footerNote: null,
  };
}
