// Field app top header. Tiny — just the brand label + active company.
// No nav (that lives in the bottom-nav for thumb reach), no role
// switcher (field users don't get one), no clutter.

import { ROLE_LABELS, type Role } from '@/lib/permissions';

export function FieldHeader({
  companyName,
  role,
}: {
  companyName: string;
  role: Role;
}) {
  return (
    <header className="shrink-0 border-b border-slate-200 bg-white">
      <div className="px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            KrakenOps Pro
          </p>
          <p className="text-sm font-semibold text-slate-900 leading-tight">
            {companyName}
          </p>
        </div>
        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
          {ROLE_LABELS[role]}
        </span>
      </div>
    </header>
  );
}
