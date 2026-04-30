'use client';

import { Input } from './input';
import { Select } from './select';
import { Button } from './button';

export type FilterDef = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
};

export function ListToolbar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  filters,
  onClear,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  filters?: FilterDef[];
  onClear?: () => void;
}) {
  const hasFilter =
    search.length > 0 || (filters?.some((f) => f.value !== '') ?? false);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[220px]">
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
        />
      </div>
      {filters?.map((f, i) => (
        <div key={i} className="min-w-[170px]">
          <Select value={f.value} onChange={(e) => f.onChange(e.target.value)}>
            <option value="">{f.label}: All</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      ))}
      {hasFilter && onClear && (
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      )}
    </div>
  );
}
