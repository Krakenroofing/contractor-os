'use client';

// Managed product category picker: Group > Category (ABC Supply's
// structure). A value that isn't on the list (older free text) still shows,
// flagged, so an edit doesn't silently drop it.

export type CategoryOption = { group: string; name: string };

export function CategorySelect({
  name,
  value,
  defaultValue,
  onChange,
  options,
  className,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  options: CategoryOption[];
  className?: string;
}) {
  const current = value ?? defaultValue ?? '';
  const groups: Array<{ group: string; names: string[] }> = [];
  for (const o of options) {
    const g = groups.find((x) => x.group === o.group);
    if (g) g.names.push(o.name);
    else groups.push({ group: o.group, names: [o.name] });
  }
  const offList =
    current !== '' &&
    !options.some((o) => o.name.toLowerCase() === current.toLowerCase());
  return (
    <select
      name={name}
      {...(value !== undefined ? { value } : { defaultValue })}
      onChange={(e) => onChange?.(e.target.value)}
      className={
        className ??
        'flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
      }
    >
      <option value="">— No category —</option>
      {offList && <option value={current}>{current} (not on the list)</option>}
      {groups.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
