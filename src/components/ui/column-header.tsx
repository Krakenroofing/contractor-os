'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { SortState } from './sortable-header';

export type FilterOption = { value: string; label: string };

export function ColumnHeader({
  label,
  sortKey,
  sort,
  onSortChange,
  filterValues,
  onFilterChange,
  filterOptions,
  align = 'left',
  className,
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSortChange: (next: SortState) => void;
  filterValues?: Set<string>;
  onFilterChange?: (next: Set<string>) => void;
  filterOptions?: FilterOption[];
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isActive = sort?.key === sortKey;
  const indicator = isActive ? (sort?.dir === 'asc' ? '↑' : '↓') : '';
  // Empty filter set = "show all" (no filter). Narrowed only when a
  // strict subset is checked.
  const filterIsNarrowed =
    filterOptions !== undefined &&
    filterValues !== undefined &&
    filterValues.size > 0 &&
    filterValues.size < filterOptions.length;

  const toggleValue = (v: string) => {
    if (!filterValues || !onFilterChange) return;
    const next = new Set(filterValues);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onFilterChange(next);
  };

  const selectAll = () => {
    if (!filterOptions || !onFilterChange) return;
    onFilterChange(new Set(filterOptions.map((o) => o.value)));
  };
  const clearAll = () => {
    onFilterChange?.(new Set());
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative inline-block',
        align === 'right' && 'w-full',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-slate-900 transition-colors',
          align === 'right' && 'justify-end w-full',
          (isActive || filterIsNarrowed) && 'text-slate-900',
        )}
      >
        <span>{label}</span>
        <span className="text-xs w-3 text-slate-400">{indicator}</span>
        <span
          className={cn(
            'text-[10px]',
            filterIsNarrowed ? 'text-blue-600' : 'text-slate-400',
          )}
        >
          ▾
        </span>
      </button>
      {open && (
        <div
          className={cn(
            'absolute z-20 mt-1 w-56 rounded-md border border-slate-200 bg-white p-1 text-sm shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <MenuItem
            onClick={() => {
              onSortChange({ key: sortKey, dir: 'asc' });
              setOpen(false);
            }}
            active={isActive && sort?.dir === 'asc'}
          >
            ↑ Sort ascending
          </MenuItem>
          <MenuItem
            onClick={() => {
              onSortChange({ key: sortKey, dir: 'desc' });
              setOpen(false);
            }}
            active={isActive && sort?.dir === 'desc'}
          >
            ↓ Sort descending
          </MenuItem>
          {isActive && (
            <MenuItem
              onClick={() => {
                onSortChange(null);
                setOpen(false);
              }}
            >
              Clear sort
            </MenuItem>
          )}

          {filterOptions && filterValues && filterOptions.length > 0 && (
            <>
              <div className="my-1 border-t border-slate-100" />
              <div className="flex items-center justify-between px-2 pt-1">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Filter
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs text-blue-600 hover:underline"
                    onClick={selectAll}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    className="text-xs text-slate-500 hover:underline"
                    onClick={clearAll}
                  >
                    None
                  </button>
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto py-1">
                {filterOptions.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={filterValues.has(opt.value)}
                      onChange={() => toggleValue(opt.value)}
                    />
                    <span className="truncate">{opt.label}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  active,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50',
        active && 'bg-slate-100 font-medium text-slate-900',
      )}
    >
      {children}
    </button>
  );
}
