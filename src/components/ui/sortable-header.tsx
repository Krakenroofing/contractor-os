'use client';

import { cn } from '@/lib/utils';

export type SortState = { key: string; dir: 'asc' | 'desc' } | null;

export function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
  className,
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  align?: 'left' | 'right';
  className?: string;
}) {
  const isActive = sort?.key === sortKey;
  const indicator = isActive ? (sort?.dir === 'asc' ? '↑' : '↓') : '';
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        'inline-flex items-center gap-1 hover:text-slate-900 transition-colors',
        align === 'right' && 'justify-end w-full',
        isActive && 'text-slate-900',
        className,
      )}
    >
      <span>{label}</span>
      <span className="text-xs w-3 text-slate-400">{indicator}</span>
    </button>
  );
}

export function toggleSort(prev: SortState, key: string): SortState {
  if (prev?.key === key) {
    return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key, dir: 'asc' };
}

export function compareValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}
