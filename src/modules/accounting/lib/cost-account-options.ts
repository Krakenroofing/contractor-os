// Accounts a purchase can post to (COGS, operating expense, and asset —
// e.g. inventory stock), shaped as {id, label} for plain selects. Server-safe
// (no 'use client'), so pages call it while rendering.

type AccountRow = {
  id: string;
  code: string | null;
  name: string;
  rollupGroup: string;
  parentId: string | null;
  isArchived: boolean;
  type?: string;
};

const GROUP_ORDER: Record<string, number> = { cogs: 0, opex: 1, asset: 2 };
const GROUP_LABEL: Record<string, string> = {
  cogs: 'COGS',
  opex: 'Expense',
  asset: 'Asset',
};

export function costAccountOptions(
  rows: AccountRow[],
): Array<{ id: string; label: string }> {
  const parents = new Set(rows.map((r) => r.parentId).filter((p): p is string => !!p));
  return rows
    .filter(
      (r) =>
        !r.isArchived &&
        r.rollupGroup in GROUP_ORDER &&
        !parents.has(r.id) &&
        r.type !== 'bank' &&
        r.type !== 'credit_card',
    )
    .sort(
      (a, b) =>
        GROUP_ORDER[a.rollupGroup] - GROUP_ORDER[b.rollupGroup] ||
        a.name.localeCompare(b.name),
    )
    .map((r) => ({
      id: r.id,
      label: `${GROUP_LABEL[r.rollupGroup]} · ${r.code ? `${r.code} ` : ''}${r.name}`,
    }));
}
