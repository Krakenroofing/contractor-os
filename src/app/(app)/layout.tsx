import Link from 'next/link';
import { CompanySwitcher } from '@/components/company-switcher';
import { NavLink } from '@/components/nav-link';
import { RoleSwitcher } from '@/components/role-switcher';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { listCompanies } from '@/lib/data/companies';
import { canView, type Resource } from '@/lib/permissions';

const mainNav: { href: string; label: string; resource: Resource }[] = [
  { href: '/dashboard', label: 'Dashboard', resource: 'dashboard' },
  { href: '/projects', label: 'Projects', resource: 'projects' },
  { href: '/customers', label: 'Customers', resource: 'customers' },
  { href: '/vendors', label: 'Vendors', resource: 'vendors' },
  { href: '/cost-codes', label: 'Cost Codes', resource: 'cost_codes' },
  { href: '/estimates', label: 'Estimates', resource: 'estimates' },
  { href: '/proposals', label: 'Proposals', resource: 'proposals' },
  { href: '/change-orders', label: 'Change Orders', resource: 'change_orders' },
  { href: '/purchase-orders', label: 'Purchase Orders', resource: 'purchase_orders' },
  { href: '/landed-cost', label: 'Landed Cost / Shipping', resource: 'landed_cost' },
  { href: '/invoices', label: 'Invoices', resource: 'invoices' },
  { href: '/invoice-templates', label: 'Invoice Templates', resource: 'invoice_templates' },
  { href: '/payments', label: 'Payments', resource: 'payments' },
  {
    href: '/accounts-receivable',
    label: 'Accounts Receivable',
    resource: 'accounts_receivable',
  },
  { href: '/retainage', label: 'Retainage', resource: 'retainage' },
  { href: '/job-costing', label: 'Job Costing', resource: 'job_costing' },
  { href: '/reconciliation', label: 'Reconciliation', resource: 'reconciliation' },
  { href: '/reports', label: 'Reports', resource: 'reports' },
  { href: '/backfill', label: 'Backfill (Historical)', resource: 'backfill' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const activeCompanyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const companies = (await listCompanies()).map((c) => ({ id: c.id, name: c.name }));

  const filteredNav = mainNav.filter((item) => canView(role, item.resource));
  const settingsAllowed = canView(role, 'settings');

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="px-6 py-5 border-b border-slate-200">
          <Link href={{ pathname: '/dashboard' }} className="text-base font-semibold text-slate-900">
            Contractor OS
          </Link>
        </div>

        <div className="px-3 py-3 border-b border-slate-200 space-y-3">
          <CompanySwitcher companies={companies} activeCompanyId={activeCompanyId} />
          <RoleSwitcher activeRole={role} />
        </div>

        <nav className="p-3 space-y-1 flex-1">
          {filteredNav.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-500">
              No modules available for this role.
            </p>
          )}
          {filteredNav.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} />
          ))}
        </nav>

        {settingsAllowed && (
          <nav className="p-3 space-y-1 border-t border-slate-200">
            <NavLink href="/settings" label="Settings" />
          </nav>
        )}
      </aside>
      <main className="flex-1">{children}</main>
    </div>
  );
}
