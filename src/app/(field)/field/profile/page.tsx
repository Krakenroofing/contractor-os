// Field profile screen — "who am I signed in as", with sign-out. The
// employee link is the most important info here: a worker should be able
// to glance and confirm the app thinks they ARE them before clocking in
// or submitting a daily report.
//
// For owner / PM users without an employee link, we surface a self-link
// picker right here (M1.1 fix) so the privileged user can claim
// themselves without waiting on an admin tool. Field users without a
// link still see the read-only banner — their link comes via the invite
// flow, not self-service.

import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getActiveEmployee } from '@/lib/active-employee';
import { getActiveCompany, getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { getCurrentUser } from '@/lib/auth';
import { canCreate, ROLE_LABELS } from '@/lib/permissions';
import { listEmployees } from '@/lib/data/employees';
import { listUsersWithEmployeeLink } from '@/lib/data/users';
import {
  SelfLinkPanel,
  UnlinkButton,
} from '@/modules/field/components/self-link-panel';

export const dynamic = 'force-dynamic';

export default async function FieldProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login' as never);

  const [employee, company, role, companyId] = await Promise.all([
    getActiveEmployee(),
    getActiveCompany(),
    getActiveRole(),
    getActiveCompanyId(),
  ]);

  // Self-link is gated to invitations:create — same policy as the invite
  // page (owner + view_only-with-perms). Field workers never see this
  // section; their link comes via the admin's invite.
  const canSelfLink = canCreate(role, 'invitations');

  // Load employee options only when we need to render the picker —
  // skips an unnecessary DB round-trip for users who already have a link.
  const employeeOptions =
    canSelfLink && !employee
      ? await (async () => {
          const [allEmployees, linkedUsers] = await Promise.all([
            listEmployees(companyId),
            listUsersWithEmployeeLink(companyId),
          ]);
          const linkedIds = new Set(
            linkedUsers
              .map((u) => u.employeeId)
              .filter((id): id is string => !!id),
          );
          return allEmployees
            .filter((e) => e.active)
            .map((e) => ({
              id: e.id,
              label: `${e.firstName} ${e.lastName}`.trim(),
              alreadyLinked: linkedIds.has(e.id),
            }));
        })()
      : [];

  return (
    <div className="px-4 py-5 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Profile</h1>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 space-y-3">
        <Row label="Signed in as" value={user.email ?? user.name} />
        <Row label="Company" value={company.name} />
        <Row label="Role" value={ROLE_LABELS[role]} />
        {employee ? (
          <>
            <Row
              label="Employee record"
              value={`${employee.firstName} ${employee.lastName}`}
            />
            {employee.nibNumber && (
              <Row label="NIB #" value={employee.nibNumber} />
            )}
          </>
        ) : !canSelfLink ? (
          // Field-user view: read-only banner. Their link comes via the
          // admin's invite — they can't self-link.
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
            <p className="text-xs text-amber-900">
              Not linked to an employee record. Some field features (clock
              in/out, daily reports) will be limited until your administrator
              creates the link.
            </p>
          </div>
        ) : null}
      </div>

      {/* Self-link picker — only for owner/PM without an existing link. */}
      {!employee && canSelfLink && (
        <SelfLinkPanel employees={employeeOptions} />
      )}

      {/* Unlink button — only when already linked, and only if the user
          had self-link permission in the first place. */}
      {employee && canSelfLink && <UnlinkButton />}

      {/* POST-only logout — see src/app/logout/route.ts for the reason. */}
      <form method="post" action="/logout">
        <Button type="submit" variant="outline" className="w-full">
          Sign out
        </Button>
      </form>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="text-sm font-medium text-slate-900 text-right">
        {value}
      </span>
    </div>
  );
}
