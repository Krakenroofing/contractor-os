'use server';

import { revalidatePath } from 'next/cache';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate, ROLE_LABELS } from '@/lib/permissions';
import {
  appendActivity,
  EntityNotFoundError,
  updateEntityStatus,
} from '@/lib/mock-store';
import {
  ENTITY_LABEL,
  ENTITY_RESOURCE,
  ENTITY_TYPES,
  resolveTransition,
  statusDisplay,
  type EntityType,
} from '@/lib/status-machine';

export type TransitionState = {
  ok?: boolean;
  formError?: string;
};

// `/dashboard` is included for any entity transition that can move money —
// invoices and payments — because the dashboard's outstanding-AR /
// total-paid / cash-this-month tiles are derived live and must refresh
// alongside the source pages. Estimates / COs / POs also flow into
// projected GP via job-costing, so they get `/dashboard` too.
const REVALIDATE_BY_ENTITY: Record<EntityType, (id: string) => string[]> = {
  estimate: (id) => [`/estimates`, `/estimates/${id}`, `/projects`, `/dashboard`],
  proposal: (id) => [`/proposals`, `/proposals/${id}`, `/projects`, `/dashboard`],
  change_order: (id) => [
    `/change-orders`,
    `/change-orders/${id}`,
    `/projects`,
    `/dashboard`,
  ],
  purchase_order: (id) => [
    `/purchase-orders`,
    `/purchase-orders/${id}`,
    `/projects`,
    `/dashboard`,
  ],
  invoice: (id) => [
    `/invoices`,
    `/invoices/${id}`,
    `/accounts-receivable`,
    `/retainage`,
    `/projects`,
    `/dashboard`,
  ],
  payment: (id) => [
    `/payments`,
    `/payments/${id}`,
    `/accounts-receivable`,
    `/projects`,
    `/dashboard`,
  ],
};

function isEntityType(v: unknown): v is EntityType {
  return typeof v === 'string' && (ENTITY_TYPES as readonly string[]).includes(v);
}

export async function transitionStatusAction(
  _prev: TransitionState,
  formData: FormData,
): Promise<TransitionState> {
  const entityRaw = formData.get('entityType');
  const entityId = formData.get('entityId');
  const action = formData.get('action');
  const currentStatus = formData.get('currentStatus');

  if (!isEntityType(entityRaw)) {
    return { formError: 'Unknown entity type' };
  }
  if (typeof entityId !== 'string' || entityId === '') {
    return { formError: 'Missing entity id' };
  }
  if (typeof action !== 'string' || action === '') {
    return { formError: 'Missing action' };
  }
  if (typeof currentStatus !== 'string') {
    return { formError: 'Missing current status' };
  }

  const role = await getActiveRole();
  if (!canCreate(role, ENTITY_RESOURCE[entityRaw])) {
    return { formError: 'Not allowed to change this status.' };
  }

  const transition = resolveTransition(entityRaw, currentStatus, action);
  if (!transition) {
    return {
      formError: `Cannot ${action} from status "${currentStatus}".`,
    };
  }

  const companyId = await getActiveCompanyId();

  // Voiding a PO retires an order that shouldn't have been raised. Real cost
  // already booked against it has to be unwound first, or the void would
  // silently orphan received quantities and vendor bills.
  if (entityRaw === 'purchase_order' && action === 'mark_void') {
    const [{ listPoReceiptsForPO }, { listReceipts }] = await Promise.all([
      import('@/lib/data/po-receipts'),
      import('@/lib/data/receipts'),
    ]);
    const poReceipts = await listPoReceiptsForPO(entityId);
    if (poReceipts.length > 0) {
      return {
        formError: `This PO has ${poReceipts.length} shipment${
          poReceipts.length === 1 ? '' : 's'
        } received against it. Delete those receipts first (Receive shipment → history), then void the PO.`,
      };
    }
    const bills = (await listReceipts(companyId, { limit: 2000 })).filter(
      (r) => r.purchaseOrderId === entityId && r.status !== 'void',
    );
    if (bills.length > 0) {
      return {
        formError: `This PO already has ${bills.length} bill${
          bills.length === 1 ? '' : 's'
        } created from it. Void or delete the bill first, then void the PO.`,
      };
    }
  }

  // Voiding an invoice that has payments would silently drop those payments
  // from the ledger (the GL skips payments on void invoices), leaving the
  // matched deposits unbalanced in Undeposited Funds. Payments have to go
  // first — or the correction is a credit memo.
  if (entityRaw === 'invoice' && action === 'mark_void') {
    const { getInvoicePayments } = await import('@/lib/data/invoice-payments');
    const pays = await getInvoicePayments(entityId);
    if (pays.length > 0) {
      return {
        formError: `This invoice has ${pays.length} payment${pays.length === 1 ? '' : 's'} recorded — voiding it would orphan that cash. Issue a credit memo for the correction, or remove the payments first.`,
      };
    }
  }

  // Mark-Paid on an invoice carries an optional paid-date so VAT / cash
  // reports bucket the synthetic payment into the right quarter. Validate
  // it lightly; fall through to "today" inside the data layer if missing.
  let paidDate: string | undefined;
  if (entityRaw === 'invoice' && action === 'mark_paid') {
    const raw = formData.get('paidDate');
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      paidDate = raw;
    }
  }

  let previousStatus: string;
  try {
    const result = await updateEntityStatus(
      companyId,
      entityRaw,
      entityId,
      transition.to,
      paidDate ? { paidDate } : undefined,
    );
    previousStatus = result.previousStatus;
  } catch (err) {
    if (err instanceof EntityNotFoundError) {
      return { formError: 'Record not found in active company.' };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to update status: ${message}` };
  }

  // Keep the GL current on invoice send / void / mark-paid (best-effort —
  // a GL hiccup must never block the status change; Rebuild can resync).
  if (entityRaw === 'invoice') {
    try {
      const { syncInvoiceGl } = await import(
        '@/modules/accounting/lib/gl-posting'
      );
      await syncInvoiceGl(companyId, entityId);
    } catch {
      /* best-effort */
    }
    // Voiding / un-voiding an invoice flips whether its project-credit lines
    // count toward the contract reduction — re-roll the project's contract
    // totals from source. Best-effort.
    try {
      const { getInvoice } = await import('@/lib/data/invoices');
      const { recomputeProjectContractTotals } = await import(
        '@/lib/data/change-orders'
      );
      const inv = await getInvoice(companyId, entityId);
      if (inv) await recomputeProjectContractTotals(inv.projectId);
    } catch {
      /* best-effort */
    }
  }

  // Append activity log entry.
  const fromDisplay = statusDisplay(entityRaw, previousStatus).label;
  const toDisplay = statusDisplay(entityRaw, transition.to).label;
  appendActivity(companyId, {
    entityType: entityRaw,
    entityId,
    kind: 'status_changed',
    summary: `${ENTITY_LABEL[entityRaw]} status: ${fromDisplay} → ${toDisplay}`,
    actorRole: ROLE_LABELS[role],
  });

  for (const path of REVALIDATE_BY_ENTITY[entityRaw](entityId)) {
    revalidatePath(path);
  }

  return { ok: true };
}
