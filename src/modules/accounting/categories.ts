// Shared (server + client) constants for the operator-managed accounting
// category groups. Kept out of actions.ts because a 'use server' module may
// only export async functions, and out of the client component so the server
// action can share the same source of truth.

export const CATEGORY_GROUPS = ['income', 'cogs', 'opex'] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

export const CATEGORY_GROUP_LABEL: Record<CategoryGroup, string> = {
  income: 'Income',
  cogs: 'Cost of Goods Sold',
  opex: 'Operating Expense',
};
