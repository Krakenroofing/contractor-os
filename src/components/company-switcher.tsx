'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui/select';
import { setActiveCompanyAction } from '@/lib/active-company-actions';

export type CompanyOption = { id: string; name: string };

export function CompanySwitcher({
  companies,
  activeCompanyId,
}: {
  companies: CompanyOption[];
  activeCompanyId: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onChange = (companyId: string) => {
    startTransition(async () => {
      await setActiveCompanyAction(companyId);
      router.refresh();
    });
  };

  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-slate-500">Active company</p>
      <Select
        value={activeCompanyId}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        className="text-sm"
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      {pending && <p className="text-xs text-slate-400">Switching…</p>}
    </div>
  );
}
