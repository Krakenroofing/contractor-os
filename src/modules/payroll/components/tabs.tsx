import Link from 'next/link';
import { cn } from '@/lib/utils';

export type TabKey = 'timesheet' | 'by-job';

export function PayrollTabs({
  active,
  weekStart,
}: {
  active: TabKey;
  weekStart: string;
}) {
  return (
    <div className="border-b border-slate-200">
      <nav className="flex gap-1 -mb-px">
        <Tab
          label="Timesheet"
          active={active === 'timesheet'}
          href={{ pathname: '/payroll', query: { week: weekStart, view: 'timesheet' } }}
        />
        <Tab
          label="By job"
          active={active === 'by-job'}
          href={{ pathname: '/payroll', query: { week: weekStart, view: 'by-job' } }}
        />
      </nav>
    </div>
  );
}

function Tab({
  label,
  active,
  href,
}: {
  label: string;
  active: boolean;
  href: React.ComponentProps<typeof Link>['href'];
}) {
  return (
    <Link
      href={href}
      className={cn(
        'px-4 py-2 text-sm font-medium transition-colors border-b-2',
        active
          ? 'border-slate-900 text-slate-900'
          : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
      )}
    >
      {label}
    </Link>
  );
}
