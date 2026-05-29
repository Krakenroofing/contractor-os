'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import type { AccountingAccount } from '@/db/schema';
import {
  findActiveAccountByName,
  findSectionHeader,
  getAccountingAccount,
  insertAccountingAccount,
  renameAccountingAccount,
  setAccountingAccountArchived,
} from '@/lib/data/accounting-accounts';
import {
  CATEGORY_GROUPS,
  CATEGORY_GROUP_LABEL,
  type CategoryGroup,
} from './categories';

// group → (section-header name, leaf account type, rollup group). Mirrors the
// contractor-categories seed so custom lines behave identically in reports.
const GROUP_META: Record<
  CategoryGroup,
  {
    header: string;
    type: AccountingAccount['type'];
    rollup: AccountingAccount['rollupGroup'];
  }
> = {
  income: { header: 'Income', type: 'income', rollup: 'income' },
  cogs: { header: 'Cost of Goods Sold', type: 'cogs_job_cost', rollup: 'cogs' },
  opex: { header: 'Operating Expense', type: 'expense', rollup: 'opex' },
};

export type CategoryActionResult = { ok: true } | { ok: false; error: string };

function revalidateCategorySurfaces() {
  revalidatePath('/settings/accounting-categories');
  // Pages that render the category picker need fresh options.
  revalidatePath('/banking/receipts');
  revalidatePath('/banking/rules');
  revalidatePath('/reports/profit-loss');
}

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  group: z.enum(CATEGORY_GROUPS),
});

export async function createCategoryAction(input: {
  name: string;
  group: string;
}): Promise<CategoryActionResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) {
    return { ok: false, error: 'You do not have permission to manage categories.' };
  }
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.flatten().fieldErrors.name?.[0] ?? 'Invalid input.',
    };
  }
  const { name, group } = parsed.data;
  const meta = GROUP_META[group];
  const companyId = await getActiveCompanyId();

  const dupe = await findActiveAccountByName(companyId, meta.rollup, name);
  if (dupe) {
    return {
      ok: false,
      error: `A "${name}" category already exists under ${CATEGORY_GROUP_LABEL[group]}.`,
    };
  }

  try {
    // Hang the new line off the group's section header, creating the header
    // if this company never installed the standard structure.
    let header = await findSectionHeader(companyId, meta.rollup);
    if (!header) {
      header = await insertAccountingAccount(companyId, {
        name: meta.header,
        type: meta.type,
        rollupGroup: meta.rollup,
        parentId: null,
      });
    }
    await insertAccountingAccount(companyId, {
      name,
      type: meta.type,
      rollupGroup: meta.rollup,
      parentId: header.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: `Could not create category: ${message}` };
  }

  revalidateCategorySurfaces();
  return { ok: true };
}

// Shared guard: load an account, confirm it belongs to the company and is a
// user-managed leaf category (not a section header, not a system bank/VAT
// account).
async function loadManageableLeaf(
  companyId: string,
  id: string,
): Promise<{ ok: true; account: AccountingAccount } | { ok: false; error: string }> {
  const account = await getAccountingAccount(companyId, id);
  if (!account) return { ok: false, error: 'Category not found.' };
  if (account.parentId === null) {
    return { ok: false, error: 'Section headers cannot be edited.' };
  }
  const managed: AccountingAccount['type'][] = ['income', 'expense', 'cogs_job_cost'];
  if (!managed.includes(account.type)) {
    return { ok: false, error: 'This account is managed by the system.' };
  }
  return { ok: true, account };
}

const renameSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Name is required').max(120),
});

export async function renameCategoryAction(input: {
  id: string;
  name: string;
}): Promise<CategoryActionResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) {
    return { ok: false, error: 'You do not have permission to manage categories.' };
  }
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.flatten().fieldErrors.name?.[0] ?? 'Invalid input.',
    };
  }
  const companyId = await getActiveCompanyId();
  const guard = await loadManageableLeaf(companyId, parsed.data.id);
  if (!guard.ok) return guard;

  const dupe = await findActiveAccountByName(
    companyId,
    guard.account.rollupGroup,
    parsed.data.name,
  );
  if (dupe && dupe.id !== guard.account.id) {
    return { ok: false, error: `A "${parsed.data.name}" category already exists in this group.` };
  }

  await renameAccountingAccount(companyId, parsed.data.id, parsed.data.name);
  revalidateCategorySurfaces();
  return { ok: true };
}

export async function setCategoryArchivedAction(input: {
  id: string;
  archived: boolean;
}): Promise<CategoryActionResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) {
    return { ok: false, error: 'You do not have permission to manage categories.' };
  }
  if (typeof input.id !== 'string' || typeof input.archived !== 'boolean') {
    return { ok: false, error: 'Invalid input.' };
  }
  const companyId = await getActiveCompanyId();
  const guard = await loadManageableLeaf(companyId, input.id);
  if (!guard.ok) return guard;

  await setAccountingAccountArchived(companyId, input.id, input.archived);
  revalidateCategorySurfaces();
  return { ok: true };
}
