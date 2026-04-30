'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setCalcDebugAction } from '@/lib/calc-debug-actions';

export function CalcDebugToggle({ enabled }: { enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onChange = (next: boolean) => {
    startTransition(async () => {
      await setCalcDebugAction(next);
      router.refresh();
    });
  };

  return (
    <label className="flex items-start gap-3 text-sm cursor-pointer select-none">
      <input
        type="checkbox"
        checked={enabled}
        disabled={pending}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4"
      />
      <span>
        <span className="font-medium text-slate-900">
          Show calculation breakdowns
        </span>
        <span className="block text-xs text-slate-500 mt-0.5">
          Demo-only. When enabled, document detail pages reveal the underlying
          formula and intermediate values for verification (CIF, duty, VAT base,
          etc.).
        </span>
      </span>
    </label>
  );
}
