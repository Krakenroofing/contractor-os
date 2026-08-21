'use client';

// Phase 1 operational accounting: shared dropdown for picking an
// accounting_account. Renders <optgroup>s by rollup_group (Income, COGS,
// Operating Expense, Asset, Liability, Equity, VAT/Tax) so users see the
// financial classification while choosing the operational category.
//
// Section-header accounts (parent_id IS NULL — "Income", "Cost of Goods
// Sold", etc.) render as disabled options so the operator can see the
// hierarchy but can't accidentally post to a group header instead of a
// leaf line.
//
// Used by:
//   - Receipt line forms      (src/modules/receipts/components/...)
//   - Banking rule actions    (src/modules/banking/components/rule-form.tsx)
//   - Bank transaction rows   (src/modules/banking/components/transaction-row-form.tsx)
//
// Same option shape works everywhere: { id, name, rollupGroup, isHeader }.

import { Select } from '@/components/ui/select';
import type { AccountingAccountOption } from '@/modules/accounting/lib/account-options';

// Re-export type for back-compat with callsites that import it from the
// picker file. The adapter helper `toAccountingAccountOptions` MUST be
// imported from the lib path directly (it's server-safe and can't be
// re-exported through this 'use client' module).
export type { AccountingAccountOption };

// Display order matches a standard P&L / balance-sheet flow. VAT/Tax goes
// last because it's a flow-through pool, not an operational bucket.
const GROUP_ORDER: AccountingAccountOption['rollupGroup'][] = [
  'income',
  'cogs',
  'opex',
  'asset',
  'liability',
  'equity',
  'vat_tax',
];

const GROUP_LABEL: Record<AccountingAccountOption['rollupGroup'], string> = {
  income: 'Income',
  cogs: 'Cost of Goods Sold',
  opex: 'Operating Expense',
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  vat_tax: 'VAT / Tax',
};

export function AccountingAccountPicker({
  name,
  value,
  onChange,
  accounts,
  placeholder = '— Select category —',
  emptyPlaceholder = 'No categories — install via Settings',
  disabled,
  required,
  id,
}: {
  /** Form field name for native form serialization. */
  name?: string;
  value: string;
  onChange: (id: string) => void;
  accounts: AccountingAccountOption[];
  placeholder?: string;
  emptyPlaceholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
}) {
  // Bank / credit-card ledger accounts render as their own group at the
  // end — picking one records a transfer into that account.
  const transferAccounts = accounts.filter((a) => a.isAccountTransfer);
  const categoryAccounts = accounts.filter((a) => !a.isAccountTransfer);

  // Group accounts by rollup_group, preserving incoming sort within each
  // group (caller sorts alphabetically; we only group).
  const grouped = new Map<AccountingAccountOption['rollupGroup'], AccountingAccountOption[]>();
  for (const a of categoryAccounts) {
    const list = grouped.get(a.rollupGroup) ?? [];
    list.push(a);
    grouped.set(a.rollupGroup, list);
  }

  const isEmpty = accounts.length === 0;

  return (
    <Select
      id={id}
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      required={required}
    >
      <option value="">{isEmpty ? emptyPlaceholder : placeholder}</option>
      {GROUP_ORDER.flatMap((group) => {
        const items = grouped.get(group);
        if (!items || items.length === 0) return [];
        // Skip the optgroup wrapper if every item in the group is a header
        // (i.e. nothing pickable) — avoids an empty interactive section.
        const hasPickable = items.some((a) => !a.isHeader);
        if (!hasPickable) return [];
        return (
          <optgroup key={group} label={GROUP_LABEL[group]}>
            {items.map((a) =>
              a.isHeader ? (
                // Disabled & non-selectable. Indented children below it
                // visually attribute to this section.
                <option key={a.id} value={a.id} disabled>
                  ── {a.name} ──
                </option>
              ) : (
                // Sub-accounts indent with NBSPs — plain spaces collapse
                // inside <option> text.
                <option key={a.id} value={a.id}>
                  {a.isSub ? `   ↳ ${a.name}` : a.name}
                </option>
              ),
            )}
          </optgroup>
        );
      })}
      {transferAccounts.length > 0 && (
        <optgroup label="Bank & card accounts — transfer">
          {transferAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              ⇄ {a.name}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}

// toAccountingAccountOptions moved to ../lib/account-options.ts (server-safe).
