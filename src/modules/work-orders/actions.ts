'use server';

// Field work orders (service calls): field submit + office review / post.
// Posting stamps a (service) project and writes the call's labor to
// job_cost_entries (source 'work_order', source_ref_id = the work order id)
// so job costing and the P&L labor split treat it like posted labor.
// Unposting soft-deletes those entries and reopens the work order.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveEmployee } from '@/lib/active-employee';
import { getActiveRole } from '@/lib/active-role';
import { requireAuth } from '@/lib/auth';
import { canCreate } from '@/lib/permissions';
import { round2 } from '@/lib/money';
import { getCompany } from '@/lib/data/companies';
import { listEmployees } from '@/lib/data/employees';
import { getUserNamesByIds } from '@/lib/data/users';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import {
  createJobCostEntry,
  softDeleteJobCostEntriesBySource,
} from '@/lib/data/job-cost-entries';
import { createProject, getProject } from '@/lib/data/projects';
import {
  linkTimeEntriesToWorkOrder,
  unlinkTimeEntriesFromWorkOrder,
} from '@/lib/data/time-entries';
import {
  createWorkOrder,
  deleteWorkOrderPhotoRow,
  getNextWorkOrderNumber,
  getWorkOrderPhoto,
  getWorkOrderWithDetails,
  insertWorkOrderPhoto,
  listWorkOrders,
  replaceWorkOrderLines,
  setWorkOrderPhotoInvoiceFlag,
  updateWorkOrder,
  type WorkOrderLaborInput,
  type WorkOrderMaterialInput,
} from '@/lib/data/work-orders';
import {
  ALLOWED_PHOTO_MIME,
  MAX_PHOTO_BYTES,
  deleteDailyReportPhotoBlob,
  uploadWorkOrderPhoto,
} from '@/lib/storage/daily-report-photos';

export type WorkOrderActionResult = {
  ok?: boolean;
  error?: string;
  /** The created work order's number (field submit). */
  number?: string;
  id?: string;
};

const idSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const laborRowSchema = z.object({
  employeeId: z.string().uuid(),
  hours: z.coerce.number().min(0).max(200),
  // Office-only; the field form never sends it (rate is defaulted from the
  // employee's pay rate server-side).
  rate: z.coerce.number().min(0).optional(),
});
const materialRowSchema = z.object({
  name: z.string().trim().min(1).max(300),
  quantity: z.coerce.number().min(0).max(1_000_000),
  unit: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : null)),
  // Catalog product picked at office review (field submissions omit it).
  inventoryItemId: z
    .union([z.string().uuid(), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v && v !== '' ? v : null)),
});

function revalidateWorkOrders(id?: string) {
  revalidatePath('/dashboard');
  revalidatePath('/work-orders');
  if (id) revalidatePath(`/work-orders/${id}`);
  revalidatePath('/field/work-orders');
}

// ===== Field: submit a work order =====

export async function submitWorkOrderAction(input: {
  workDate: string;
  requestedBy: string;
  repairsDone: string;
  labor: Array<{ employeeId: string; hours: number }>;
  materials: Array<{ name: string; quantity: number; unit?: string }>;
}): Promise<WorkOrderActionResult> {
  const user = await requireAuth();
  const employee = await getActiveEmployee();
  if (!employee) {
    return {
      error:
        'Your account has no linked employee record — ask the office to link it on the Invite Users page.',
    };
  }
  const parsed = z
    .object({
      workDate: dateSchema,
      requestedBy: z.string().trim().max(500),
      repairsDone: z.string().trim().max(5000),
      labor: z.array(laborRowSchema).min(1).max(30),
      materials: z.array(materialRowSchema).max(60),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { error: 'Check the form — a field is missing or invalid.' };
  }
  const data = parsed.data;
  if (!data.labor.some((l) => l.employeeId === employee.id)) {
    return { error: 'Your own line is missing from the crew list.' };
  }

  const companyId = await getActiveCompanyId();
  // Work orders carry HOURS only from the field — labor cost rates are
  // financial data and are plugged in by the owner/admin on the review
  // screen (invoice-permission holders), so every line starts at 0.
  const employees = await listEmployees(companyId);
  const empById = new Map(employees.map((e) => [e.id, e]));
  const labor: WorkOrderLaborInput[] = [];
  for (const l of data.labor) {
    const emp = empById.get(l.employeeId);
    if (!emp) return { error: 'One of the crew members was not found.' };
    labor.push({
      employeeId: l.employeeId,
      hours: l.hours.toFixed(2),
      rate: '0.0000',
    });
  }
  const materials: WorkOrderMaterialInput[] = data.materials
    .filter((m) => m.name)
    .map((m) => ({
      name: m.name,
      quantity: m.quantity.toFixed(2),
      unit: m.unit ?? null,
    }));

  const knownUsers = await getUserNamesByIds([user.id]);
  try {
    const number = await getNextWorkOrderNumber(companyId);
    const wo = await createWorkOrder({
      companyId,
      number,
      workDate: data.workDate,
      createdByEmployeeId: employee.id,
      createdByUserId: knownUsers.has(user.id) ? user.id : null,
      requestedBy: data.requestedBy || null,
      repairsDone: data.repairsDone || null,
      labor,
      materials,
    });
    revalidateWorkOrders(wo.id);
    return { ok: true, number: wo.number, id: wo.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Failed to submit the work order: ${message}` };
  }
}

// ===== Office: create a work order directly =====
// For calls that come in by phone or get reported verbally — same shape as
// a field submission, but the office picks who ran the call (the first
// crew line) and can stamp the client right away. Lands as 'submitted'
// so the normal review → post flow continues on the detail page.

export async function createWorkOrderOfficeAction(input: {
  workDate: string;
  requestedBy: string;
  repairsDone: string;
  customerId: string;
  labor: Array<{ employeeId: string; hours: number }>;
  materials: Array<{ name: string; quantity: number; unit?: string }>;
}): Promise<WorkOrderActionResult> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) {
    return { error: 'You do not have permission to create work orders.' };
  }
  const parsed = z
    .object({
      workDate: dateSchema,
      requestedBy: z.string().trim().max(500),
      repairsDone: z.string().trim().max(5000),
      customerId: z.union([z.string().uuid(), z.literal('')]),
      labor: z.array(laborRowSchema).min(1).max(30),
      materials: z.array(materialRowSchema).max(60),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { error: 'Check the form — a field is missing or invalid.' };
  }
  const data = parsed.data;

  const companyId = await getActiveCompanyId();
  const employees = await listEmployees(companyId);
  const empById = new Map(employees.map((e) => [e.id, e]));
  const labor: WorkOrderLaborInput[] = [];
  for (const l of data.labor) {
    const emp = empById.get(l.employeeId);
    if (!emp) return { error: 'One of the crew members was not found.' };
    // Rates start at 0 even on office creation — they get plugged in on
    // the review screen by an invoice-permission holder before posting.
    labor.push({
      employeeId: l.employeeId,
      hours: l.hours.toFixed(2),
      rate: '0.0000',
    });
  }
  const materials: WorkOrderMaterialInput[] = data.materials
    .filter((m) => m.name)
    .map((m) => ({
      name: m.name,
      quantity: m.quantity.toFixed(2),
      unit: m.unit ?? null,
    }));

  const knownUsers = await getUserNamesByIds([user.id]);
  try {
    const number = await getNextWorkOrderNumber(companyId);
    const wo = await createWorkOrder({
      companyId,
      number,
      workDate: data.workDate,
      // The first crew line is who ran the call.
      createdByEmployeeId: labor[0].employeeId,
      createdByUserId: knownUsers.has(user.id) ? user.id : null,
      requestedBy: data.requestedBy || null,
      repairsDone: data.repairsDone || null,
      labor,
      materials,
    });
    if (data.customerId) {
      await updateWorkOrder(companyId, wo.id, {
        customerId: data.customerId,
      });
    }
    revalidateWorkOrders(wo.id);
    return { ok: true, number: wo.number, id: wo.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Failed to create the work order: ${message}` };
  }
}

// ===== Office: edit a submitted work order =====

export async function updateWorkOrderOfficeAction(input: {
  id: string;
  workDate: string;
  requestedBy: string;
  repairsDone: string;
  officeNotes: string;
  customerId: string;
  labor: Array<{ employeeId: string; hours: number; rate: number }>;
  materials: Array<{
    name: string;
    quantity: number;
    unit?: string;
    inventoryItemId?: string | null;
  }>;
}): Promise<WorkOrderActionResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) {
    return { error: 'You do not have permission to edit work orders.' };
  }
  const id = idSchema.safeParse(input.id);
  if (!id.success) return { error: 'Missing work order id.' };
  const parsed = z
    .object({
      workDate: dateSchema,
      requestedBy: z.string().trim().max(500),
      repairsDone: z.string().trim().max(5000),
      officeNotes: z.string().trim().max(5000),
      customerId: z.union([z.string().uuid(), z.literal('')]),
      labor: z
        .array(laborRowSchema.extend({ rate: z.coerce.number().min(0) }))
        .min(1)
        .max(30),
      materials: z.array(materialRowSchema).max(60),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { error: 'Check the form — a field is missing or invalid.' };
  }
  const data = parsed.data;
  const companyId = await getActiveCompanyId();
  const wo = await getWorkOrderWithDetails(companyId, id.data);
  if (!wo) return { error: 'Work order not found.' };
  if (wo.status === 'posted') {
    return {
      error: 'This work order is posted — unpost it before editing.',
    };
  }
  // Labor COST rates are restricted to invoice-permission holders (owner /
  // admin / accountant). Anyone else saving keeps each employee's existing
  // rate (new crew lines start at 0) — the client's rate values are ignored.
  const canSetRates = canCreate(role, 'invoices');
  const existingRateByEmployee = new Map(
    wo.labor.map((l) => [l.employeeId, Number(l.rate)]),
  );
  try {
    await replaceWorkOrderLines(
      companyId,
      id.data,
      data.labor.map((l) => ({
        employeeId: l.employeeId,
        hours: l.hours.toFixed(2),
        rate: (canSetRates
          ? l.rate
          : (existingRateByEmployee.get(l.employeeId) ?? 0)
        ).toFixed(4),
      })),
      data.materials
        .filter((m) => m.name)
        .map((m) => ({
          name: m.name,
          quantity: m.quantity.toFixed(2),
          unit: m.unit ?? null,
          inventoryItemId: m.inventoryItemId ?? null,
        })),
    );
    await updateWorkOrder(companyId, id.data, {
      workDate: data.workDate,
      requestedBy: data.requestedBy || null,
      repairsDone: data.repairsDone || null,
      officeNotes: data.officeNotes || null,
      customerId: data.customerId || null,
    });
    revalidateWorkOrders(id.data);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Failed to save the work order: ${message}` };
  }
}

// ===== Office: post to job costing =====

export async function postWorkOrderAction(input: {
  id: string;
  /** Existing project to book to; empty → create a new service job. */
  projectId: string;
}): Promise<WorkOrderActionResult> {
  const user = await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) {
    return { error: 'You do not have permission to post work orders.' };
  }
  const id = idSchema.safeParse(input.id);
  if (!id.success) return { error: 'Missing work order id.' };
  const companyId = await getActiveCompanyId();
  const wo = await getWorkOrderWithDetails(companyId, id.data);
  if (!wo) return { error: 'Work order not found.' };
  if (wo.status !== 'submitted') {
    return { error: 'Only a submitted work order can be posted.' };
  }
  if (!wo.customerId) {
    return {
      error:
        'Record the client first — pick (or add) the customer, save, then post.',
    };
  }
  // Rates are entered by the owner/admin at review — refuse to post while
  // any worked line is still missing its labor cost rate (it would silently
  // book $0 for that person's time).
  const missingRates = wo.labor.filter(
    (l) => Number(l.hours) > 0 && Number(l.rate) <= 0,
  );
  if (missingRates.length > 0) {
    return {
      error: `Enter the labor cost rate for ${missingRates
        .map((l) => l.employeeName)
        .join(', ')} before posting — rates are set here at review (admin only), then the labor books to job costing.`,
    };
  }
  const company = await getCompany(companyId);
  if (!company) return { error: 'Active company not found.' };
  const laborAcct = company.laborCogsAccountId;
  if (!laborAcct) {
    return {
      error:
        'Set the direct-labor account under Settings → Accounting first.',
    };
  }

  // Resolve the project: link an existing one, or create a service job
  // named after the call.
  let projectId = input.projectId || '';
  if (projectId) {
    const existing = await getProject(companyId, projectId);
    if (!existing) return { error: 'Selected project not found.' };
  } else {
    const project = await createProject(companyId, {
      customerId: wo.customerId,
      name: `Service — ${wo.customerName ?? 'client'} (${wo.number})`,
      status: 'in_progress',
      projectType: 'service',
      jobsiteAddressLine1: null,
      jobsiteAddressLine2: null,
      jobsiteCity: null,
      jobsiteState: null,
      jobsitePostalCode: null,
      projectManagerId: null,
      estimatorId: null,
      startDate: wo.workDate,
      targetCompletionDate: null,
      actualCompletionDate: null,
      contractValue: '0',
      originalContractValue: '0',
      totalChangeOrders: '0',
      currentBudget: '0',
      notes: wo.repairsDone
        ? `Work order ${wo.number} — ${wo.repairsDone}`
        : `Work order ${wo.number}`,
      tmLaborBillRate: null,
      tmMaterialMarkupPct: null,
      defaultLaborCostCodeId: null,
    });
    projectId = project.id;
  }
  const project = (await getProject(companyId, projectId))!;
  const costCodeId =
    project.defaultLaborCostCodeId ?? company.defaultLaborCostCodeId;
  if (!costCodeId) {
    return {
      error:
        'No default labor cost code — set one on the project or under Settings → Accounting.',
    };
  }

  const employees = await listEmployees(companyId);
  const empById = new Map(employees.map((e) => [e.id, e]));
  const allAccounts = await listAccountingAccounts(companyId);
  const subcontractorAcct =
    allAccounts.find(
      (acc) =>
        !acc.isArchived && acc.name.trim().toLowerCase() === 'subcontractors',
    )?.id ?? laborAcct;

  const knownUsers = await getUserNamesByIds([user.id]);
  const createdBy = knownUsers.has(user.id) ? user.id : null;
  try {
    // Re-posting safety: clear any prior entries for this WO first (a
    // previous post that failed halfway, or an unpost that raced).
    await softDeleteJobCostEntriesBySource(companyId, 'work_order', id.data);
    let posted = 0;
    for (const l of wo.labor) {
      const amount = round2(Number(l.hours) * Number(l.rate));
      if (amount < 0.005) continue;
      const emp = empById.get(l.employeeId);
      const isSub = emp?.isSubcontractor === true;
      const empName =
        (l as { employeeName?: string }).employeeName ??
        `${emp?.firstName ?? ''} ${emp?.lastName ?? ''}`.trim();
      await createJobCostEntry({
        companyId,
        projectId,
        costCodeId,
        accountingAccountId: isSub ? subcontractorAcct : laborAcct,
        source: 'work_order',
        sourceRefId: id.data,
        costType: isSub ? 'subcontractor' : 'labor',
        entryDate: wo.workDate,
        vendorId: null,
        // No rate in the description — job-costing viewers (PMs) shouldn't
        // read per-person rates off the entry text. Hours + amount columns
        // carry the numbers for those allowed to see them.
        description: `Service call ${wo.number} — ${empName} (${Number(l.hours).toFixed(2)}h)`,
        quantity: Number(l.hours).toFixed(2),
        unitCost: Number(l.rate).toFixed(4),
        amount: amount.toFixed(2),
        isBillable: true,
        markupPercent: null,
        burdenPercent: null,
        vendorInvoiceNumber: null,
        attachmentUrl: null,
        notes: null,
        createdByUserId: createdBy,
      });
      posted += 1;
    }
    await updateWorkOrder(companyId, id.data, {
      status: 'posted',
      projectId,
      postedAt: new Date(),
      postedByUserId: createdBy,
    });
    // Claim the crew's matching clocked hours (jobless entries on the
    // call's date): they show as linked on the timesheet and stay off
    // payroll's job-cost posting — this WO carries the cost, so the same
    // hours never book twice.
    await linkTimeEntriesToWorkOrder(
      companyId,
      id.data,
      wo.labor
        .filter((l) => Number(l.hours) > 0)
        .map((l) => ({ employeeId: l.employeeId, workDate: wo.workDate })),
    );
    revalidateWorkOrders(id.data);
    revalidatePath('/job-costing');
    revalidatePath('/reports/profit-loss', 'layout');
    return { ok: true, id: projectId, number: String(posted) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Failed to post the work order: ${message}` };
  }
}

// ===== Office: unpost (fix something) =====

export async function unpostWorkOrderAction(
  workOrderId: string,
): Promise<WorkOrderActionResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) {
    return { error: 'You do not have permission to unpost work orders.' };
  }
  const id = idSchema.safeParse(workOrderId);
  if (!id.success) return { error: 'Missing work order id.' };
  const companyId = await getActiveCompanyId();
  const wo = await getWorkOrderWithDetails(companyId, id.data);
  if (!wo) return { error: 'Work order not found.' };
  if (wo.status !== 'posted') {
    return { error: 'This work order is not posted.' };
  }
  try {
    await softDeleteJobCostEntriesBySource(companyId, 'work_order', id.data);
    await unlinkTimeEntriesFromWorkOrder(companyId, id.data);
    await updateWorkOrder(companyId, id.data, {
      status: 'submitted',
      postedAt: null,
      postedByUserId: null,
    });
    revalidateWorkOrders(id.data);
    revalidatePath('/job-costing');
    revalidatePath('/reports/profit-loss', 'layout');
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Failed to unpost: ${message}` };
  }
}

// ===== Office: void =====

export async function voidWorkOrderAction(
  workOrderId: string,
): Promise<WorkOrderActionResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) {
    return { error: 'You do not have permission to void work orders.' };
  }
  const id = idSchema.safeParse(workOrderId);
  if (!id.success) return { error: 'Missing work order id.' };
  const companyId = await getActiveCompanyId();
  const wo = await getWorkOrderWithDetails(companyId, id.data);
  if (!wo) return { error: 'Work order not found.' };
  if (wo.status === 'posted') {
    return { error: 'Unpost the work order before voiding it.' };
  }
  await updateWorkOrder(companyId, id.data, { status: 'void' });
  revalidateWorkOrders(id.data);
  return { ok: true };
}

// ===== Office: link the invoice that bills this call =====

export async function linkWorkOrderInvoiceAction(input: {
  id: string;
  invoiceId: string;
}): Promise<WorkOrderActionResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) {
    return { error: 'You do not have permission to edit work orders.' };
  }
  const id = idSchema.safeParse(input.id);
  if (!id.success) return { error: 'Missing work order id.' };
  const invoiceId = input.invoiceId
    ? idSchema.safeParse(input.invoiceId)
    : null;
  if (invoiceId && !invoiceId.success) return { error: 'Invalid invoice.' };
  const companyId = await getActiveCompanyId();
  await updateWorkOrder(companyId, id.data, {
    invoiceId: invoiceId ? invoiceId.data : null,
  });
  revalidateWorkOrders(id.data);
  return { ok: true };
}

// ===== Photos =====
// The crew attaches job photos when submitting (or right after) from the
// field; the office can add more at review. Uploading needs either the
// creator's own employee link or office (projects) permissions.

async function canTouchWorkOrderPhotos(
  companyId: string,
  workOrderId: string,
): Promise<{ ok: boolean; error?: string }> {
  const role = await getActiveRole();
  if (canCreate(role, 'projects')) return { ok: true };
  const employee = await getActiveEmployee();
  if (!employee) {
    return { ok: false, error: 'No permission to change these photos.' };
  }
  const wo = await getWorkOrderWithDetails(companyId, workOrderId);
  if (!wo) return { ok: false, error: 'Work order not found.' };
  if (wo.createdByEmployeeId !== employee.id) {
    return {
      ok: false,
      error: 'Only the crew member who submitted this call can add photos.',
    };
  }
  if (wo.status !== 'submitted') {
    return {
      ok: false,
      error: 'This work order is closed — ask the office to add photos.',
    };
  }
  return { ok: true };
}

export async function uploadWorkOrderPhotoAction(
  workOrderId: string,
  formData: FormData,
): Promise<WorkOrderActionResult> {
  const user = await requireAuth();
  const id = idSchema.safeParse(workOrderId);
  if (!id.success) return { error: 'Missing work order id.' };
  const companyId = await getActiveCompanyId();
  const allowed = await canTouchWorkOrderPhotos(companyId, id.data);
  if (!allowed.ok) return { error: allowed.error };

  const file = formData.get('photo');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a photo to upload.' };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return {
      error: `Photo is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max is ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)}MB.`,
    };
  }
  const mime = (file.type || '').toLowerCase();
  if (!ALLOWED_PHOTO_MIME.has(mime)) {
    return {
      error: `Unsupported file type: ${file.type || 'unknown'}. Use JPG, PNG, WebP, or HEIC.`,
    };
  }
  const caption = (formData.get('caption') ?? '').toString().slice(0, 500);
  const knownUsers = await getUserNamesByIds([user.id]);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const upload = await uploadWorkOrderPhoto({
      companyId,
      workOrderId: id.data,
      bytes,
      mimeType: mime,
    });
    await insertWorkOrderPhoto({
      companyId,
      workOrderId: id.data,
      storagePath: upload.storagePath,
      fileName: file.name || null,
      mimeType: mime,
      byteSize: file.size,
      caption: caption || null,
      uploadedBy: knownUsers.has(user.id) ? user.id : null,
    });
    revalidateWorkOrders(id.data);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Photo upload failed: ${message}` };
  }
}

export async function deleteWorkOrderPhotoAction(
  photoId: string,
): Promise<WorkOrderActionResult> {
  await requireAuth();
  const id = idSchema.safeParse(photoId);
  if (!id.success) return { error: 'Missing photo id.' };
  const companyId = await getActiveCompanyId();
  const photo = await getWorkOrderPhoto(companyId, id.data);
  if (!photo) return { error: 'Photo not found.' };
  const allowed = await canTouchWorkOrderPhotos(companyId, photo.workOrderId);
  if (!allowed.ok) return { error: allowed.error };
  try {
    await deleteWorkOrderPhotoRow(companyId, id.data);
    await deleteDailyReportPhotoBlob(photo.storagePath);
    revalidateWorkOrders(photo.workOrderId);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Failed to delete the photo: ${message}` };
  }
}

/** Office-only: flag whether a photo renders on the client's invoice. */
export async function toggleWorkOrderPhotoInvoiceAction(input: {
  photoId: string;
  include: boolean;
}): Promise<WorkOrderActionResult> {
  await requireAuth();
  const role = await getActiveRole();
  if (!canCreate(role, 'projects')) {
    return { error: 'You do not have permission to change invoice photos.' };
  }
  const id = idSchema.safeParse(input.photoId);
  if (!id.success) return { error: 'Missing photo id.' };
  const companyId = await getActiveCompanyId();
  const updated = await setWorkOrderPhotoInvoiceFlag(
    companyId,
    id.data,
    Boolean(input.include),
  );
  if (!updated) return { error: 'Photo not found.' };
  revalidateWorkOrders(updated.workOrderId);
  return { ok: true };
}

/** Dashboard/list helper re-exported through a server boundary. */
export async function listWorkOrdersForActiveCompany(filter?: {
  status?: 'submitted' | 'posted' | 'void';
}) {
  await requireAuth();
  const companyId = await getActiveCompanyId();
  return listWorkOrders(companyId, filter);
}
