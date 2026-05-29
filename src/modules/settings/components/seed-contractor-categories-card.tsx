'use client';

// Phase 1 operational accounting: settings-page button that installs the
// contractor-focused category structure (Income/COGS/OpEx section headers
// + ~40 operational lines) for the active company. Idempotent — re-run to
// pick up any new categories added to the seed file later.

import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  seedContractorCategoriesAction,
  type SeedContractorCategoriesState,
} from '../actions';

const initial: SeedContractorCategoriesState = {};

export function SeedContractorCategoriesCard() {
  const [state, formAction, pending] = useActionState(
    seedContractorCategoriesAction,
    initial,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contractor accounting categories</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-600">
        <p>
          Install the standard contractor category structure for this company —
          section headers (Income, Cost of Goods Sold, Operating Expense) plus
          operational lines underneath: Roofing Materials, Direct Labor, Expat
          Housing, Per Diem, Crane Rental, Subcontractors, and so on. Categories
          show up in the grouped picker on receipts, banking rules, and invoice
          line items.
        </p>
        <p className="text-xs text-slate-500">
          Safe to click any time — re-running skips categories you already
          have and only inserts new ones.
        </p>

        {state.formError && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {state.formError}
          </div>
        )}
        {state.result && (
          <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-900">
            ✓ Installed{' '}
            <strong>
              {state.result.insertedHeaders + state.result.insertedChildren}
            </strong>{' '}
            new categories
            {state.result.insertedHeaders > 0 && (
              <> ({state.result.insertedHeaders} section headers,{' '}
                {state.result.insertedChildren} operational lines)</>
            )}
            . Skipped {state.result.skipped} already present.
          </div>
        )}

        <form action={formAction}>
          <Button type="submit" disabled={pending}>
            {pending ? 'Installing…' : 'Install contractor accounting categories'}
          </Button>
        </form>

        <p className="text-xs text-slate-500">
          Need to add your own category, or rename/archive one?{' '}
          <Link
            href={'/settings/accounting-categories' as never}
            className="text-slate-900 underline hover:no-underline"
          >
            Manage accounting categories →
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
