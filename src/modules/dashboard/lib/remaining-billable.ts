import 'server-only';
import { listProjects } from '@/lib/data/projects';
import { listCustomers } from '@/lib/data/customers';
import { computeProjectInvoiceSummary } from '@/lib/data/invoices';
import { getContractReductionRefundByProjectMap } from '@/lib/data/credit-memos';
import { add, parseMoney, subtract } from '@/lib/money';

// "Remaining billable" per project = revised contract (net) − net billed,
// netting back any scope-reduction refunds (so a refunded job doesn't read as
// under-billed). This is the SAME still-billable math the customer summary
// uses, so the per-project figure on /projects/[id] and the collective total
// on the dashboard tie out exactly.

const r2 = (n: number) => Math.round(n * 100) / 100;

// Active book of work — matches the dashboard's "active contract value" scope.
function isActiveProject(status: string): boolean {
  return status === 'in_progress' || status === 'won';
}

export type ProjectRemainingBillable = {
  projectId: string;
  projectName: string;
  customerName: string | null;
  status: string;
  /** Revised contract, NET (project.contractValue = original + approved COs). */
  revisedContract: number;
  /** Net invoiced (ex-VAT), non-void. */
  billedNet: number;
  /** Net scope-reduction refunds credited back (de-VAT'd). */
  refundsCredited: number;
  /** revisedContract − (billedNet − refundsCredited). */
  remainingBillable: number;
};

export type RemainingBillableSummary = {
  rows: ProjectRemainingBillable[];
  totalRevisedContract: number;
  totalBilledNet: number;
  totalRemaining: number;
};

/** Single-project remaining billable. Reused by the project detail page. */
export function computeRemainingBillable(
  revisedContractNet: number,
  billedNet: number,
  refundsCredited: number,
): number {
  return r2(subtract(revisedContractNet, subtract(billedNet, refundsCredited)));
}

export async function buildRemainingBillable(
  companyId: string,
): Promise<RemainingBillableSummary> {
  const [projects, customers, refundMap] = await Promise.all([
    listProjects(companyId),
    listCustomers(companyId),
    getContractReductionRefundByProjectMap(companyId),
  ]);
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const rows: ProjectRemainingBillable[] = [];
  // Service / T&M jobs have no contract value — exclude them from this
  // contract-based "remaining billable" view (else a $0 contract billed as
  // T&M reads as negative remaining).
  for (const p of projects.filter(
    (pr) => isActiveProject(pr.status) && pr.projectType !== 'service',
  )) {
    const summary = await computeProjectInvoiceSummary(p.id);
    const revisedContract = r2(parseMoney(p.contractValue));
    const billedNet = r2(summary.totalInvoicedNet);
    const refundsCredited = r2(refundMap.get(p.id) ?? 0);
    // Skip projects with no contract and nothing billed — nothing to show.
    if (revisedContract === 0 && billedNet === 0) continue;
    rows.push({
      projectId: p.id,
      projectName: p.name,
      customerName: customerById.get(p.customerId)?.name ?? null,
      status: p.status,
      revisedContract,
      billedNet,
      refundsCredited,
      remainingBillable: computeRemainingBillable(
        revisedContract,
        billedNet,
        refundsCredited,
      ),
    });
  }
  rows.sort((a, b) => b.remainingBillable - a.remainingBillable);

  const totals = rows.reduce(
    (acc, r) => ({
      revised: add(acc.revised, r.revisedContract),
      billed: add(acc.billed, r.billedNet),
      remaining: add(acc.remaining, r.remainingBillable),
    }),
    { revised: 0, billed: 0, remaining: 0 },
  );
  return {
    rows,
    totalRevisedContract: r2(totals.revised),
    totalBilledNet: r2(totals.billed),
    totalRemaining: r2(totals.remaining),
  };
}
