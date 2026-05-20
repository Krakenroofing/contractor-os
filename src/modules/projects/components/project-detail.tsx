import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney, parseMoney } from '@/lib/money';
import type { Customer, Project } from '@/db/schema';
import { ProjectStatusBadge } from './status-badge';

export function ProjectDetail({
  project,
  customer,
}: {
  project: Project;
  customer: Customer;
}) {
  const address = [
    project.jobsiteAddressLine1,
    project.jobsiteCity,
    project.jobsiteState,
    project.jobsitePostalCode,
  ]
    .filter(Boolean)
    .join(', ');

  const contract = parseMoney(project.contractValue);
  const budget = parseMoney(project.currentBudget);
  const projectedProfit = contract - budget;
  const margin = contract > 0 ? (projectedProfit / contract) * 100 : 0;
  const profitTone =
    projectedProfit < 0
      ? 'text-red-600'
      : projectedProfit === 0
        ? 'text-slate-900'
        : 'text-emerald-600';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{project.name}</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-slate-600">
            <span>{customer.name}</span>
            {address && <span className="text-slate-400">·</span>}
            {address && <span>{address}</span>}
          </div>
        </div>
        <ProjectStatusBadge status={project.status} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Stat label="Contract Value" value={formatMoney(contract)} />
        <Stat label="Estimated Budget" value={formatMoney(budget)} />
        <Stat
          label="Approved Change Orders"
          value={formatMoney(project.totalChangeOrders)}
        />
        <Stat
          label="Projected Gross Profit"
          value={formatMoney(projectedProfit)}
          subValue={contract > 0 ? `${margin.toFixed(1)}% margin` : '—'}
          valueClassName={profitTone}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Project</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <Row label="Name" value={project.name} />
            <Row label="Customer" value={customer.name} />
            <Row label="Status" value={statusLabel(project.status)} />
            <Row
              label="Original contract"
              value={formatMoney(project.originalContractValue)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Jobsite & schedule</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <Row label="Address" value={address || '—'} />
            <Row label="Start date" value={project.startDate ?? '—'} />
            <Row label="Target completion" value={project.targetCompletionDate ?? '—'} />
            <Row label="Actual completion" value={project.actualCompletionDate ?? '—'} />
          </CardContent>
        </Card>
      </div>

      {project.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap">{project.notes}</CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  subValue,
  valueClassName,
}: {
  label: string;
  value: string;
  subValue?: string;
  valueClassName?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${valueClassName ?? 'text-slate-900'}`}
        >
          {value}
        </p>
        {subValue && (
          <p className="mt-0.5 text-xs text-slate-500 tabular-nums">{subValue}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-900">{value}</span>
    </div>
  );
}

function statusLabel(status: Project['status']): string {
  return {
    lead: 'Lead',
    estimating: 'Estimating',
    won: 'Won',
    in_progress: 'In Progress',
    closed: 'Closed',
    lost: 'Lost',
  }[status];
}
