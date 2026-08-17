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
  /** True when the account's parent is another CATEGORY (not a section
   *  header) — a QB-style subaccount. Picker indents these under their
   *  parent. */
  isSub?: boolean;
};

/**
 * Adapt raw `listAccountingAccounts(companyId)` rows into the option shape
 * the picker expects. Within each rollup group: header first, then
 * top-level categories alphabetically, each immediately followed by its
 * subaccounts (alphabetical). Group ordering itself is handled by the
 * picker component.
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
  const parentIdOf = new Map(rows.map((r) => [r.id, r.parentId]));
  const isSub = (r: { parentId: string | null }) =>
    r.parentId !== null && (parentIdOf.get(r.parentId) ?? null) !== null;

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);
  const toOption = (r: (typeof active)[number]): AccountingAccountOption => ({
    id: r.id,
    name: r.name,
    rollupGroup: r.rollupGroup,
    isHeader: r.parentId === null && hasChildren.has(r.id),
    isSub: isSub(r),
  });

  // Tree-order each rollup group: headers, then top-level rows A→Z with each
  // one's subaccounts tucked directly beneath it. Subaccounts whose parent is
  // archived (so absent here) fall through at the end of the group.
  const groups = new Map<string, typeof active>();
  for (const r of active) {
    const bucket = groups.get(r.rollupGroup) ?? [];
    bucket.push(r);
    groups.set(r.rollupGroup, bucket);
  }
  const out: AccountingAccountOption[] = [];
  for (const bucket of groups.values()) {
    const headers = bucket
      .filter((r) => r.parentId === null && hasChildren.has(r.id))
      .sort(byName);
    const tops = bucket
      .filter((r) => !isSub(r) && !(r.parentId === null && hasChildren.has(r.id)))
      .sort(byName);
    const placed = new Set<string>();
    for (const h of headers) {
      out.push(toOption(h));
      placed.add(h.id);
    }
    for (const t of tops) {
      out.push(toOption(t));
      placed.add(t.id);
      const subs = bucket.filter((r) => r.parentId === t.id && isSub(r)).sort(byName);
      for (const s of subs) {
        out.push(toOption(s));
        placed.add(s.id);
      }
    }
    for (const r of bucket.filter((r) => !placed.has(r.id)).sort(byName)) {
      out.push(toOption(r));
    }
  }
  return out;
}
