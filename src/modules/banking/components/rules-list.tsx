'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { deleteRuleAction, toggleRuleEnabledAction } from '../actions';

export type RuleRow = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  scopeLabel: string;
  conditionSummary: string;
  actionSummary: string;
  matchCount: number;
};

export function RulesList({ rules }: { rules: RuleRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (rules.length === 0) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-sm text-slate-600">
          No rules yet. Create one to start auto-suggesting categorization for
          recurring transactions.
        </p>
        <Link href={{ pathname: '/banking/rules/new' }}>
          <Button>Create your first rule</Button>
        </Link>
      </div>
    );
  }

  function onToggle(id: string, enabled: boolean) {
    setBusyId(id);
    startTransition(async () => {
      await toggleRuleEnabledAction({ id, enabled });
      setBusyId(null);
      router.refresh();
    });
  }

  function onDelete(id: string, name: string) {
    if (!confirm(`Delete rule "${name}"? This is reversible via the database.`))
      return;
    setBusyId(id);
    startTransition(async () => {
      await deleteRuleAction({ id });
      setBusyId(null);
      router.refresh();
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16 text-right">Priority</TableHead>
          <TableHead>Rule</TableHead>
          <TableHead>Scope</TableHead>
          <TableHead>When</TableHead>
          <TableHead>Auto-fills</TableHead>
          <TableHead className="text-right">Hits</TableHead>
          <TableHead>Status</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rules.map((r) => (
          <TableRow key={r.id} className={r.enabled ? '' : 'opacity-60'}>
            <TableCell className="text-right tabular-nums font-mono text-xs">
              {r.priority}
            </TableCell>
            <TableCell>
              <Link
                href={{ pathname: `/banking/rules/${r.id}/edit` }}
                className="font-medium hover:underline"
              >
                {r.name}
              </Link>
            </TableCell>
            <TableCell className="text-xs text-slate-600">
              {r.scopeLabel}
            </TableCell>
            <TableCell className="text-xs text-slate-700">
              {r.conditionSummary}
            </TableCell>
            <TableCell className="text-xs text-slate-700">
              {r.actionSummary}
            </TableCell>
            <TableCell className="text-right tabular-nums text-xs">
              {r.matchCount}
            </TableCell>
            <TableCell>
              <label className="inline-flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  disabled={pending && busyId === r.id}
                  onChange={(e) => onToggle(r.id, e.target.checked)}
                  className="h-4 w-4"
                />
                {r.enabled ? 'Enabled' : 'Disabled'}
              </label>
            </TableCell>
            <TableCell className="text-right">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending && busyId === r.id}
                onClick={() => onDelete(r.id, r.name)}
              >
                Delete
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
