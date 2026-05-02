import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { listProjects } from '@/lib/data/projects';
import { listProposals } from '@/lib/data/proposals';
import { BACKFILL_CUTOFF_ISO } from '@/modules/backfill/lib/backfill';
import { ProposalMiniForm } from '@/modules/backfill/components/proposal-mini-form';
import { StepShell } from '@/modules/backfill/components/step-shell';

export const dynamic = 'force-dynamic';

const CUTOFF = new Date(`${BACKFILL_CUTOFF_ISO}T00:00:00Z`);

export default async function BackfillProposalsPage() {
  const role = await getActiveRole();
  if (!canView(role, 'backfill')) redirect('/dashboard');
  const companyId = await getActiveCompanyId();
  const [projects, proposals] = await Promise.all([
    listProjects(companyId),
    listProposals(companyId),
  ]);
  const recent = proposals.filter(
    (p) =>
      (p.proposalDate &&
        new Date(`${p.proposalDate}T00:00:00Z`).getTime() >= CUTOFF.getTime()) ||
      p.createdAt.getTime() >= CUTOFF.getTime(),
  );

  return (
    <StepShell
      step="proposals"
      prevHref="/backfill/projects"
      nextHref="/backfill/change-orders"
    >
      <Card>
        <CardHeader>
          <CardTitle>Add a contract / proposal</CardTitle>
        </CardHeader>
        <CardContent>
          <ProposalMiniForm
            projects={projects.map((p) => ({
              id: p.id,
              label: `${p.number} — ${p.name}`,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Proposals entered ({recent.length})</CardTitle>
            <Link href={{ pathname: '/proposals' }} className="text-sm text-slate-500 hover:underline">
              Full proposals list →
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No proposals backfilled yet.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {recent.map((p) => (
                <li
                  key={p.id}
                  className="py-2 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">
                      <span className="font-mono text-xs text-slate-500 mr-2">
                        {p.number}
                      </span>
                      {formatMoney(p.total)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {p.proposalDate ?? '—'}
                      {p.expiryDate ? ` · expires ${p.expiryDate}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="slate">{p.status}</Badge>
                    <Link
                      href={{ pathname: `/proposals/${p.id}` }}
                      className="text-xs text-slate-600 hover:underline"
                    >
                      Open →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </StepShell>
  );
}
