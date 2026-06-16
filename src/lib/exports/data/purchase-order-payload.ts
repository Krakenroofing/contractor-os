import 'server-only';
import {
  getPurchaseOrder,
  getPurchaseOrderLines,
} from '@/lib/data/purchase-orders';
import { getProject } from '@/lib/data/projects';
import { getVendor } from '@/lib/data/vendors';
import { loadCostCodeMap } from '@/lib/data/cost-codes';
import { getActiveCompany } from '@/lib/active-company';
import { buildCompanyInfo } from '@/lib/exports/data/company-info';
import { parseMoney } from '@/lib/money';
import type {
  DocumentPayload,
  DocumentMeta,
  DocumentSection,
  DocumentTotalsRow,
} from '@/lib/exports/types';

export async function buildPurchaseOrderPayload(
  companyId: string,
  purchaseOrderId: string,
): Promise<DocumentPayload | null> {
  const po = await getPurchaseOrder(companyId, purchaseOrderId);
  if (!po) return null;

  const company = await getActiveCompany();
  const vendor = await getVendor(companyId, po.vendorId);
  const project = po.projectId
    ? await getProject(companyId, po.projectId)
    : undefined;
  const lines = await getPurchaseOrderLines(po.id);
  const codeMap = await loadCostCodeMap(
    companyId,
    lines.map((l) => l.costCodeId),
  );

  const subtotal = parseMoney(po.subtotal);
  const tax = parseMoney(po.taxAmount);
  const shipping = parseMoney(po.shipping);
  const total = parseMoney(po.total);

  const meta: DocumentMeta[] = [
    { label: 'PO #', value: po.number },
  ];
  if (po.issueDate) meta.push({ label: 'Order date', value: po.issueDate });
  if (po.expectedDeliveryDate) {
    meta.push({ label: 'Expected delivery', value: po.expectedDeliveryDate });
  }

  const sections: DocumentSection[] = [];
  if (po.notes && po.notes.trim() !== '') {
    sections.push({ title: 'Notes', body: po.notes });
  }

  const totals: DocumentTotalsRow[] = [{ label: 'Subtotal', value: subtotal }];
  if (tax > 0) totals.push({ label: 'Tax', value: tax });
  if (shipping > 0) totals.push({ label: 'Freight / duty', value: shipping });
  totals.push({ label: 'Total', value: total, bold: true });

  return {
    type: 'purchase_order',
    title: 'Purchase Order',
    number: po.number,
    statusLabel: po.status,
    company: await buildCompanyInfo(company),
    recipientLabel: 'Vendor',
    // A PO is addressed TO the vendor (FROM the company in the header), so
    // the vendor fills the "bill to" recipient block. Re-label it "Vendor".
    customer: vendor
      ? {
          name: vendor.name,
          contact: vendor.primaryContactName,
          email: vendor.email,
          phone: vendor.phone,
          addressLine1: vendor.addressLine1,
          city: vendor.city,
          state: vendor.state,
          postalCode: vendor.postalCode,
          attentionLabel: 'Attn',
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
    showLineMarkup: false,
    lines: lines.map((l) => ({
      code: codeMap.get(l.costCodeId)?.code ?? null,
      description: l.description,
      unit: l.unit,
      quantity: Number(l.quantityOrdered),
      unitCost: Number(l.unitCost),
      lineTotal: Number(l.lineTotal),
    })),
    totals,
    sections,
    footerNote: null,
  };
}
