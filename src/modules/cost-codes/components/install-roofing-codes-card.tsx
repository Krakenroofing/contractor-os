'use client';

// Install card: bulk-installs the roofing cost-code seed. Mirrors the
// "Install contractor accounting categories" card pattern from Accounting
// Phase 1 — idempotent, safe to click multiple times, shows insert vs
// skip counts in the result message.

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  installRoofingCostCodesAction,
  type InstallRoofingCostCodesState,
} from '../actions';
import { ROOFING_COST_CODE_SEED } from '@/lib/seeds/roofing-cost-codes';

const initial: InstallRoofingCostCodesState = {};

export function InstallRoofingCodesCard() {
  const [state, formAction, pending] = useActionState(
    installRoofingCostCodesAction,
    initial,
  );
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">
          Install roofing cost codes
        </h3>
        <p className="text-xs text-slate-500 mt-1 max-w-2xl">
          Bulk-add {ROOFING_COST_CODE_SEED.length} roofing-industry cost
          codes covering TPO / Mod-Bit / EPDM membrane systems, tapered
          insulation, cover board, adhesives, sealants, terminations,
          fasteners, drains, roofing labor, equipment day-rates, and
          disposal. Safe to click any time — codes you already have are
          skipped automatically.
        </p>
      </div>

      <button
        type="button"
        onClick={() => setPreviewOpen((v) => !v)}
        className="text-xs text-blue-600 hover:underline"
      >
        {previewOpen
          ? '▾ Hide preview'
          : `▸ Preview the ${ROOFING_COST_CODE_SEED.length} codes that would be installed`}
      </button>

      {previewOpen && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 max-h-72 overflow-y-auto text-xs">
          <ul className="space-y-0.5">
            {ROOFING_COST_CODE_SEED.map((c) => (
              <li
                key={c.code}
                className="grid grid-cols-[140px_1fr_80px] gap-2 items-baseline"
              >
                <span className="font-mono text-slate-700">{c.code}</span>
                <span className="text-slate-900">{c.description}</span>
                <span className="text-slate-500 capitalize">{c.category}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {state.formError}
        </div>
      )}
      {state.result && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900">
          ✓ Installed <strong>{state.result.inserted}</strong> new cost
          code{state.result.inserted === 1 ? '' : 's'}.
          {state.result.skipped > 0 && (
            <>
              {' '}
              Skipped <strong>{state.result.skipped}</strong> already
              present (
              {state.result.skippedCodes.slice(0, 6).join(', ')}
              {state.result.skippedCodes.length > 6 ? ', …' : ''}).
            </>
          )}
        </div>
      )}

      <form action={formAction}>
        <Button type="submit" disabled={pending}>
          {pending
            ? 'Installing…'
            : `Install ${ROOFING_COST_CODE_SEED.length} roofing cost codes`}
        </Button>
      </form>
    </div>
  );
}
