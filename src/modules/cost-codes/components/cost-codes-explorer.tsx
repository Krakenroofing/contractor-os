'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import type { CostCode } from '@/db/schema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ListToolbar } from '@/components/ui/list-toolbar';
import {
  COST_CODE_DIVISIONS,
  DIVISION_NAME_BY_CODE,
  GLOBAL_COST_CODE_LIBRARY_ID,
} from '@/lib/data/cost-code-defaults';
import { CATEGORY_LABEL, CATEGORY_TONE, type CostCodeCategory } from '../schema';
import { toggleCostCodeActiveAction } from '../actions';

const FALLBACK_TONE = 'slate' as const;

function categoryTone(c: string) {
  return (CATEGORY_TONE as Record<string, (typeof CATEGORY_TONE)[CostCodeCategory]>)[c] ?? FALLBACK_TONE;
}

function categoryLabel(c: string) {
  return (CATEGORY_LABEL as Record<string, string>)[c] ?? c;
}

const NO_DIVISION_KEY = '__none__';

export function CostCodesExplorer({
  codes,
  canEdit,
}: {
  codes: CostCode[];
  canEdit: boolean;
}) {
  const [search, setSearch] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return codes.filter((c) => {
      if (q) {
        const hay = `${c.code} ${c.description} ${c.division ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (divisionFilter) {
        if (divisionFilter === NO_DIVISION_KEY) {
          if (c.division) return false;
        } else if (c.division !== divisionFilter) {
          return false;
        }
      }
      if (categoryFilter && c.category !== categoryFilter) return false;
      if (statusFilter === 'active' && !c.isActive) return false;
      if (statusFilter === 'inactive' && c.isActive) return false;
      if (sourceFilter === 'global' && c.libraryId !== GLOBAL_COST_CODE_LIBRARY_ID) return false;
      if (sourceFilter === 'company' && c.libraryId === GLOBAL_COST_CODE_LIBRARY_ID) return false;
      return true;
    });
  }, [codes, search, divisionFilter, categoryFilter, statusFilter, sourceFilter]);

  const grouped = useMemo(() => {
    const groups = new Map<string, CostCode[]>();
    for (const c of filtered) {
      const key = c.division ?? NO_DIVISION_KEY;
      const arr = groups.get(key);
      if (arr) arr.push(c);
      else groups.set(key, [c]);
    }
    // Order by COST_CODE_DIVISIONS sequence; everything else (custom divisions
    // + the "no division" bucket) follows alphabetically with NO_DIVISION_KEY
    // last.
    const ordered: { key: string; label: string; codes: CostCode[] }[] = [];
    const seen = new Set<string>();
    for (const d of COST_CODE_DIVISIONS) {
      const list = groups.get(d.code);
      if (list) {
        ordered.push({ key: d.code, label: `${d.code} — ${d.name}`, codes: list });
        seen.add(d.code);
      }
    }
    const remaining = [...groups.entries()]
      .filter(([k]) => !seen.has(k) && k !== NO_DIVISION_KEY)
      .sort(([a], [b]) => a.localeCompare(b));
    for (const [k, list] of remaining) {
      ordered.push({
        key: k,
        label: DIVISION_NAME_BY_CODE[k] ? `${k} — ${DIVISION_NAME_BY_CODE[k]}` : k,
        codes: list,
      });
    }
    const noDiv = groups.get(NO_DIVISION_KEY);
    if (noDiv) ordered.push({ key: NO_DIVISION_KEY, label: 'No division', codes: noDiv });
    return ordered;
  }, [filtered]);

  function clear() {
    setSearch('');
    setDivisionFilter('');
    setCategoryFilter('');
    setStatusFilter('');
    setSourceFilter('');
  }

  const totalActive = codes.filter((c) => c.isActive).length;
  const totalCustom = codes.filter((c) => c.libraryId !== GLOBAL_COST_CODE_LIBRARY_ID).length;
  const totalGlobal = codes.length - totalCustom;

  return (
    <div className="space-y-4">
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search code, name, or division…"
        filters={[
          {
            label: 'Division',
            value: divisionFilter,
            onChange: setDivisionFilter,
            options: [
              ...COST_CODE_DIVISIONS.map((d) => ({
                value: d.code,
                label: `${d.code} — ${d.name}`,
              })),
              { value: NO_DIVISION_KEY, label: 'No division' },
            ],
          },
          {
            label: 'Category',
            value: categoryFilter,
            onChange: setCategoryFilter,
            options: (Object.keys(CATEGORY_LABEL) as CostCodeCategory[]).map((k) => ({
              value: k,
              label: CATEGORY_LABEL[k],
            })),
          },
          {
            label: 'Status',
            value: statusFilter,
            onChange: setStatusFilter,
            options: [
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ],
          },
          {
            label: 'Source',
            value: sourceFilter,
            onChange: setSourceFilter,
            options: [
              { value: 'global', label: 'Global library' },
              { value: 'company', label: 'Custom (company)' },
            ],
          },
        ]}
        onClear={clear}
      />

      <div className="text-xs text-slate-500">
        Showing {filtered.length} of {codes.length} ({totalActive} active,{' '}
        {totalGlobal} global, {totalCustom} custom)
      </div>

      {grouped.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">
          No cost codes match the current filters.
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((g) => (
            <DivisionSection key={g.key} label={g.label} codes={g.codes} canEdit={canEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

function DivisionSection({
  label,
  codes,
  canEdit,
}: {
  label: string;
  codes: CostCode[];
  canEdit: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">{label}</h2>
        <span className="text-xs text-slate-500">
          {codes.length} {codes.length === 1 ? 'code' : 'codes'}
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[230px]">Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="w-[120px]">Category</TableHead>
            <TableHead className="w-[110px] text-right">Default cost</TableHead>
            <TableHead className="w-[120px]">Source</TableHead>
            <TableHead className="w-[120px]">Status</TableHead>
            <TableHead className="text-right w-[180px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {codes.map((c) => (
            <CostCodeRow key={c.id} code={c} canEdit={canEdit} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CostCodeRow({ code, canEdit }: { code: CostCode; canEdit: boolean }) {
  const [pending, startTransition] = useTransition();
  const isGlobal = code.libraryId === GLOBAL_COST_CODE_LIBRARY_ID;

  function onToggle() {
    if (!canEdit || isGlobal) return;
    startTransition(async () => {
      await toggleCostCodeActiveAction(code.id, !code.isActive);
    });
  }

  return (
    <TableRow className={code.isActive ? '' : 'opacity-60'}>
      <TableCell className="font-mono text-xs text-slate-700">{code.code}</TableCell>
      <TableCell className="font-medium text-slate-900">{code.description}</TableCell>
      <TableCell>
        <Badge tone={categoryTone(code.category)}>{categoryLabel(code.category)}</Badge>
      </TableCell>
      <TableCell className="text-right tabular-nums text-slate-700">
        {code.defaultCost && Number(code.defaultCost) > 0 ? (
          new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
          }).format(Number(code.defaultCost))
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </TableCell>
      <TableCell>
        {isGlobal ? (
          <Badge tone="blue">Global</Badge>
        ) : (
          <Badge tone="slate">Custom</Badge>
        )}
      </TableCell>
      <TableCell>
        {code.isActive ? (
          <Badge tone="green">Active</Badge>
        ) : (
          <Badge tone="amber">Inactive</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          {canEdit && !isGlobal && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onToggle}
              disabled={pending}
            >
              {pending ? '…' : code.isActive ? 'Deactivate' : 'Activate'}
            </Button>
          )}
          <Link href={`/cost-codes/${code.id}`}>
            <Button size="sm" variant="outline">
              View
            </Button>
          </Link>
        </div>
      </TableCell>
    </TableRow>
  );
}
