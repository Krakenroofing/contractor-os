// Data layer for field work orders (service calls): the crew submits them
// from the field app, the office reviews / invoices / posts them to job
// costing. See src/db/schema/work-orders.ts for the model.

import 'server-only';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  customers,
  employees,
  invoices,
  projects,
  workOrderLabor,
  workOrderMaterials,
  workOrders,
  type WorkOrder,
  type WorkOrderLabor,
  type WorkOrderMaterial,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/db';

export class WorkOrdersNotAvailableInDemoError extends Error {
  constructor() {
    super('Work orders require a configured database.');
    this.name = 'WorkOrdersNotAvailableInDemoError';
  }
}

function requireDb() {
  if (!isDatabaseConfigured()) throw new WorkOrdersNotAvailableInDemoError();
  return getDb()!;
}

export type WorkOrderListRow = WorkOrder & {
  employeeName: string;
  customerName: string | null;
  projectName: string | null;
  invoiceNumber: string | null;
};

export type WorkOrderLaborInput = {
  employeeId: string;
  hours: string;
  rate: string;
};

export type WorkOrderMaterialInput = {
  name: string;
  quantity: string;
  unit: string | null;
};

/** Next 'WO-N' for the company — max existing N + 1, so voids/deletes never
 *  cause a duplicate number. */
export async function getNextWorkOrderNumber(
  companyId: string,
): Promise<string> {
  const db = requireDb();
  const rows = await db
    .select({
      maxN: sql<string>`COALESCE(MAX(NULLIF(regexp_replace(${workOrders.number}, '\\D', '', 'g'), '')::int), 0)`,
    })
    .from(workOrders)
    .where(eq(workOrders.companyId, companyId));
  return `WO-${Number(rows[0]?.maxN ?? 0) + 1}`;
}

export async function createWorkOrder(input: {
  companyId: string;
  number: string;
  workDate: string;
  createdByEmployeeId: string;
  createdByUserId: string | null;
  requestedBy: string | null;
  repairsDone: string | null;
  labor: WorkOrderLaborInput[];
  materials: WorkOrderMaterialInput[];
}): Promise<WorkOrder> {
  const db = requireDb();
  return await db.transaction(async (tx) => {
    const [wo] = await tx
      .insert(workOrders)
      .values({
        companyId: input.companyId,
        number: input.number,
        workDate: input.workDate,
        createdByEmployeeId: input.createdByEmployeeId,
        createdByUserId: input.createdByUserId,
        requestedBy: input.requestedBy,
        repairsDone: input.repairsDone,
      })
      .returning();
    if (input.labor.length > 0) {
      await tx.insert(workOrderLabor).values(
        input.labor.map((l, i) => ({
          companyId: input.companyId,
          workOrderId: wo.id,
          employeeId: l.employeeId,
          hours: l.hours,
          rate: l.rate,
          sortOrder: i,
        })),
      );
    }
    if (input.materials.length > 0) {
      await tx.insert(workOrderMaterials).values(
        input.materials.map((m, i) => ({
          companyId: input.companyId,
          workOrderId: wo.id,
          name: m.name,
          quantity: m.quantity,
          unit: m.unit,
          sortOrder: i,
        })),
      );
    }
    return wo;
  });
}

export async function listWorkOrders(
  companyId: string,
  filter: {
    status?: 'submitted' | 'posted' | 'void';
    createdByEmployeeId?: string;
  } = {},
): Promise<WorkOrderListRow[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getDb()!;
  const conds = [
    eq(workOrders.companyId, companyId),
    isNull(workOrders.deletedAt),
  ];
  if (filter.status) conds.push(eq(workOrders.status, filter.status));
  if (filter.createdByEmployeeId) {
    conds.push(eq(workOrders.createdByEmployeeId, filter.createdByEmployeeId));
  }
  const rows = await db
    .select({
      wo: workOrders,
      firstName: employees.firstName,
      lastName: employees.lastName,
      customerName: customers.name,
      projectName: projects.name,
      invoiceNumber: invoices.number,
    })
    .from(workOrders)
    .innerJoin(employees, eq(employees.id, workOrders.createdByEmployeeId))
    .leftJoin(customers, eq(customers.id, workOrders.customerId))
    .leftJoin(projects, eq(projects.id, workOrders.projectId))
    .leftJoin(invoices, eq(invoices.id, workOrders.invoiceId))
    .where(and(...conds))
    .orderBy(desc(workOrders.workDate), desc(workOrders.createdAt));
  return rows.map((r) => ({
    ...r.wo,
    employeeName: `${r.firstName} ${r.lastName}`.trim(),
    customerName: r.customerName,
    projectName: r.projectName,
    invoiceNumber: r.invoiceNumber,
  }));
}

export type WorkOrderWithDetails = WorkOrderListRow & {
  labor: Array<WorkOrderLabor & { employeeName: string }>;
  materials: WorkOrderMaterial[];
};

export async function getWorkOrderWithDetails(
  companyId: string,
  id: string,
): Promise<WorkOrderWithDetails | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const db = getDb()!;
  const rows = await db
    .select({
      wo: workOrders,
      firstName: employees.firstName,
      lastName: employees.lastName,
      customerName: customers.name,
      projectName: projects.name,
      invoiceNumber: invoices.number,
    })
    .from(workOrders)
    .innerJoin(employees, eq(employees.id, workOrders.createdByEmployeeId))
    .leftJoin(customers, eq(customers.id, workOrders.customerId))
    .leftJoin(projects, eq(projects.id, workOrders.projectId))
    .leftJoin(invoices, eq(invoices.id, workOrders.invoiceId))
    .where(
      and(
        eq(workOrders.id, id),
        eq(workOrders.companyId, companyId),
        isNull(workOrders.deletedAt),
      ),
    )
    .limit(1);
  const r = rows[0];
  if (!r) return undefined;
  const [labor, materials] = await Promise.all([
    db
      .select({
        line: workOrderLabor,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(workOrderLabor)
      .innerJoin(employees, eq(employees.id, workOrderLabor.employeeId))
      .where(eq(workOrderLabor.workOrderId, id))
      .orderBy(asc(workOrderLabor.sortOrder)),
    db
      .select()
      .from(workOrderMaterials)
      .where(eq(workOrderMaterials.workOrderId, id))
      .orderBy(asc(workOrderMaterials.sortOrder)),
  ]);
  return {
    ...r.wo,
    employeeName: `${r.firstName} ${r.lastName}`.trim(),
    customerName: r.customerName,
    projectName: r.projectName,
    invoiceNumber: r.invoiceNumber,
    labor: labor.map((l) => ({
      ...l.line,
      employeeName: `${l.firstName} ${l.lastName}`.trim(),
    })),
    materials,
  };
}

export async function updateWorkOrder(
  companyId: string,
  id: string,
  patch: Partial<{
    workDate: string;
    requestedBy: string | null;
    repairsDone: string | null;
    officeNotes: string | null;
    customerId: string | null;
    projectId: string | null;
    invoiceId: string | null;
    status: 'submitted' | 'posted' | 'void';
    postedAt: Date | null;
    postedByUserId: string | null;
  }>,
): Promise<WorkOrder | undefined> {
  const db = requireDb();
  const rows = await db
    .update(workOrders)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(workOrders.id, id),
        eq(workOrders.companyId, companyId),
        isNull(workOrders.deletedAt),
      ),
    )
    .returning();
  return rows[0];
}

/** Replace the labor + material lines wholesale (office edit). */
export async function replaceWorkOrderLines(
  companyId: string,
  workOrderId: string,
  labor: WorkOrderLaborInput[],
  materials: WorkOrderMaterialInput[],
): Promise<void> {
  const db = requireDb();
  await db.transaction(async (tx) => {
    await tx
      .delete(workOrderLabor)
      .where(
        and(
          eq(workOrderLabor.companyId, companyId),
          eq(workOrderLabor.workOrderId, workOrderId),
        ),
      );
    await tx
      .delete(workOrderMaterials)
      .where(
        and(
          eq(workOrderMaterials.companyId, companyId),
          eq(workOrderMaterials.workOrderId, workOrderId),
        ),
      );
    if (labor.length > 0) {
      await tx.insert(workOrderLabor).values(
        labor.map((l, i) => ({
          companyId,
          workOrderId,
          employeeId: l.employeeId,
          hours: l.hours,
          rate: l.rate,
          sortOrder: i,
        })),
      );
    }
    if (materials.length > 0) {
      await tx.insert(workOrderMaterials).values(
        materials.map((m, i) => ({
          companyId,
          workOrderId,
          name: m.name,
          quantity: m.quantity,
          unit: m.unit,
          sortOrder: i,
        })),
      );
    }
  });
}
