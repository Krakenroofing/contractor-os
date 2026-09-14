'use client';

// Vendor filter for the AP Aging report — same router.push pattern as the
// default-terms picker so date / terms params are preserved.

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

export function ApVendorPicker({
  selected,
  vendors,
}: {
  selected: string;
  vendors: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function pick(value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set('vendor', value);
    else params.delete('vendor');
    const qs = params.toString();
    startTransition(() => {
      router.push(
        `${pathname}${qs ? `?${qs}` : ''}` as unknown as Parameters<
          typeof router.push
        >[0],
      );
    });
  }

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm flex flex-wrap items-center gap-3 print:hidden">
      <label className="text-slate-700 font-medium">Vendor:</label>
      <select
        value={selected}
        disabled={pending}
        onChange={(e) => pick(e.target.value)}
        className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
      >
        <option value="">All vendors</option>
        {vendors.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
      {pending && <span className="text-xs text-slate-500">Updating…</span>}
    </div>
  );
}
