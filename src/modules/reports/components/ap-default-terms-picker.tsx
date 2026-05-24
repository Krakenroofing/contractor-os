'use client';

// Inline filter for the AP Aging report. Submits via router.push so existing
// date / project query params are preserved — only updates defaultTermsDays.

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { AP_DEFAULT_TERMS_DAYS } from '@/modules/reports/lib/filters';

export function ApDefaultTermsPicker({ selected }: { selected: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function pick(value: number) {
    const params = new URLSearchParams(searchParams);
    params.set('defaultTermsDays', String(value));
    const qs = params.toString();
    startTransition(() => {
      router.push(
        `${pathname}${qs ? `?${qs}` : ''}` as unknown as Parameters<typeof router.push>[0],
      );
    });
  }

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm flex flex-wrap items-center gap-3 print:hidden">
      <label className="text-slate-700 font-medium">
        Default terms (when vendor has none on file):
      </label>
      <select
        value={String(selected)}
        disabled={pending}
        onChange={(e) => pick(Number(e.target.value))}
        className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
      >
        {AP_DEFAULT_TERMS_DAYS.map((d) => (
          <option key={d} value={d}>
            {d === 0 ? 'Due on receipt (Net 0)' : `Net ${d}`}
          </option>
        ))}
      </select>
      <p className="text-xs text-slate-500">
        Vendors with parseable terms (&quot;Net 30&quot;, &quot;Net 15&quot;)
        use their own value. Only blank or unparseable vendors fall back to
        this.
      </p>
      {pending && <span className="text-xs text-slate-500">Updating…</span>}
    </div>
  );
}
