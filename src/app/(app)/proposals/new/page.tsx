import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  ProposalForm,
  type EstimateOption,
  type ProjectOption,
} from '@/modules/proposals/components/proposal-form';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listEstimates } from '@/lib/data/estimates';
import { nextProposalNumber } from '@/lib/data/proposals';
import { getCustomer, listCustomers } from '@/lib/data/customers';
import { getProject, listProjects } from '@/lib/data/projects';
import { getWorkOrderWithDetails } from '@/lib/data/work-orders';
import { listInventoryItems } from '@/lib/data/inventory-items';
import type { ProposalFormPrefill } from '@/modules/proposals/components/proposal-form';

export const dynamic = 'force-dynamic';


export default async function NewProposalPage({
  searchParams,
}: {
  searchParams?: Promise<{ workOrder?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const role = await getActiveRole();
  if (!canCreate(role, 'proposals')) redirect('/proposals');
  const companyId = await getActiveCompanyId();
  const estimates: EstimateOption[] = await Promise.all(
    (await listEstimates(companyId)).map(async (e) => {
      const project = await getProject(companyId, e.projectId);
      const customer = project
        ? await getCustomer(companyId, project.customerId)
        : undefined;
      return {
        id: e.id,
        number: e.number,
        projectName: project?.name ?? 'Unknown project',
        customerName: customer?.name ?? 'Unknown customer',
        total: e.total,
      };
    }),
  );

  const projects: ProjectOption[] = await Promise.all(
    (await listProjects(companyId)).map(async (p) => {
      const customer = await getCustomer(companyId, p.customerId);
      return {
        id: p.id,
        name: p.name,
        customerName: customer?.name ?? '—',
      };
    }),
  );

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <Link href="/proposals">
        <Button variant="outline" size="sm">
          ← Back to Proposals
        </Button>
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">New proposal</h1>
        <p className="text-sm text-slate-500 mt-1">
          Link an estimate to anchor the project, customer, and total — or go
          standalone and pick the project directly. Have a finished proposal
          PDF already?{' '}
          <Link href="/proposals/upload" className="underline">
            Create it from the PDF
          </Link>
          .
        </p>
      </header>

      <ProposalForm
        estimates={estimates}
        projects={projects}
        customers={(await listCustomers(companyId)).map((c) => ({ id: c.id, name: c.name }))}
        defaultNumber={await nextProposalNumber(companyId)}
        prefill={await buildWorkOrderPrefill(companyId, sp.workOrder)}
        proofreadAvailable={Boolean(process.env.ANTHROPIC_API_KEY)}
      />
    </div>
  );
}

/**
 * "Save as proposal" from a work order: prefill the proposal with the
 * service call's content. Scope = the crew's repairs text; inclusions =
 * labor hours + materials as recorded; total = the same T&M pricing the
 * WO -> invoice prefill uses (project bill rate x hours + catalog cost x
 * material markup) when those rates exist — otherwise left blank for the
 * operator to price. Everything stays editable.
 */
async function buildWorkOrderPrefill(
  companyId: string,
  workOrderId: string | undefined,
): Promise<ProposalFormPrefill | undefined> {
  if (!workOrderId) return undefined;
  const det = await getWorkOrderWithDetails(companyId, workOrderId);
  if (!det) return undefined;

  const project = det.projectId
    ? await getProject(companyId, det.projectId)
    : undefined;
  const products = await listInventoryItems(companyId);
  const productById = new Map(products.map((p) => [p.id, p]));
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const laborHours = round2(
    det.labor.reduce((s, l) => s + Number(l.hours), 0),
  );
  const billRate = Number(project?.tmLaborBillRate ?? 0);
  const markupPct = project?.tmMaterialMarkupPct
    ? Number(project.tmMaterialMarkupPct)
    : null;

  let total = laborHours > 0 && billRate > 0 ? laborHours * billRate : 0;
  const inclusionLines: string[] = [];
  if (laborHours > 0) {
    inclusionLines.push(`Labor: ${laborHours.toFixed(2)} crew-hours`);
  }
  for (const m of det.materials) {
    const qty = Number(m.quantity);
    inclusionLines.push(
      `${qty % 1 === 0 ? qty : qty.toFixed(2)} ${m.unit ?? ''} ${m.name}`.replace(/\s+/g, ' ').trim(),
    );
    const item = m.inventoryItemId ? productById.get(m.inventoryItemId) : undefined;
    const baseCost = Number(item?.defaultCost ?? 0);
    if (baseCost > 0) {
      const price =
        markupPct != null && markupPct > 0
          ? round2(baseCost * (1 + markupPct / 100))
          : baseCost;
      total += qty * price;
    }
  }

  const scopeParts = [
    `Service call ${det.number} (${det.workDate})${det.customerName ? ` — ${det.customerName}` : ''}`,
  ];
  if (det.repairsDone?.trim()) scopeParts.push(det.repairsDone.trim());

  return {
    projectId: det.projectId ?? null,
    scopeOfWork: scopeParts.join('\n\n'),
    inclusions: inclusionLines.join('\n') || null,
    total: total > 0 ? round2(total).toFixed(2) : null,
  };
}
