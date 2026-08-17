import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CompanySwitcher } from '@/components/company-switcher';
import { NavLink } from '@/components/nav-link';
import { RoleSwitcher } from '@/components/role-switcher';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { getCurrentUser, isAuthEnabled, isDevDemoMode } from '@/lib/auth';
import { getCompany, listCompanies } from '@/lib/data/companies';
import { listMembershipsForUser } from '@/lib/data/memberships';
import { canView, type Resource } from '@/lib/permissions';

const mainNav: { href: string; label: string; resource: Resource }[] = [
  { href: '/dashboard', label: 'Dashboard', resource: 'dashboard' },
  { href: '/projects', label: 'Projects', resource: 'projects' },
  { href: '/photos', label: 'Photos', resource: 'daily_reports' },
  { href: '/customers', label: 'Customers', resource: 'customers' },
  { href: '/vendors', label: 'Vendors', resource: 'vendors' },
  { href: '/inventory', label: 'Inventory', resource: 'inventory' },
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
  { href: '/employees', label: 'Employees', resource: 'employees' },
  { href: '/clock', label: 'Time Clock', resource: 'clock_events' },
  { href: '/payroll', label: 'Payroll', resource: 'payroll' },
  { href: '/banking', label: 'Banking & Receipts', resource: 'bank_accounts' },
  // Fallback for roles (e.g. PM) that submit receipts but can't see the
  // rest of Banking — hidden below whenever the full Banking link shows.
  { href: '/banking/receipts', label: 'Receipts', resource: 'receipts' },
  { href: '/accounting/todo', label: 'Accounting To-Do', resource: 'statement_imports' },
  { href: '/accounting/journal', label: 'Journal / GL', resource: 'accounting_accounts' },
  { href: '/reconciliation', label: 'Reconciliation', resource: 'reconciliation' },
  { href: '/reports', label: 'Reports', resource: 'reports' },
  { href: '/exports', label: 'Exports (CSV)', resource: 'exports' },
  { href: '/invite', label: 'Invite Users', resource: 'invitations' },
  { href: '/backfill', label: 'Backfill (Historical)', resource: 'backfill' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const authEnabled = isAuthEnabled();
  const demoMode = isDevDemoMode();
  const currentUser = await getCurrentUser();

  // Production fail-safe: if auth env vars are missing AND we're in production,
  // refuse to render the app shell (which would otherwise display the synthetic
  // demo user). Middleware already handles this for non-public routes; this is
  // the layout-level belt-and-suspenders for any path the matcher missed.
  if (!authEnabled && !demoMode) {
    redirect('/login' as never);
  }

  // Auth-enabled but no signed-in user. Middleware should have already
  // redirected; this is the layout-level safety net (e.g. cookie cleared
  // mid-render).
  if (authEnabled && !currentUser) {
    redirect('/login' as never);
  }

  // Auth-enabled gate: if the signed-in user has no active memberships,
  // bounce them to /no-access. Demo mode skips this — there are no real
  // memberships in the in-memory store.
  let userMemberships: Awaited<ReturnType<typeof listMembershipsForUser>> = [];
  if (authEnabled && currentUser) {
    userMemberships = await listMembershipsForUser(currentUser.id);
    if (userMemberships.length === 0) {
      // URL-object form bypasses typedRoutes literal narrowing for routes
      // outside the (app) group that the type system hasn't picked up yet.
      redirect('/no-access' as never);
    }
  }

  const activeCompanyId = await getActiveCompanyId();
  const role = await getActiveRole();

  // Field users never see the desktop office shell. Bounce them to the
  // mobile field app — that's the only surface they're supposed to use
  // (clock, today's jobs, daily reports + photos).
  if (role === 'field_user') {
    redirect('/field' as never);
  }

  // In auth-enabled mode the company switcher must only show companies the
  // current user has a membership in — otherwise the dropdown leaks every
  // tenant's name and confuses users by listing companies they can't switch
  // into. Demo mode keeps the full list so cookie-driven tenant swaps work.
  const companies = authEnabled
    ? (
        await Promise.all(userMemberships.map((m) => getCompany(m.companyId)))
      )
        .filter((c): c is NonNullable<typeof c> => Boolean(c))
        .map((c) => ({ id: c.id, name: c.name }))
    : (await listCompanies()).map((c) => ({ id: c.id, name: c.name }));

  const filteredNav = mainNav.filter((item) => {
    if (item.href === '/banking/receipts' && canView(role, 'bank_accounts')) {
      return false;
    }
    return canView(role, item.resource);
  });
  const settingsAllowed = canView(role, 'settings');

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col print:hidden">
        <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between gap-2">
          <Link href={{ pathname: '/dashboard' }} className="text-base font-semibold text-slate-900">
            KrakenOps Pro
          </Link>
          {/* Demo-mode badge — local development only. Never rendered in
              production builds (see isDevDemoMode in src/lib/auth). */}
          {demoMode && (
            <span
              className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900"
              title="Demo mode: env vars missing, running on local mock store"
            >
              Demo
            </span>
          )}
        </div>

        <div className="px-3 py-3 border-b border-slate-200 space-y-3">
          <CompanySwitcher companies={companies} activeCompanyId={activeCompanyId} />
          {/* RoleSwitcher is a developer affordance — it lets you preview the
              UI as a different role. In auth-enabled mode the role comes from
              the user's membership row, so the switcher would be misleading. */}
          {!authEnabled && <RoleSwitcher activeRole={role} />}
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

        {authEnabled && currentUser && (
          <div className="p-3 border-t border-slate-200">
            <p className="px-3 py-1 text-xs text-slate-500 truncate">
              {currentUser.name}
            </p>
            {/* POST-form, NOT a <Link>. Sign Out must never be a GET — see
                src/app/logout/route.ts for the full explanation. The previous
                <Link href="/logout"> was being prefetched by the browser on
                sidebar render, which silently called the GET handler, signed
                the user out, and made every subsequent click redirect to
                /login. A form's POST is never prefetched. */}
            <form action="/logout" method="post">
              <button
                type="submit"
                className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md"
              >
                Sign out
              </button>
            </form>
          </div>
        )}
      </aside>
      <main className="flex-1">{children}</main>
    </div>
  );
}
