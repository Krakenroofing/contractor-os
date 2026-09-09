// Office → work order detail: review the field submission, record the
// client, post to job costing, link the invoice.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate, canView } from '@/lib/permissions';
import { getWorkOrderWithDetails } from '@/lib/data/work-orders';
import { listEmployees } from '@/lib/data/employees';
import { listCustomers } from '@/lib/data/customers';
import { listProjects } from '@/lib/data/projects';
import { listInvoices } from '@/lib/data/invoices';
import { listInventoryItems } from '@/lib/data/inventory-items';
import { listWorkOrderPhotos } from '@/lib/data/work-orders';
import { createSignedPhotoUrl } from '@/lib/storage/daily-report-photos';
import { OfficeWorkOrderEditor } from '@/modules/work-orders/components/office-work-order-editor';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, { label: string; tone: 'amber' | 'green' | 'slate' }> = {
  submitted: { label: 'To review', tone: 'amber' },
  posted: { label: 'Posted', tone: 'green' },
  void: { label: 'Void', tone: 'slate' },
};

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const role = await getActiveRole();
  if (!canView(role, 'projects')) redirect('/dashboard' as never);
  const companyId = await getActiveCompanyId();
  const { id } = await params;
  const wo = await getWorkOrderWithDetails(companyId, id);
  if (!wo) notFound();

  const [employees, customers, projects, invoices, inventoryItems, photos] =
    await Promise.all([
      listEmployees(companyId),
      listCustomers(companyId),
      listProjects(companyId),
      listInvoices(companyId),
      listInventoryItems(companyId),
      listWorkOrderPhotos(companyId, id),
    ]);
  const photoCards = await Promise.all(
    photos.map(async (p) => ({
      id: p.id,
      url: await createSignedPhotoUrl(p.storagePath).catch(() => null),
      caption: p.caption,
      includeOnInvoice: p.includeOnInvoice,
    })),
  );

  const s = STATUS_BADGE[wo.status] ?? STATUS_BADGE.submitted;
  // Labor COST rates are financial data — only invoice-permission holders
  // (owner/admin/accountant) see or set them. PMs review hours/materials.
  const canEditRates = canCreate(role, 'invoices');
  // Invoice options: the linked project's invoices first; fall back to the
  // client's when no project is linked yet. Keeps the dropdown short.
  const invoiceOptions = invoices
    .filter((inv) =>
      wo.projectId
        ? inv.projectId === wo.projectId
        : wo.invoiceId
          ? inv.id === wo.invoiceId
          : false,
    )
    .map((inv) => ({
      id: inv.id,
      number: inv.number,
      projectId: inv.projectId,
      total: String(inv.total),
    }));

  return (
    <div className="p-8 space-y-5 max-w-5xl">
      <Link href={{ pathname: '/work-orders' }}>
        <Button variant="ghost" size="sm">
          ← Back to Work Orders
        </Button>
      </Link>

      <header className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold text-slate-900">{wo.number}</h1>
        <Badge tone={s.tone}>{s.label}</Badge>
        <p className="text-sm text-slate-500">
          Submitted by <span className="font-medium">{wo.employeeName}</span> ·
          work date {wo.workDate}
        </p>
      </header>

      <OfficeWorkOrderEditor
        workOrder={{
          id: wo.id,
          number: wo.number,
          status: wo.status,
          workDate: wo.workDate,
          employeeName: wo.employeeName,
          requestedBy: wo.requestedBy,
          repairsDone: wo.repairsDone,
          officeNotes: wo.officeNotes,
          customerId: wo.customerId,
          projectId: wo.projectId,
          projectName: wo.projectName,
          invoiceId: wo.invoiceId,
          labor: wo.labor.map((l) => ({
            employeeId: l.employeeId,
            hours: String(l.hours),
            // Never ship rate values to a viewer who can't see them — the
            // editor hides the column, but props serialize into the page
            // payload where dev tools could read them.
            rate: canEditRates ? String(l.rate) : '0',
          })),
          materials: wo.materials.map((m) => ({
            name: m.name,
            quantity: String(m.quantity),
            unit: m.unit,
            inventoryItemId: m.inventoryItemId,
          })),
        }}
        employees={employees
          .filter((e) => e.active)
          .map((e) => ({
            id: e.id,
            name: `${e.firstName} ${e.lastName}`.trim(),
            // Pay-rate placeholder hint for the rate input — hourly workers
            // only (a weekly salary would read as a bogus $/h figure), and
            // withheld from roles that can't see rates.
            payRate:
              canEditRates && e.employmentType === 'hourly'
                ? Number(e.payRate)
                : null,
          }))}
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        projects={projects
          // Keep CLOSED projects in the list — a service call is often
          // marked closed the day it's done, and the work order still needs
          // to book its labor there afterward. Only lost jobs drop out.
          .filter((p) => p.status !== 'lost')
          .map((p) => ({
            id: p.id,
            name: p.name,
            projectType: p.projectType,
          }))}
        invoices={invoiceOptions}
        products={inventoryItems.map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          sku: p.sku,
          unit: p.unit,
          defaultCost: Number(p.defaultCost),
        }))}
        photos={photoCards}
        canEditRates={canEditRates}
      />
    </div>
  );
}
