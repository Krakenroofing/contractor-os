'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import {
  createCostCode,
  DuplicateCostCodeError,
  setCostCodeActive,
  updateCostCode,
} from '@/lib/data/cost-codes';
import { costCodeFormSchema } from './schema';

export type CreateCostCodeState = {
  errors?: Record<string, string[]>;
  formError?: string;
};

// Shape handed back to inline callers. A superset of every form's cost-code
// option shape ({id,code,description} and {id,label}) plus defaultCost, so a
// picker can append + select the new code without reshaping.
export type InlineCostCode = {
  id: string;
  code: string;
  description: string;
  label: string;
  category: string;
  defaultCost: number | null;
};

export type InlineCreateCostCodeResult =
  | { ok: true; item: InlineCostCode }
  | { ok: false; error?: string; errors?: Record<string, string[]> };

// RPC-style create used by the "+ Add new cost code" drawer. Unlike
// createCostCodeAction it does NOT redirect — it returns the created code so
// the caller (a half-filled estimate / CO / PO / time entry) can select it
// inline and keep every other field intact.
export async function createCostCodeInlineAction(input: {
  code: string;
  description: string;
  category?: string;
  defaultCost?: string;
}): Promise<InlineCreateCostCodeResult> {
  const role = await getActiveRole();
  if (!canCreate(role, 'cost_codes')) {
    return { ok: false, error: 'You do not have permission to manage cost codes.' };
  }

  const parsed = costCodeFormSchema.safeParse({
    code: input.code,
    description: input.description,
    category: input.category ?? 'material',
    division: '',
    sortOrder: '',
    defaultCost: input.defaultCost ?? '',
    notes: '',
  });
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  try {
    const created = await createCostCode(companyId, {
      code: data.code,
      description: data.description,
      category: data.category,
      division: data.division ?? null,
      sortOrder: data.sortOrder,
      defaultCost: data.defaultCost,
      notes: data.notes ?? null,
    });
    revalidatePath('/cost-codes');
    return {
      ok: true,
      item: {
        id: created.id,
        code: created.code,
        description: created.description,
        label: `${created.code} — ${created.description}`,
        category: created.category,
        defaultCost:
          created.defaultCost !== null ? Number(created.defaultCost) : null,
      },
    };
  } catch (err) {
    if (err instanceof DuplicateCostCodeError) {
      return {
        ok: false,
        errors: {
          code: ['That code already exists in your library or the global library'],
        },
      };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: `Failed to create cost code: ${message}` };
  }
}

export async function createCostCodeAction(
  _prev: CreateCostCodeState,
  formData: FormData,
): Promise<CreateCostCodeState> {
  const parsed = costCodeFormSchema.safeParse({
    code: formData.get('code'),
    description: formData.get('description'),
    category: formData.get('category'),
    division: formData.get('division'),
    sortOrder: formData.get('sortOrder'),
    defaultCost: formData.get('defaultCost'),
    notes: formData.get('notes'),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  let createdId: string;

  try {
    const created = await createCostCode(companyId, {
      code: data.code,
      description: data.description,
      category: data.category,
      division: data.division ?? null,
      sortOrder: data.sortOrder,
      defaultCost: data.defaultCost,
      notes: data.notes ?? null,
    });
    createdId = created.id;
  } catch (err) {
    if (err instanceof DuplicateCostCodeError) {
      return { errors: { code: ['That code already exists in your library or the global library'] } };
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to create cost code: ${message}` };
  }

  revalidatePath('/cost-codes');
  redirect(`/cost-codes/${createdId}`);
}

export type UpdateCostCodeState = {
  errors?: Record<string, string[]>;
  formError?: string;
  ok?: boolean;
};

export async function updateCostCodeAction(
  id: string,
  _prev: UpdateCostCodeState,
  formData: FormData,
): Promise<UpdateCostCodeState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'cost_codes')) {
    return { formError: 'You do not have permission to edit cost codes.' };
  }

  const parsed = costCodeFormSchema
    .omit({ code: true })
    .safeParse({
      description: formData.get('description'),
      category: formData.get('category'),
      division: formData.get('division'),
      sortOrder: formData.get('sortOrder'),
      defaultCost: formData.get('defaultCost'),
      notes: formData.get('notes'),
    });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const companyId = await getActiveCompanyId();
  const updated = await updateCostCode(companyId, id, {
    description: parsed.data.description,
    category: parsed.data.category,
    division: parsed.data.division ?? null,
    sortOrder: parsed.data.sortOrder,
    defaultCost: parsed.data.defaultCost,
    notes: parsed.data.notes ?? null,
  });

  if (!updated) {
    return { formError: 'Cost code not found, or it belongs to the read-only global library.' };
  }

  revalidatePath('/cost-codes');
  revalidatePath(`/cost-codes/${id}`);
  return { ok: true };
}

export async function toggleCostCodeActiveAction(id: string, nextValue: boolean): Promise<void> {
  const role = await getActiveRole();
  if (!canCreate(role, 'cost_codes')) return;
  const companyId = await getActiveCompanyId();
  await setCostCodeActive(companyId, id, nextValue);
  revalidatePath('/cost-codes');
  revalidatePath(`/cost-codes/${id}`);
}

// Phase 2 cost-codes: update default_cost from elsewhere (PO line "Update
// defaults" dialog). Tiny single-field write — separate action keeps the
// surface small and the permission check explicit.
export async function updateCostCodeDefaultCostAction(input: {
  id: string;
  defaultCost: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const role = await getActiveRole();
  if (!canCreate(role, 'cost_codes')) {
    return { ok: false, error: 'No permission to edit cost codes.' };
  }
  const companyId = await getActiveCompanyId();

  // Validate and normalize the value: empty / null clears the standing
  // rate; otherwise round to 2dp and reject negatives.
  let value: string | null = null;
  if (input.defaultCost !== null && input.defaultCost !== '') {
    const n = Number(input.defaultCost);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: 'Default cost must be a non-negative number.' };
    }
    value = (Math.round(n * 100) / 100).toFixed(2);
  }

  const updated = await updateCostCode(companyId, input.id, {
    defaultCost: value,
  });
  if (!updated) {
    return {
      ok: false,
      error:
        'Cost code not found — or it lives in the read-only global library.',
    };
  }
  revalidatePath('/cost-codes');
  revalidatePath(`/cost-codes/${input.id}`);
  // PO and estimate forms read costCodes; revalidating them too so the
  // next render picks up the new default.
  revalidatePath('/purchase-orders/new');
  revalidatePath('/estimates');
  return { ok: true };
}

// ===== Roofing cost-code bulk-install =====

import { installRoofingCostCodes } from '@/lib/seeds/roofing-cost-codes.install';

export type InstallRoofingCostCodesState = {
  formError?: string;
  result?: {
    inserted: number;
    skipped: number;
    skippedCodes: string[];
  };
};

export async function installRoofingCostCodesAction(
  _prev: InstallRoofingCostCodesState,
  _formData: FormData,
): Promise<InstallRoofingCostCodesState> {
  const role = await getActiveRole();
  if (!canCreate(role, 'cost_codes')) {
    return { formError: 'You do not have permission to manage cost codes.' };
  }
  const companyId = await getActiveCompanyId();
  try {
    const result = await installRoofingCostCodes(companyId);
    revalidatePath('/cost-codes');
    return { result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { formError: `Failed to install roofing codes: ${message}` };
  }
}
