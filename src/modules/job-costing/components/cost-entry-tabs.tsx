'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { CostEntryForm } from './cost-entry-form';
import { LaborEntryForm } from './labor-entry-form';
import { EquipmentEntryForm } from './equipment-entry-form';
import { VendorExpenseForm } from './vendor-expense-form';
import type { CostCodeOption, VendorOption } from './cost-entry-form';

type TabKey = 'general' | 'labor' | 'equipment' | 'vendor';

const TABS: { key: TabKey; label: string; description: string }[] = [
  {
    key: 'general',
    label: 'General',
    description: 'Catch-all for any cost type',
  },
  {
    key: 'labor',
    label: 'Labor',
    description: 'Hours × rate, with optional burden %',
  },
  {
    key: 'equipment',
    label: 'Equipment',
    description: 'Owned or rented, day/week/month rates',
  },
  {
    key: 'vendor',
    label: 'Vendor Invoice',
    description: 'Subtotal + VAT + freight + duty in one shot',
  },
];

export function CostEntryTabs({
  projectId,
  costCodes,
  vendors,
}: {
  projectId: string;
  costCodes: CostCodeOption[];
  vendors: VendorOption[];
}) {
  const [tab, setTab] = useState<TabKey>('general');
  const active = TABS.find((t) => t.key === tab)!;

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="Cost entry type"
        className="flex flex-wrap gap-1 border-b border-slate-200"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === tab}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              t.key === tab
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-900',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">{active.description}</p>

      {tab === 'general' && (
        <CostEntryForm
          projectId={projectId}
          costCodes={costCodes}
          vendors={vendors}
        />
      )}
      {tab === 'labor' && (
        <LaborEntryForm projectId={projectId} costCodes={costCodes} />
      )}
      {tab === 'equipment' && (
        <EquipmentEntryForm
          projectId={projectId}
          costCodes={costCodes}
          vendors={vendors}
        />
      )}
      {tab === 'vendor' && (
        <VendorExpenseForm
          projectId={projectId}
          costCodes={costCodes}
          vendors={vendors}
        />
      )}
    </div>
  );
}
