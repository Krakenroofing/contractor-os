// Server-safe helpers for shaping accounting_accounts rows into the option
// shape that the AccountingAccountPicker client component consumes.
//
// Kept in a separate file from the picker (not 'use client') so server
// components can call it during render. React Server Components cannot
// invoke functions exported from a 'use client' module.

export type AccountingAccountOption = {
  id: string;
  name: string;
  rollupGroup:
    | 'income'
    | 'cogs'
    | 'opex'
    | 'asset'
    | 'liability'
    | 'equity'
    | 'vat_tax';
  /** True for section-header accounts (parent_id IS NULL). Picker renders
   *  these as disabled <option>s so the operator sees the hierarchy but
   *  can't post to a group total. */
  isHeader?: boolean;
};

/**
 * Adapt raw `listAccountingAccounts(companyId)` rows into the option shape
 * the picker expects. Sorts alphabetically within each rollup group;
 * headers float to the top of their group. Group ordering itself is
 * handled by the picker component.
 */
export function toAccountingAccountOptions(
  rows: Array<{
    id: string;
    name: string;
    rollupGroup: AccountingAccountOption['rollupGroup'];
    parentId: string | null;
    isArchived?: boolean;
  }>,
): AccountingAccountOption[] {
  const active = rows.filter((r) => !r.isArchived);
  // A "header" is a non-postable GROUP total. An account is only that if it's
  // top-level (no parent) AND actually has children rolling up into it. A
  // parentless LEAF (e.g. "VAT Input", a standalone system account) is a real
  // postable account — treating it as a header made it unselectable and made
  // lines already posted to it render blank in the picker.
  const hasChildren = new Set(
    active.map((r) => r.parentId).filter((p): p is string => p !== null),
  );
  return active
    .map((r) => ({
      id: r.id,
      name: r.name,
      rollupGroup: r.rollupGroup,
      isHeader: r.parentId === null && hasChildren.has(r.id),
    }))
    .sort((a, b) => {
      if (a.rollupGroup !== b.rollupGroup) return 0;
      if (a.isHeader && !b.isHeader) return -1;
      if (!a.isHeader && b.isHeader) return 1;
      return a.name.localeCompare(b.name);
    });
}
