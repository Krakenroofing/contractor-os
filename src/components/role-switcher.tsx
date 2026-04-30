'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui/select';
import { setActiveRoleAction } from '@/lib/active-role-actions';
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from '@/lib/permissions';

export function RoleSwitcher({ activeRole }: { activeRole: Role }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onChange = (role: string) => {
    startTransition(async () => {
      await setActiveRoleAction(role);
      router.refresh();
    });
  };

  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-slate-500">Active role</p>
      <Select
        value={activeRole}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        className="text-sm"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </Select>
      <p className="text-xs text-slate-400 leading-snug">
        {ROLE_DESCRIPTIONS[activeRole]}
      </p>
    </div>
  );
}
