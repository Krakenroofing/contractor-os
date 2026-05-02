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

const REVALIDATE_BY_ENTITY: Record<EntityType, (id: string) => string[]> = {
  estimate: (id) => [`/estimates`, `/estimates/${id}`, `/projects`],
  proposal: (id) => [`/proposals`, `/proposals/${id}`, `/projects`],
  change_order: (id) => [`/change-orders`, `/change-orders/${id}`, `/projects`],
  purchase_order: (id) => [`/purchase-orders`, `/purchase-orders/${id}`, `/projects`],
  invoice: (id) => [
    `/invoices`,
    `/invoices/${id}`,
    `/accounts-receivable`,
    `/retainage`,
    `/projects`,
  ],
  payment: (id) => [`/payments`, `/payments/${id}`, `/accounts-receivable`, `/projects`],
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

  let previousStatus: string;
  try {
    const result = await updateEntityStatus(companyId, entityRaw, entityId, transition.to);
    previousStatus = result.previousStatus;
  } catch (err) {
    if (err instanceof EntityNotFoundError) {
      return { formError: 'Record not found in active company.' };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to update status: ${message}` };
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
