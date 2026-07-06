'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  calcLandedCost,
  toMoneyString,
  toPercentString,
  toQuantityString,
  DEFAULT_PROCESSING_FEE_PERCENT,
  DEFAULT_PROCESSING_FEE_CAP,
} from '@/lib/money';
import {
  createLandedCost,
  updateLandedCost,
  markLandedCostReconciled,
} from '@/lib/data/landed-costs';
import { landedCostFormSchema } from './schema';

export type CreateLandedCostState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export async function createLandedCostAction(
  _prev: CreateLandedCostState,
  formData: FormData,
): Promise<CreateLandedCostState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'landed_cost')) {
    return { formError: 'You do not have permission to create landed cost entries.' };
  }

  const parsed = landedCostFormSchema.safeParse({
    name: formData.get('name'),
    projectId: formData.get('projectId'),
    vendorId: formData.get('vendorId') ?? '',
    purchaseOrderId: formData.get('purchaseOrderId') ?? '',
    carrier: formData.get('carrier'),
    itemDescription: formData.get('itemDescription') ?? '',
    tariffCode: formData.get('tariffCode') ?? '',
    quantity: formData.get('quantity') ?? '0',
    unitCost: formData.get('unitCost') ?? '0',
    flDelivery: formData.get('flDelivery') ?? '0',
    crating: formData.get('crating') ?? '0',
    freightCost: formData.get('freightCost') ?? '0',
    insurance: formData.get('insurance') ?? '0',
    dutyPercent: formData.get('dutyPercent') ?? '0',
    vatPercent: formData.get('vatPercent') ?? '0',
    envLevyPercent: formData.get('envLevyPercent') ?? '0',
    excisePercent: formData.get('excisePercent') ?? '0',
    brokerage: formData.get('brokerage') ?? '0',
    portFees: formData.get('portFees') ?? '0',
    localDelivery: formData.get('localDelivery') ?? '0',
    notes: formData.get('notes') ?? '',
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  // Server-authoritative compute via canonical helper.
  const totals = calcLandedCost({
    quantity: Number(data.quantity),
    unitCost: Number(data.unitCost),
    flDelivery: Number(data.flDelivery),
    crating: Number(data.crating),
    freightCost: Number(data.freightCost),
    insurance: Number(data.insurance),
    dutyPercent: Number(data.dutyPercent),
    vatPercent: Number(data.vatPercent),
    envLevyPercent: Number(data.envLevyPercent),
    excisePercent: Number(data.excisePercent),
    brokerage: Number(data.brokerage),
    portFees: Number(data.portFees),
    localDelivery: Number(data.localDelivery),
  });

  // Freeze the estimate at creation so we can show estimate → actual variance.
  const estimateSnapshot = {
    capturedAt: new Date().toISOString(),
    materialCost: totals.supplierSubtotal,
    flDelivery: Number(data.flDelivery),
    crating: Number(data.crating),
    freightCost: Number(data.freightCost),
    insurance: Number(data.insurance),
    dutyAmount: totals.duty,
    exciseAmount: totals.excise,
    envLevyAmount: totals.envLevy,
    processingFeeAmount: totals.processingFee,
    vatAmount: totals.vat,
    brokerage: Number(data.brokerage),
    portFees: Number(data.portFees),
    localDelivery: Number(data.localDelivery),
    totalLandedCost: totals.total,
    perUnitCost: totals.perUnit,
  };

  let createdId: string;
  try {
    const lc = await createLandedCost(companyId, {
      name: data.name,
      projectId: data.projectId,
      vendorId: emptyToNull(data.vendorId ?? null),
      purchaseOrderId: emptyToNull(data.purchaseOrderId ?? null),
      carrier: data.carrier,
      itemDescription: emptyToNull(data.itemDescription ?? null),
      tariffCode: emptyToNull(data.tariffCode ?? null),
      quantity: toQuantityString(Number(data.quantity)),
      unitCost: toQuantityString(Number(data.unitCost)),
      materialCost: toMoneyString(totals.supplierSubtotal),
      flDelivery: toMoneyString(Number(data.flDelivery)),
      crating: toMoneyString(Number(data.crating)),
      freightCost: toMoneyString(Number(data.freightCost)),
      insurance: toMoneyString(Number(data.insurance)),
      dutyPercent: toPercentString(Number(data.dutyPercent)),
      vatPercent: toPercentString(Number(data.vatPercent)),
      envLevyPercent: toPercentString(Number(data.envLevyPercent)),
      excisePercent: toPercentString(Number(data.excisePercent)),
      brokerage: toMoneyString(Number(data.brokerage)),
      portFees: toMoneyString(Number(data.portFees)),
      localDelivery: toMoneyString(Number(data.localDelivery)),
      fob: toMoneyString(totals.fob),
      cif: toMoneyString(totals.cif),
      dutyAmount: toMoneyString(totals.duty),
      exciseAmount: toMoneyString(totals.excise),
      envLevyAmount: toMoneyString(totals.envLevy),
      processingFeePercent: toPercentString(DEFAULT_PROCESSING_FEE_PERCENT),
      processingFeeCap: toMoneyString(DEFAULT_PROCESSING_FEE_CAP),
      processingFeeAmount: toMoneyString(totals.processingFee),
      vatAmount: toMoneyString(totals.vat),
      totalLandedCost: toMoneyString(totals.total),
      perUnitCost: toQuantityString(totals.perUnit),
      notes: emptyToNull(data.notes ?? null),
      estimateSnapshot,
    });
    createdId = lc.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save landed-cost entry: ${message}` };
  }

  revalidatePath('/landed-cost');
  revalidatePath('/purchase-orders');
  redirect(`/landed-cost/${createdId}`);
}

// ---------------------------------------------------------------------------
// Update — same form schema as create.
// ---------------------------------------------------------------------------

export async function updateLandedCostAction(
  id: string,
  _prev: CreateLandedCostState,
  formData: FormData,
): Promise<CreateLandedCostState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'landed_cost')) {
    return { formError: 'You do not have permission to edit landed cost entries.' };
  }

  const parsed = landedCostFormSchema.safeParse({
    name: formData.get('name'),
    projectId: formData.get('projectId'),
    vendorId: formData.get('vendorId') ?? '',
    purchaseOrderId: formData.get('purchaseOrderId') ?? '',
    carrier: formData.get('carrier'),
    itemDescription: formData.get('itemDescription') ?? '',
    tariffCode: formData.get('tariffCode') ?? '',
    quantity: formData.get('quantity') ?? '0',
    unitCost: formData.get('unitCost') ?? '0',
    flDelivery: formData.get('flDelivery') ?? '0',
    crating: formData.get('crating') ?? '0',
    freightCost: formData.get('freightCost') ?? '0',
    insurance: formData.get('insurance') ?? '0',
    dutyPercent: formData.get('dutyPercent') ?? '0',
    vatPercent: formData.get('vatPercent') ?? '0',
    envLevyPercent: formData.get('envLevyPercent') ?? '0',
    excisePercent: formData.get('excisePercent') ?? '0',
    brokerage: formData.get('brokerage') ?? '0',
    portFees: formData.get('portFees') ?? '0',
    localDelivery: formData.get('localDelivery') ?? '0',
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const data = parsed.data;
  const companyId = await getActiveCompanyId();

  const totals = calcLandedCost({
    quantity: Number(data.quantity),
    unitCost: Number(data.unitCost),
    flDelivery: Number(data.flDelivery),
    crating: Number(data.crating),
    freightCost: Number(data.freightCost),
    insurance: Number(data.insurance),
    dutyPercent: Number(data.dutyPercent),
    vatPercent: Number(data.vatPercent),
    envLevyPercent: Number(data.envLevyPercent),
    excisePercent: Number(data.excisePercent),
    brokerage: Number(data.brokerage),
    portFees: Number(data.portFees),
    localDelivery: Number(data.localDelivery),
  });

  try {
    const out = await updateLandedCost(companyId, id, {
      name: data.name,
      projectId: data.projectId,
      vendorId: emptyToNull(data.vendorId ?? null),
      purchaseOrderId: emptyToNull(data.purchaseOrderId ?? null),
      carrier: data.carrier,
      itemDescription: emptyToNull(data.itemDescription ?? null),
      tariffCode: emptyToNull(data.tariffCode ?? null),
      quantity: toQuantityString(Number(data.quantity)),
      unitCost: toQuantityString(Number(data.unitCost)),
      materialCost: toMoneyString(totals.supplierSubtotal),
      flDelivery: toMoneyString(Number(data.flDelivery)),
      crating: toMoneyString(Number(data.crating)),
      freightCost: toMoneyString(Number(data.freightCost)),
      insurance: toMoneyString(Number(data.insurance)),
      dutyPercent: toPercentString(Number(data.dutyPercent)),
      vatPercent: toPercentString(Number(data.vatPercent)),
      envLevyPercent: toPercentString(Number(data.envLevyPercent)),
      excisePercent: toPercentString(Number(data.excisePercent)),
      brokerage: toMoneyString(Number(data.brokerage)),
      portFees: toMoneyString(Number(data.portFees)),
      localDelivery: toMoneyString(Number(data.localDelivery)),
      fob: toMoneyString(totals.fob),
      cif: toMoneyString(totals.cif),
      dutyAmount: toMoneyString(totals.duty),
      exciseAmount: toMoneyString(totals.excise),
      envLevyAmount: toMoneyString(totals.envLevy),
      processingFeePercent: toPercentString(DEFAULT_PROCESSING_FEE_PERCENT),
      processingFeeCap: toMoneyString(DEFAULT_PROCESSING_FEE_CAP),
      processingFeeAmount: toMoneyString(totals.processingFee),
      vatAmount: toMoneyString(totals.vat),
      totalLandedCost: toMoneyString(totals.total),
      perUnitCost: toQuantityString(totals.perUnit),
      notes: emptyToNull(data.notes ?? null),
    });
    if (!out) {
      return {
        formError:
          'Landed cost entry not found, or editing is not available in demo mode.',
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to save landed-cost entry: ${message}` };
  }

  revalidatePath('/landed-cost');
  revalidatePath(`/landed-cost/${id}`);
  revalidatePath('/purchase-orders');
  redirect(`/landed-cost/${id}`);
}

// ---------------------------------------------------------------------------
// Reconcile — stamp/unstamp an entry as confirmed against the broker documents.
// ---------------------------------------------------------------------------

export async function reconcileLandedCostAction(
  id: string,
  reconciled: boolean,
): Promise<{ ok?: boolean; formError?: string }> {
  const role = await getActiveRole();
  if (!canCreate(role, 'landed_cost')) {
    return { formError: 'You do not have permission to reconcile entries.' };
  }
  const companyId = await getActiveCompanyId();
  const out = await markLandedCostReconciled(companyId, id, reconciled);
  if (!out) {
    return {
      formError:
        'Entry not found, or reconciling is not available in demo mode.',
    };
  }
  revalidatePath('/landed-cost');
  revalidatePath(`/landed-cost/${id}`);
  return { ok: true };
}
