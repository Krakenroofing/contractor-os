'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
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
import {
  deleteRuleAction,
  reorderRulesAction,
  toggleRuleEnabledAction,
} from '../actions';

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

export function RulesList({
  rules: incoming,
  canReorder,
}: {
  rules: RuleRow[];
  canReorder: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  // Local order so drag-and-drop renders instantly without waiting for a
  // round trip. Re-sync from server props after any router.refresh().
  const [order, setOrder] = useState<RuleRow[]>(incoming);
  useEffect(() => {
    setOrder(incoming);
  }, [incoming]);

  const dragId = useRef<string | null>(null);

  if (order.length === 0) {
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

  function reorder(droppedOnId: string) {
    const fromId = dragId.current;
    dragId.current = null;
    if (!fromId || fromId === droppedOnId) return;
    const fromIdx = order.findIndex((r) => r.id === fromId);
    const toIdx = order.findIndex((r) => r.id === droppedOnId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = order.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setOrder(next);
    startTransition(async () => {
      const res = await reorderRulesAction({
        orderedIds: next.map((r) => r.id),
      });
      if (!res.ok && res.error) alert(res.error);
      router.refresh();
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {canReorder && <TableHead className="w-6"></TableHead>}
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
        {order.map((r) => (
          <TableRow
            key={r.id}
            className={r.enabled ? '' : 'opacity-60'}
            draggable={canReorder}
            onDragStart={() => {
              dragId.current = r.id;
            }}
            onDragOver={(e) => {
              if (canReorder) e.preventDefault();
            }}
            onDrop={() => reorder(r.id)}
          >
            {canReorder && (
              <TableCell
                className="cursor-grab select-none text-center text-slate-400"
                title="Drag to reorder"
              >
                ⋮⋮
              </TableCell>
            )}
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
