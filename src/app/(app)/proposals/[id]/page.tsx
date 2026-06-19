import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { BackButton } from '@/components/back-button';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/money';
import { CompanyStandardTerms } from '@/components/company-standard-terms';
import { DocumentBranding } from '@/components/document-branding';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getEstimate } from '@/lib/data/estimates';
import { getProposal } from '@/lib/data/proposals';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import { ActivityLogCard } from '@/modules/status/components/activity-log-card';
import { StatusBadge } from '@/modules/status/components/status-badge';
import { StatusPanel } from '@/modules/status/components/status-panel';
import { DocumentDownloadButtons } from '@/components/document-download-buttons';

export const dynamic = 'force-dynamic';

function formatDate(d: Date | string | null) {
  if (!d) return '—';
  if (typeof d === 'string') return d;
  return d.toISOString().slice(0, 10);
}

export default async function ProposalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const fromProject = from === 'project';
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'proposals');
  const proposal = await getProposal(companyId, id);
  if (!proposal) notFound();

  const project = await getProject(companyId, proposal.projectId);
  const customer = project ? await getCustomer(companyId, project.customerId) : undefined;
  const estimate = await getEstimate(companyId, proposal.estimateId);

  const signed =
    (proposal.status === 'accepted' || proposal.status === 'approved') &&
    (proposal.signedByName || proposal.acceptedAt || proposal.approvedAt);

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <Breadcrumbs
        items={[
          ...(fromProject && project
            ? [{ href: `/projects/${project.id}`, label: project.name }]
            : []),
          { href: '/proposals', label: 'Proposals' },
          { label: proposal.number },
        ]}
      />

      <div className="flex items-center justify-between">
        <BackButton
          listHref="/proposals"
          listLabel="Proposals"
          projectId={fromProject ? proposal.projectId : null}
          projectName={project?.name}
        />
        <div className="flex items-center gap-2">
          <DocumentDownloadButtons type="proposal" id={proposal.id} />
          {allowCreate && (
            <Link href={{ pathname: `/proposals/${proposal.id}/edit` }}>
              <Button size="sm" variant="outline">
                Edit
              </Button>
            </Link>
          )}
          {allowCreate && (
            <Link href="/proposals/new">
              <Button size="sm">New Proposal</Button>
            </Link>
          )}
        </div>
      </div>

      <DocumentBranding />

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-slate-500">{proposal.number}</p>
          <h1 className="text-2xl font-semibold text-slate-900">
            {project?.name ?? 'Proposal'}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-600">
            {customer && <span>{customer.name}</span>}
            {project && (
              <>
                <span className="text-slate-400">·</span>
                <Link href={`/projects/${project.id}`} className="hover:underline">
                  {project.name}
                </Link>
              </>
            )}
            {estimate && (
              <>
                <span className="text-slate-400">·</span>
                <Link href={`/estimates/${estimate.id}`} className="hover:underline">
                  {estimate.number}
                </Link>
              </>
            )}
          </div>
        </div>
        <StatusBadge entityType="proposal" status={proposal.status} />
      </div>

      <StatusPanel
        entityType="proposal"
        entityId={proposal.id}
        status={proposal.status}
        timestamps={[
          { label: 'Created', value: proposal.createdAt },
          { label: 'Sent', value: proposal.sentAt },
          {
            label: 'Approved',
            value: proposal.approvedAt ?? proposal.acceptedAt,
          },
          {
            label: 'Rejected',
            value: proposal.rejectedAt ?? proposal.declinedAt,
          },
        ]}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatMoney(proposal.total)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">from linked estimate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Proposal date
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {proposal.proposalDate ?? '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Valid until</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {proposal.expiryDate ?? '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      <ProposalSection title="Scope of Work" body={proposal.scopeOfWork} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ProposalSection title="Inclusions" body={proposal.inclusions} compact />
        <ProposalSection title="Exclusions" body={proposal.exclusions} compact />
        <ProposalSection
          title="Payment Schedule"
          body={proposal.paymentSchedule}
          compact
        />
        <ProposalSection title="Warranty Notes" body={proposal.warrantyNotes} compact />
      </div>
      <ProposalSection
        title="Terms and Conditions"
        body={proposal.termsAndConditions}
      />

      <CompanyStandardTerms showProposalValidity />

      <Card>
        <CardHeader>
          <CardTitle>Signature</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {signed ? (
            <div className="space-y-2">
              <div className="border border-slate-200 rounded-md bg-slate-50 px-4 py-6 italic text-slate-700">
                Signed by {proposal.signedByName ?? 'customer'}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-slate-600">
                <Row label="Name" value={proposal.signedByName ?? '—'} />
                <Row label="Email" value={proposal.signedByEmail ?? '—'} />
                <Row label="Accepted on" value={formatDate(proposal.acceptedAt)} />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="border border-dashed border-slate-300 rounded-md px-4 py-10 text-center text-slate-400">
                Awaiting customer signature
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-slate-500">
                <Row label="Name" value="—" />
                <Row label="Email" value="—" />
                <Row label="Date" value="—" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ActivityLogCard entityType="proposal" entityId={proposal.id} />
    </div>
  );
}

function ProposalSection({
  title,
  body,
  compact,
}: {
  title: string;
  body: string | null;
  compact?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className={`text-sm ${compact ? '' : 'leading-relaxed'}`}>
        {body && body.trim() !== '' ? (
          <div className="whitespace-pre-wrap text-slate-800">{body}</div>
        ) : (
          <span className="text-slate-400">Not provided</span>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-slate-900">{value}</p>
    </div>
  );
}
