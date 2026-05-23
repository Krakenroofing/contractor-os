'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type OptionItem = {
  value: string;
  label: React.ReactNode;
  searchText: string;
  disabled?: boolean;
};

function childrenToText(node: React.ReactNode): string {
  if (node == null || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(childrenToText).join('');
  if (React.isValidElement(node)) {
    return childrenToText(
      (node.props as { children?: React.ReactNode }).children,
    );
  }
  return '';
}

function extractOptions(children: React.ReactNode): OptionItem[] {
  const items: OptionItem[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type !== 'option') return;
    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement> & {
      children?: React.ReactNode;
    };
    const value = String(props.value ?? '');
    const label = props.children ?? '';
    items.push({
      value,
      label,
      searchText: childrenToText(label).toLowerCase(),
      disabled: props.disabled,
    });
  });
  return items;
}

type SyntheticChangeEvent = {
  target: { name?: string; value: string };
};

export type SelectProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  'onChange'
> & {
  onChange?: (e: SyntheticChangeEvent) => void;
  placeholder?: string;
};

export const Select = React.forwardRef<HTMLInputElement, SelectProps>(
  function Select(
    {
      className,
      children,
      name,
      id,
      value: controlledValue,
      defaultValue,
      required,
      disabled,
      onChange,
      placeholder,
    },
    ref,
  ) {
    const options = React.useMemo(() => extractOptions(children), [children]);

    const isControlled = controlledValue !== undefined;
    const initialValue =
      defaultValue !== undefined
        ? String(defaultValue)
        : options[0]?.value ?? '';
    const [uncontrolledValue, setUncontrolledValue] =
      React.useState<string>(initialValue);
    const value = isControlled ? String(controlledValue) : uncontrolledValue;

    const selected = options.find((o) => o.value === value);

    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [highlight, setHighlight] = React.useState(0);
    const wrapperRef = React.useRef<HTMLDivElement>(null);
    const filterInputRef = React.useRef<HTMLInputElement>(null);
    const listRef = React.useRef<HTMLUListElement>(null);
    const buttonRef = React.useRef<HTMLButtonElement>(null);

    const filtered = React.useMemo(() => {
      const q = query.trim().toLowerCase();
      if (!q) return options;
      return options.filter((o) => o.searchText.includes(q));
    }, [options, query]);

    React.useEffect(() => {
      if (!open) return;
      function onDocDown(e: MouseEvent) {
        if (!wrapperRef.current) return;
        if (!wrapperRef.current.contains(e.target as Node)) {
          setOpen(false);
        }
      }
      document.addEventListener('mousedown', onDocDown);
      return () => document.removeEventListener('mousedown', onDocDown);
    }, [open]);

    React.useEffect(() => {
      if (!open || !listRef.current) return;
      const el = listRef.current.children[highlight] as
        | HTMLElement
        | undefined;
      if (el) el.scrollIntoView({ block: 'nearest' });
    }, [highlight, open]);

    const openPanel = React.useCallback(
      (initialQuery = '') => {
        if (disabled) return;
        setQuery(initialQuery);
        setOpen(true);
        const startList = initialQuery
          ? options.filter((o) =>
              o.searchText.includes(initialQuery.toLowerCase()),
            )
          : options;
        const idx = startList.findIndex((o) => o.value === value);
        setHighlight(idx >= 0 ? idx : 0);
        setTimeout(() => filterInputRef.current?.focus(), 0);
      },
      [disabled, options, value],
    );

    function selectValue(next: string) {
      if (!isControlled) setUncontrolledValue(next);
      onChange?.({ target: { name, value: next } });
      setOpen(false);
      setQuery('');
      setTimeout(() => buttonRef.current?.focus(), 0);
    }

    function onListKeyDown(e: React.KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => Math.min(filtered.length - 1, h + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const pick = filtered[highlight];
        if (pick && !pick.disabled) selectValue(pick.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        setTimeout(() => buttonRef.current?.focus(), 0);
      }
    }

    function onButtonKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
      if (disabled) return;
      if (
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp' ||
        e.key === 'Enter' ||
        e.key === ' '
      ) {
        e.preventDefault();
        openPanel();
        return;
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        openPanel(e.key);
      }
    }

    const buttonLabel: React.ReactNode = selected
      ? selected.label
      : placeholder ?? options[0]?.label ?? ' ';

    return (
      <div ref={wrapperRef} className="relative">
        <button
          ref={buttonRef}
          type="button"
          id={id}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openPanel())}
          onKeyDown={onButtonKeyDown}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50',
            className,
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span
            className={cn(
              'truncate',
              !selected || !selected.value ? 'text-slate-500' : '',
            )}
          >
            {buttonLabel}
          </span>
          <svg
            className="ml-2 h-4 w-4 shrink-0 text-slate-400"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" />
          </svg>
        </button>

        <input
          ref={ref}
          type="hidden"
          name={name}
          value={value}
          required={required}
        />

        {open && (
          <div className="absolute z-50 mt-1 w-full rounded-md border border-slate-300 bg-white shadow-lg">
            <div className="border-b border-slate-200 p-2">
              <input
                ref={filterInputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={onListKeyDown}
                placeholder="Type to filter…"
                className="w-full rounded border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
            <ul
              ref={listRef}
              role="listbox"
              className="max-h-60 overflow-auto py-1 text-sm"
            >
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-slate-500">No matches</li>
              )}
              {filtered.map((opt, i) => {
                const isSel = opt.value === value;
                const isHl = i === highlight;
                return (
                  <li
                    key={`${opt.value}-${i}`}
                    role="option"
                    aria-selected={isSel}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (!opt.disabled) selectValue(opt.value);
                    }}
                    onMouseEnter={() => setHighlight(i)}
                    className={cn(
                      'cursor-pointer px-3 py-1.5',
                      opt.disabled && 'cursor-not-allowed opacity-50',
                      isHl && 'bg-slate-100',
                      isSel && 'font-medium',
                    )}
                  >
                    {opt.label}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    );
  },
);
