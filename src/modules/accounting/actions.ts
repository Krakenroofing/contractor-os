'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import type { AccountingAccount } from '@/db/schema';
import {
  countAccountChildren,
  findActiveAccountByName,
  findSectionHeader,
  getAccountingAccount,
  insertAccountingAccount,
  listAccountingAccounts,
  renameAccountingAccount,
  setAccountingAccountArchived,
  setAccountingAccountGroup,
  setAccountingAccountParent,
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
  asset: { header: 'Assets', type: 'asset', rollup: 'asset' },
  liability: { header: 'Liabilities', type: 'liability', rollup: 'liability' },
  equity: { header: 'Equity', type: 'equity', rollup: 'equity' },
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
  /** QB-style subaccount: the CATEGORY (not section header) to nest under. */
  parentCategoryId: z
    .union([z.string().uuid(), z.literal('')])
    .optional()
    .transform((v) => (v ? v : null)),
});

/**
 * A valid subaccount parent is a manageable CATEGORY in the same group —
 * i.e. its own parent is a section header (top level), it isn't archived,
 * and it isn't a subaccount itself (tree caps at header → category → sub).
 */
async function validateParentCategory(
  companyId: string,
  parentId: string,
  rollup: AccountingAccount['rollupGroup'],
): Promise<{ ok: true; parent: AccountingAccount } | { ok: false; error: string }> {
  const parent = await getAccountingAccount(companyId, parentId);
  if (!parent) return { ok: false, error: 'Parent category not found.' };
  if (parent.isArchived) {
    return { ok: false, error: 'The parent category is archived.' };
  }
  if (parent.rollupGroup !== rollup) {
    return { ok: false, error: 'A subaccount must stay in the same group as its parent.' };
  }
  if (parent.parentId === null) {
    return { ok: false, error: 'Pick a category, not a section header.' };
  }
  const grandparent = await getAccountingAccount(companyId, parent.parentId);
  if (grandparent && grandparent.parentId !== null) {
    return {
      ok: false,
      error: 'That category is itself a subaccount — nesting stops at one level.',
    };
  }
  return { ok: true, parent };
}

export async function createCategoryAction(input: {
  name: string;
  group: string;
  parentCategoryId?: string;
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
  const { name, group, parentCategoryId } = parsed.data;
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
    let parentId: string;
    if (parentCategoryId) {
      const check = await validateParentCategory(companyId, parentCategoryId, meta.rollup);
      if (!check.ok) return check;
      parentId = check.parent.id;
    } else {
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
      parentId = header.id;
    }
    await insertAccountingAccount(companyId, {
      name,
      type: meta.type,
      rollupGroup: meta.rollup,
      parentId,
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
  const managed: AccountingAccount['type'][] = [
    'income',
    'expense',
    'cogs_job_cost',
    'asset',
    'liability',
    'equity',
  ];
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

const setGroupSchema = z.object({
  id: z.string().uuid(),
  group: z.enum(['cogs', 'opex']),
});

/** Move an expense category between the two P&L sections (COGS ↔ OpEx).
 *  Statement placement is driven by rollup_group, so the flip restates ALL
 *  history — exactly what side-by-side QB comparison needs. Subaccounts move
 *  with their parent; a subaccount moved on its own becomes top-level in the
 *  target section (it can't stay under a parent in the other group). */
export async function setCategoryGroupAction(input: {
  id: string;
  group: string;
}): Promise<CategoryActionResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) {
    return { ok: false, error: 'You do not have permission to manage categories.' };
  }
  const parsed = setGroupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };

  const companyId = await getActiveCompanyId();
  const guard = await loadManageableLeaf(companyId, parsed.data.id);
  if (!guard.ok) return guard;
  const account = guard.account;

  if (account.rollupGroup !== 'cogs' && account.rollupGroup !== 'opex') {
    return {
      ok: false,
      error:
        'Only Cost of Goods Sold and Operating Expense categories can move between those two sections.',
    };
  }
  if (account.rollupGroup === parsed.data.group) return { ok: true };

  const meta = GROUP_META[parsed.data.group];
  const dupe = await findActiveAccountByName(companyId, meta.rollup, account.name);
  if (dupe && dupe.id !== account.id) {
    return {
      ok: false,
      error: `A "${account.name}" category already exists under ${CATEGORY_GROUP_LABEL[parsed.data.group]}.`,
    };
  }

  try {
    let header = await findSectionHeader(companyId, meta.rollup);
    if (!header) {
      header = await insertAccountingAccount(companyId, {
        name: meta.header,
        type: meta.type,
        rollupGroup: meta.rollup,
        parentId: null,
      });
    }
    await setAccountingAccountGroup(companyId, account.id, {
      type: meta.type,
      rollupGroup: meta.rollup,
      parentId: header.id,
    });
    // Subaccounts follow their parent (they keep parentId = the account, so
    // only their type/rollup need to flip).
    const children = (await listAccountingAccounts(companyId)).filter(
      (a) => a.parentId === account.id,
    );
    for (const child of children) {
      await setAccountingAccountGroup(companyId, child.id, {
        type: meta.type,
        rollupGroup: meta.rollup,
        parentId: account.id,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: `Could not move the category: ${message}` };
  }

  revalidateCategorySurfaces();
  return { ok: true };
}

const setParentSchema = z.object({
  id: z.string().uuid(),
  // '' = revert to a top-level category under the group's section header.
  parentCategoryId: z
    .union([z.string().uuid(), z.literal('')])
    .transform((v) => (v ? v : null)),
});

export async function setCategoryParentAction(input: {
  id: string;
  parentCategoryId: string;
}): Promise<CategoryActionResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'settings')) {
    return { ok: false, error: 'You do not have permission to manage categories.' };
  }
  const parsed = setParentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };

  const companyId = await getActiveCompanyId();
  const guard = await loadManageableLeaf(companyId, parsed.data.id);
  if (!guard.ok) return guard;
  const account = guard.account;

  if (parsed.data.parentCategoryId === account.id) {
    return { ok: false, error: 'A category cannot be its own parent.' };
  }

  if (parsed.data.parentCategoryId) {
    // Becoming a subaccount: the account must not have children of its own
    // (tree caps at header → category → subaccount).
    const childCount = await countAccountChildren(companyId, account.id);
    if (childCount > 0) {
      return {
        ok: false,
        error:
          'This category has subaccounts of its own — move those out before making it a subaccount.',
      };
    }
    const check = await validateParentCategory(
      companyId,
      parsed.data.parentCategoryId,
      account.rollupGroup,
    );
    if (!check.ok) return check;
    await setAccountingAccountParent(companyId, account.id, check.parent.id);
  } else {
    // Revert to top level under the group's section header.
    const header = await findSectionHeader(companyId, account.rollupGroup);
    if (!header) {
      return { ok: false, error: 'Section header for this group is missing.' };
    }
    if (account.parentId === header.id) return { ok: true };
    await setAccountingAccountParent(companyId, account.id, header.id);
  }

  revalidateCategorySurfaces();
  return { ok: true };
}
