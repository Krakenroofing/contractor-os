import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { BackButton } from '@/components/back-button';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import {
  getCreditMemo,
  listApplicationsForCreditMemo,
} from '@/lib/data/credit-memos';
import { getCustomer } from '@/lib/data/customers';
import { getProject } from '@/lib/data/projects';
import { getInvoice, listInvoicesForProject } from '@/lib/data/invoices';
import { DocumentDownloadButtons } from '@/components/document-download-buttons';
import { CreditMemoDetailActions } from '@/modules/credit-memos/components/credit-memo-detail-actions';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, 'slate' | 'blue' | 'amber' | 'green' | 'red'> = {
  draft: 'slate',
  issued: 'blue',
  partially_applied: 'amber',
  applied: 'green',
  refunded: 'green',
  void: 'red',
};

const KIND_LABEL: Record<string, string> = {
  invoice_application: 'Applied to invoice',
  cash_refund: 'Cash refund',
};

export default async function CreditMemoDetailPage({
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
  const allowEdit = canCreate(role, 'invoices');

  const cm = await getCreditMemo(companyId, id);
  if (!cm) notFound();

  const customer = await getCustomer(companyId, cm.customerId);
  const project = cm.projectId ? await getProject(companyId, cm.projectId) : null;
  const sourceInvoice = cm.invoiceId
    ? await getInvoice(companyId, cm.invoiceId)
    : null;
  const applications = await listApplicationsForCreditMemo(companyId, cm.id);

  // Invoices the operator can pick from when applying remaining balance.
  // Scope: customer's invoices (any project) that are non-void.
  const customerInvoices = project
    ? (await listInvoicesForProject(project.id)).filter((i) => i.status !== 'void')
    : [];

  const amount = Number(cm.amount);
  const applied = Number(cm.appliedAmount);
  const open = Math.max(amount - applied, 0);

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <Breadcrumbs
        items={[
          ...(fromProject && project
            ? [{ href: `/projects/${project.id}`, label: project.name }]
            : []),
          { href: '/invoices', label: 'Invoices' },
          { label: cm.number },
        ]}
      />

      <div className="flex items-center justify-between gap-2">
        <BackButton
          listHref="/invoices"
          listLabel="Invoices"
          projectId={fromProject ? project?.id : null}
          projectName={project?.name}
        />
        <DocumentDownloadButtons type="credit_memo" id={cm.id} />
      </div>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="font-mono text-xs text-slate-500">{cm.number}</p>
          <h1 className="text-2xl font-semibold text-slate-900">
            Credit memo
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-600">
            {customer && (
              <Link href={`/customers/${customer.id}`} className="hover:underline">
                {customer.name}
              </Link>
            )}
            {project && (
              <>
                <span className="text-slate-400">·</span>
                <Link href={`/projects/${project.id}`} className="hover:underline">
                  {project.name}
                </Link>
              </>
            )}
            {sourceInvoice && (
              <>
                <span className="text-slate-400">·</span>
                <Link
                  href={`/invoices/${sourceInvoice.id}`}
                  className="hover:underline font-mono"
                >
                  {sourceInvoice.number}
                </Link>
              </>
            )}
          </div>
        </div>
        <Badge tone={STATUS_TONE[cm.status] ?? 'slate'}>
          {cm.status.replace('_', ' ')}
        </Badge>
      </header>

      <Card>
        <CardContent className="p-4 grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Amount</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
              {formatMoney(amount)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Applied</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-slate-700">
              {formatMoney(applied)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Open</p>
            <p
              className={`mt-1 text-xl font-semibold tabular-nums ${
                open > 0 ? 'text-amber-700' : 'text-emerald-700'
              }`}
            >
              {formatMoney(open)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <Row label="Issue date" value={cm.issueDate} />
          <Row label="Reason" value={cm.reason} />
          {cm.notes && <Row label="Notes" value={cm.notes} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Applications ({applications.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {applications.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No applications yet. Apply this credit to an invoice or refund it
              as cash below.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Target / Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  {allowEdit && <TableHead className="text-right w-28" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-slate-600">{a.appliedAt}</TableCell>
                    <TableCell className="text-slate-700 text-xs">
                      {KIND_LABEL[a.kind] ?? a.kind}
                    </TableCell>
                    <TableCell className="text-slate-700 text-xs">
                      {a.kind === 'invoice_application' && a.invoiceId ? (
                        <Link
                          href={`/invoices/${a.invoiceId}`}
                          className="text-blue-600 hover:underline font-mono"
                        >
                          {a.invoiceId.slice(0, 8)}…
                        </Link>
                      ) : a.kind === 'cash_refund' ? (
                        <>
                          {a.bankAccount ?? '—'}
                          {a.reference && (
                            <span className="ml-1 text-slate-400 font-mono">
                              · {a.reference}
                            </span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(a.amount)}
                    </TableCell>
                    {allowEdit && (
                      <TableCell className="text-right">
                        <CreditMemoDetailActions
                          mode="unapply"
                          applicationId={a.id}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {allowEdit && cm.status !== 'void' && (
        <CreditMemoDetailActions
          mode="manage"
          creditMemoId={cm.id}
          openBalance={open}
          customerInvoices={customerInvoices.map((i) => ({
            id: i.id,
            number: i.number,
          }))}
          canVoid={applications.length === 0 && open === amount}
        />
      )}
    </div>
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
