import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { isAuthEnabled } from '@/lib/auth';
import { canCreate, ROLE_LABELS, type Role } from '@/lib/permissions';
import { listInvitationsForCompany } from '@/lib/data/invitations';
import { listEmployees } from '@/lib/data/employees';
import {
  listCompanyUsersWithLinks,
  listUsersWithEmployeeLink,
} from '@/lib/data/users';
import { isExpired } from '@/modules/invitations/lib/tokens';
import { InviteForm } from '@/modules/invitations/components/invite-form';
import { RevokeButton } from '@/modules/invitations/components/revoke-button';
import { UserEmployeeLinkRow } from '@/modules/users/components/user-employee-link-row';

export const dynamic = 'force-dynamic';

export default async function InvitePage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'invitations')) redirect('/dashboard');

  const company = await getActiveCompany();
  const invites = await listInvitationsForCompany(company.id);
  // Employee picker options for field_user invites + the link-manager
  // section below. Both surfaces want "every active employee" and "who
  // is each currently linked to" — fetch once, project twice.
  const [allEmployees, linkedUsers, companyUsers] = await Promise.all([
    listEmployees(company.id),
    listUsersWithEmployeeLink(company.id),
    listCompanyUsersWithLinks(company.id),
  ]);
  const linkedEmployeeIds = new Set(
    linkedUsers.map((u) => u.employeeId).filter((id): id is string => !!id),
  );
  const employeeOptions = allEmployees
    .filter((e) => e.active)
    .map((e) => ({
      id: e.id,
      label: `${e.firstName} ${e.lastName}`.trim(),
      alreadyLinked: linkedEmployeeIds.has(e.id),
    }));

  // Options for the link-manager dropdown: every active employee, with
  // a "linked to X" annotation when applicable. Includes contract /
  // sub-employee rows since their drivers can have logins too.
  const userByEmployeeId = new Map<string, string>(); // employeeId → linked user email
  for (const u of companyUsers) {
    if (u.employeeId) userByEmployeeId.set(u.employeeId, u.email);
  }
  const linkOptions = allEmployees
    .filter((e) => e.active)
    .map((e) => ({
      id: e.id,
      label: `${e.firstName} ${e.lastName}`.trim(),
      linkedToEmail: userByEmployeeId.get(e.id) ?? null,
    }));

  // Categorize for display
  const pending = invites.filter(
    (i) => !i.acceptedAt && !i.revokedAt && !isExpired(i.expiresAt),
  );
  const expired = invites.filter(
    (i) => !i.acceptedAt && !i.revokedAt && isExpired(i.expiresAt),
  );
  const accepted = invites.filter((i) => !!i.acceptedAt);
  const revoked = invites.filter((i) => !!i.revokedAt && !i.acceptedAt);

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <div
        className={`rounded-md px-4 py-2 text-sm border ${
          isAuthEnabled()
            ? 'bg-blue-50 border-blue-200 text-blue-900'
            : 'bg-amber-50 border-amber-200 text-amber-900'
        }`}
      >
        {isAuthEnabled() ? (
          <>
            Invite users to <span className="font-medium">{company.name}</span>.
            Each invite is a single-use link tied to a role. The recipient sets
            their password on the linked page; their membership is created
            automatically.
          </>
        ) : (
          <>
            Demo mode — invitations require Supabase Auth. Set{' '}
            <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code>{' '}
            and{' '}
            <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{' '}
            in <code className="font-mono text-xs">.env.local</code>, then
            restart the dev server. See SETUP.md for full instructions.
          </>
        )}
      </div>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Invite users</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Acting as {ROLE_LABELS[role]} of {company.name}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>New invitation</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteForm companyName={company.name} employees={employeeOptions} />
        </CardContent>
      </Card>

      {/* User → employee link manager. One row per active member of the
          company. Lets the admin retroactively link an existing user to
          an employee (e.g. owner linking themselves so /clock attributes
          punches correctly) or reassign / clear an existing link.
          Includes contract / sub-employee rows in the dropdown — they
          can have logins too. */}
      <Card>
        <CardHeader>
          <CardTitle>Users in this company</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {companyUsers.length === 0 ? (
            <p className="px-6 py-6 text-sm text-slate-500">
              No active members yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Linked employee</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companyUsers.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="text-slate-900 text-sm">
                      {u.name}
                    </TableCell>
                    <TableCell className="text-slate-700 text-xs">
                      {u.email}
                    </TableCell>
                    <TableCell>
                      <Badge tone="slate">{ROLE_LABELS[u.role]}</Badge>
                    </TableCell>
                    <TableCell>
                      <UserEmployeeLinkRow
                        userId={u.id}
                        userEmail={u.email}
                        currentEmployeeId={u.employeeId}
                        options={linkOptions}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Pending invitations ({pending.length})</CardTitle>
              <Badge tone="amber">awaiting acceptance</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="text-slate-900">{i.email}</TableCell>
                    <TableCell>
                      <Badge tone="slate">
                        {ROLE_LABELS[i.role as Role] ?? i.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-600 text-xs">
                      {i.createdAt.toISOString().slice(0, 10)}
                    </TableCell>
                    <TableCell className="text-slate-600 text-xs">
                      {i.expiresAt.toISOString().slice(0, 10)}
                    </TableCell>
                    <TableCell className="text-right">
                      <RevokeButton invitationId={i.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {(accepted.length > 0 || expired.length > 0 || revoked.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...accepted, ...expired, ...revoked].map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="text-slate-700">{i.email}</TableCell>
                    <TableCell>
                      <Badge tone="slate">
                        {ROLE_LABELS[i.role as Role] ?? i.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {i.acceptedAt ? (
                        <Badge tone="green">
                          accepted {i.acceptedAt.toISOString().slice(0, 10)}
                        </Badge>
                      ) : i.revokedAt ? (
                        <Badge tone="red">revoked</Badge>
                      ) : (
                        <Badge tone="slate">expired</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-600 text-xs">
                      {i.createdAt.toISOString().slice(0, 10)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
