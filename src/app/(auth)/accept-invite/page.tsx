import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { isAuthEnabled } from '@/lib/auth';
import { getInvitationByToken } from '@/lib/data/invitations';
import { isExpired } from '@/modules/invitations/lib/tokens';
import { ROLE_LABELS, type Role } from '@/lib/permissions';
import { getCompany } from '@/lib/data/companies';
import { AcceptInviteForm } from './accept-form';

export const dynamic = 'force-dynamic';

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : '';

  if (!isAuthEnabled()) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-slate-700 space-y-3">
          <p>This site is running in demo mode — there&apos;s no auth system to accept an invite into.</p>
          <Link href={{ pathname: '/dashboard' }}>
            <Button size="sm" variant="outline">
              Continue to demo
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!token) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-red-700">
          Missing invite token. Use the full link your inviter sent you.
        </CardContent>
      </Card>
    );
  }

  const invitation = await getInvitationByToken(token);

  if (!invitation) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-red-700 space-y-2">
          <p>This invitation link is not valid.</p>
          <p className="text-xs text-slate-600">
            Ask your administrator to issue a fresh invite.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (invitation.acceptedAt) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          <p className="text-sm text-slate-700">
            This invitation has already been accepted. If that was you, sign in
            with your password.
          </p>
          <Link href={{ pathname: '/login' }}>
            <Button size="sm">Go to sign in</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (invitation.revokedAt) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-red-700">
          This invitation has been revoked. Ask the inviter to issue a new one.
        </CardContent>
      </Card>
    );
  }

  if (isExpired(invitation.expiresAt)) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-red-700">
          This invitation has expired. Ask the inviter to issue a new one.
        </CardContent>
      </Card>
    );
  }

  const company = await getCompany(invitation.companyId);

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Invitation
          </p>
          <p className="text-base font-medium text-slate-900">
            Join {company?.name ?? 'this company'}
          </p>
          <p className="text-xs text-slate-500">
            Role on accept:{' '}
            <span className="font-medium">
              {ROLE_LABELS[invitation.role as Role] ?? invitation.role}
            </span>
            <span className="mx-1">·</span>
            Email: <span className="font-mono">{invitation.email}</span>
          </p>
        </div>

        <AcceptInviteForm
          token={token}
          email={invitation.email}
          companyName={company?.name ?? 'this company'}
        />
      </CardContent>
    </Card>
  );
}
