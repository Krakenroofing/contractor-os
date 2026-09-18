'use client';

// Office review editor for a field-submitted work order. Chris's flow:
// review the call → fix anything → record the client → save → POST (books
// the labor to job costing on a service project, creating one if needed)
// → invoice the client and link the invoice back here.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatMoney } from '@/lib/money';
import {
  CustomerPicker,
  type CustomerPickerOption,
} from '@/modules/customers/components/customer-picker';
import {
  ProductPicker,
  type ProductPickerOption,
} from '@/modules/inventory/components/product-picker';
import { downscalePhotoForUpload } from '@/lib/images/downscale-photo';
import {
  deleteWorkOrderPhotoAction,
  linkWorkOrderInvoiceAction,
  postWorkOrderAction,
  toggleWorkOrderPhotoInvoiceAction,
  unpostWorkOrderAction,
  updateWorkOrderOfficeAction,
  uploadWorkOrderPhotoAction,
  voidWorkOrderAction,
} from '../actions';

type EmployeeOption = {
  id: string;
  name: string;
  /** Pay rate hint for the rate placeholder — only provided to
   *  invoice-permission holders (rates are financial data). */
  payRate?: number | null;
};
type ProjectOption = { id: string; name: string; projectType: string };
type InvoiceOption = {
  id: string;
  number: string;
  projectId: string | null;
  total: string;
};

type LaborRow = { employeeId: string; hoursText: string; rateText: string };
type MaterialRow = {
  name: string;
  qtyText: string;
  unit: string;
  /** Catalog product mapped at review ('' = free text from the crew). */
  inventoryItemId: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function OfficeWorkOrderEditor({
  workOrder,
  employees,
  customers,
  projects,
  invoices,
  products,
  photos,
  canEditRates,
}: {
  workOrder: {
    id: string;
    number: string;
    status: string;
    workDate: string;
    employeeName: string;
    requestedBy: string | null;
    repairsDone: string | null;
    officeNotes: string | null;
    customerId: string | null;
    projectId: string | null;
    projectName: string | null;
    invoiceId: string | null;
    labor: Array<{ employeeId: string; hours: string; rate: string }>;
    materials: Array<{
      name: string;
      quantity: string;
      unit: string | null;
      inventoryItemId: string | null;
    }>;
  };
  employees: EmployeeOption[];
  customers: CustomerPickerOption[];
  projects: ProjectOption[];
  invoices: InvoiceOption[];
  /** Inventory catalog for the material picker (with inline quick-add). */
  products: ProductPickerOption[];
  /** Job photos with fresh signed URLs (private bucket). */
  photos: Array<{
    id: string;
    url: string | null;
    caption: string | null;
    includeOnInvoice: boolean;
  }>;
  /** Only owner/admin/accountant (invoice permissions) see and set labor
   *  COST rates — the work order itself carries hours + materials. */
  canEditRates: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isPosted = workOrder.status === 'posted';
  const isVoid = workOrder.status === 'void';
  const locked = isPosted || isVoid;

  const [workDate, setWorkDate] = useState(workOrder.workDate);
  const [requestedBy, setRequestedBy] = useState(workOrder.requestedBy ?? '');
  const [repairsDone, setRepairsDone] = useState(workOrder.repairsDone ?? '');
  const [officeNotes, setOfficeNotes] = useState(workOrder.officeNotes ?? '');
  const [customerId, setCustomerId] = useState(workOrder.customerId ?? '');
  const [labor, setLabor] = useState<LaborRow[]>(
    workOrder.labor.map((l) => ({
      employeeId: l.employeeId,
      hoursText: Number(l.hours).toFixed(2),
      // Unset rates render empty so the pay-rate placeholder hint shows.
      rateText: Number(l.rate) > 0 ? Number(l.rate).toFixed(2) : '',
    })),
  );
  const [materials, setMaterials] = useState<MaterialRow[]>(
    workOrder.materials.map((m) => ({
      name: m.name,
      qtyText: Number(m.quantity).toFixed(2),
      unit: m.unit ?? '',
      inventoryItemId: m.inventoryItemId ?? '',
    })),
  );
  const [postProjectId, setPostProjectId] = useState(workOrder.projectId ?? '');
  const [invoiceId, setInvoiceId] = useState(workOrder.invoiceId ?? '');

  const laborTotal = r2(
    labor.reduce(
      (s, l) => s + (Number(l.hoursText) || 0) * (Number(l.rateText) || 0),
      0,
    ),
  );

  function run(fn: () => Promise<{ ok?: boolean; error?: string }>, okMsg: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong.');
        return;
      }
      setNotice(okMsg);
      router.refresh();
    });
  }

  const savePayload = () => ({
    id: workOrder.id,
    workDate,
    requestedBy,
    repairsDone,
    officeNotes,
    customerId,
    labor: labor
      .filter((l) => l.employeeId)
      .map((l) => ({
        employeeId: l.employeeId,
        hours: Number(l.hoursText) || 0,
        rate: Number(l.rateText) || 0,
      })),
    materials: materials
      .filter((m) => m.name.trim())
      .map((m) => ({
        name: m.name.trim(),
        quantity: Number(m.qtyText) || 1,
        unit: m.unit.trim() || undefined,
        inventoryItemId: m.inventoryItemId || null,
      })),
  });

  const save = () =>
    run(() => updateWorkOrderOfficeAction(savePayload()), 'Saved.');

  // Post SAVES the current form first — rates typed into the grid used to
  // be silently ignored unless the operator pressed Save before Post,
  // which read as "it keeps saying to enter rates yet they are entered."
  const saveThenPost = () =>
    run(async () => {
      const saved = await updateWorkOrderOfficeAction(savePayload());
      if (!saved.ok) return saved;
      return postWorkOrderAction({
        id: workOrder.id,
        projectId: postProjectId,
      });
    }, 'Posted — labor is in job costing.');

  return (
    <div className="space-y-4">
      {notice && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Call details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Work date
          </label>
          <Input
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
            disabled={locked}
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Requested by (from the field)
          </label>
          <Input
            value={requestedBy}
            onChange={(e) => setRequestedBy(e.target.value)}
            disabled={locked}
            placeholder="Who called it in"
          />
        </div>
      </div>

      {/* Client */}
      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
        <label className="block text-xs font-medium text-blue-900 mb-1">
          Client (record before posting)
        </label>
        <div className="max-w-md">
          <CustomerPicker
            value={customerId}
            onChange={(id) => setCustomerId(id)}
            customers={customers}
            disabled={locked}
            noneLabel="— pick the client —"
          />
        </div>
      </div>

      {/* Crew + hours; cost rates only for invoice-permission holders */}
      <div className="rounded-lg border border-slate-200 p-3 space-y-2">
        <p className="text-sm font-medium text-slate-800">
          Crew on the call
          {canEditRates && <> · labor cost {formatMoney(laborTotal)}</>}
        </p>
        {labor.map((l, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <div className="w-64">
              <Select
                value={l.employeeId}
                onChange={(e) =>
                  setLabor((prev) =>
                    prev.map((r, idx) =>
                      idx === i ? { ...r, employeeId: e.target.value } : r,
                    ),
                  )
                }
                disabled={locked}
              >
                <option value="">— employee —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            </div>
            <Input
              value={l.hoursText}
              onChange={(e) =>
                setLabor((prev) =>
                  prev.map((r, idx) =>
                    idx === i ? { ...r, hoursText: e.target.value } : r,
                  ),
                )
              }
              disabled={locked}
              inputMode="decimal"
              className="h-9 w-20 text-right tabular-nums"
              placeholder="hrs"
            />
            {canEditRates && (
              <>
                <span className="text-xs text-slate-500">h ×</span>
                <Input
                  value={l.rateText}
                  onChange={(e) =>
                    setLabor((prev) =>
                      prev.map((r, idx) =>
                        idx === i ? { ...r, rateText: e.target.value } : r,
                      ),
                    )
                  }
                  disabled={locked}
                  inputMode="decimal"
                  className="h-9 w-24 text-right tabular-nums"
                  placeholder={(() => {
                    const pr = employees.find(
                      (e) => e.id === l.employeeId,
                    )?.payRate;
                    return pr && pr > 0 ? `pay ${pr.toFixed(2)}` : 'cost $/h';
                  })()}
                />
                <span className="text-xs tabular-nums text-slate-600 w-20 text-right">
                  {formatMoney(
                    r2(
                      (Number(l.hoursText) || 0) * (Number(l.rateText) || 0),
                    ),
                  )}
                </span>
              </>
            )}
            {!canEditRates && (
              <span className="text-xs text-slate-500">h</span>
            )}
            {!locked && (
              <button
                type="button"
                onClick={() =>
                  setLabor((prev) => prev.filter((_, idx) => idx !== i))
                }
                className="px-1 text-slate-400 hover:text-red-600"
                aria-label="Remove crew line"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!locked && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setLabor((prev) => [
                ...prev,
                { employeeId: '', hoursText: '', rateText: '' },
              ])
            }
          >
            + Add crew member
          </Button>
        )}
        <p className="text-[11px] text-slate-500">
          {canEditRates
            ? 'Rate is the labor COST per hour used for job costing (the grey hint is the pay rate) — the price you charge goes on the invoice, not here. Rates are required before posting.'
            : 'Hours only — labor cost rates are entered by the owner/admin at review.'}
        </p>
      </div>

      {/* Materials */}
      <div className="rounded-lg border border-slate-200 p-3 space-y-2">
        <p className="text-sm font-medium text-slate-800">Materials used</p>
        {materials.length === 0 && (
          <p className="text-xs text-slate-500">None reported.</p>
        )}
        {materials.map((m, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <div className="w-64">
              {/* Map the crew's free-text material to a real catalog
                  product (searchable, with inline "+ Add new product").
                  Picking one rewrites the name + unit; clearing it keeps
                  the text as-is. */}
              <ProductPicker
                value={m.inventoryItemId}
                options={products}
                disabled={locked}
                placeholder="— pick from catalog —"
                defaultNewName={m.name}
                onItemSelected={(item) =>
                  setMaterials((prev) =>
                    prev.map((r, idx) =>
                      idx === i
                        ? item
                          ? {
                              ...r,
                              inventoryItemId: item.id,
                              name: item.name,
                              unit: item.unit ?? r.unit,
                            }
                          : { ...r, inventoryItemId: '' }
                        : r,
                    ),
                  )
                }
              />
            </div>
            <Input
              value={m.name}
              onChange={(e) =>
                setMaterials((prev) =>
                  prev.map((r, idx) =>
                    idx === i
                      ? { ...r, name: e.target.value, inventoryItemId: '' }
                      : r,
                  ),
                )
              }
              disabled={locked}
              className="h-9 w-64"
              placeholder="Material (as reported)"
            />
            <Input
              value={m.qtyText}
              onChange={(e) =>
                setMaterials((prev) =>
                  prev.map((r, idx) =>
                    idx === i ? { ...r, qtyText: e.target.value } : r,
                  ),
                )
              }
              disabled={locked}
              inputMode="decimal"
              className="h-9 w-20 text-right tabular-nums"
              placeholder="qty"
            />
            <Input
              value={m.unit}
              onChange={(e) =>
                setMaterials((prev) =>
                  prev.map((r, idx) =>
                    idx === i ? { ...r, unit: e.target.value } : r,
                  ),
                )
              }
              disabled={locked}
              className="h-9 w-24"
              placeholder="unit"
            />
            {!locked && (
              <button
                type="button"
                onClick={() =>
                  setMaterials((prev) => prev.filter((_, idx) => idx !== i))
                }
                className="px-1 text-slate-400 hover:text-red-600"
                aria-label="Remove material"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!locked && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setMaterials((prev) => [
                ...prev,
                { name: '', qtyText: '', unit: '', inventoryItemId: '' },
              ])
            }
          >
            + Add material
          </Button>
        )}
        <p className="text-[11px] text-slate-500">
          Quantities are what the crew reported — price them on the invoice.
          Material COST reaches job costing through receipts categorized to
          this call&apos;s project, as usual.
        </p>
      </div>

      {/* Job photos */}
      <div className="rounded-lg border border-slate-200 p-3 space-y-2">
        <p className="text-sm font-medium text-slate-800">Job photos</p>
        {photos.length === 0 && (
          <p className="text-xs text-slate-500">
            None yet — the crew attaches them when submitting, or add some
            below.
          </p>
        )}
        {photos.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {photos.map((p) => (
              <div
                key={p.id}
                className="rounded-md border border-slate-200 overflow-hidden bg-slate-50"
              >
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.url}
                      alt={p.caption ?? 'Job photo'}
                      className="h-32 w-full object-cover"
                    />
                  </a>
                ) : (
                  <div className="flex h-32 items-center justify-center text-xs text-slate-400">
                    unavailable
                  </div>
                )}
                <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                  <label className="flex items-center gap-1 text-[11px] text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.includeOnInvoice}
                      disabled={pending}
                      onChange={(e) =>
                        run(
                          () =>
                            toggleWorkOrderPhotoInvoiceAction({
                              photoId: p.id,
                              include: e.target.checked,
                            }),
                          e.target.checked
                            ? 'Photo will appear on the invoice.'
                            : 'Photo removed from the invoice.',
                        )
                      }
                      className="h-3.5 w-3.5 rounded border-slate-300"
                    />
                    On invoice
                  </label>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (!window.confirm('Delete this photo?')) return;
                      run(
                        () => deleteWorkOrderPhotoAction(p.id),
                        'Photo deleted.',
                      );
                    }}
                    className="text-slate-400 hover:text-red-600"
                    title="Delete photo"
                    aria-label="Delete photo"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {!isVoid && (
          <div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer rounded-md border border-slate-300 px-2.5 py-1.5 hover:bg-slate-50">
              📷 Add photos
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif"
                multiple
                className="hidden"
                disabled={pending}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (files.length === 0) return;
                  run(async () => {
                    for (const f of files) {
                      const fd = new FormData();
                      fd.set('photo', await downscalePhotoForUpload(f));
                      const res = await uploadWorkOrderPhotoAction(
                        workOrder.id,
                        fd,
                      );
                      if (!res.ok) return res;
                    }
                    return { ok: true };
                  }, `${files.length} photo${files.length === 1 ? '' : 's'} uploaded.`);
                }}
              />
            </label>
          </div>
        )}
        <p className="text-[11px] text-slate-500">
          Photos ticked &quot;On invoice&quot; render in a photo section on
          the client&apos;s invoice PDF (via the married invoice). After
          posting, all of them also show in the project&apos;s Photos
          gallery.
        </p>
      </div>

      {/* Repairs + office notes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Repairs done (from the field)
          </label>
          <textarea
            value={repairsDone}
            onChange={(e) => setRepairsDone(e.target.value)}
            disabled={locked}
            rows={4}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Office notes
          </label>
          <textarea
            value={officeNotes}
            onChange={(e) => setOfficeNotes(e.target.value)}
            disabled={isVoid}
            rows={4}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-50"
            placeholder="Anything worth remembering about this call"
          />
        </div>
      </div>

      {/* Save / status actions */}
      {!locked && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={pending} onClick={save}>
            {pending ? '…' : 'Save changes'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-red-300 text-red-700 hover:bg-red-50"
            disabled={pending}
            onClick={() => {
              if (!window.confirm('Void this work order?')) return;
              run(() => voidWorkOrderAction(workOrder.id), 'Voided.');
            }}
          >
            Void
          </Button>
        </div>
      )}

      {/* Post panel */}
      {!isVoid && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 space-y-2">
          <p className="text-sm font-semibold text-emerald-900">
            {isPosted ? 'Posted to job costing' : 'Post to job costing'}
          </p>
          {isPosted ? (
            <>
              <p className="text-sm text-emerald-800">
                Labor is booked to{' '}
                {workOrder.projectId ? (
                  <Link
                    href={{ pathname: `/projects/${workOrder.projectId}` }}
                    className="font-medium underline"
                  >
                    {workOrder.projectName ?? 'the project'}
                  </Link>
                ) : (
                  'the project'
                )}
                . Unpost to make changes.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(
                    () => unpostWorkOrderAction(workOrder.id),
                    'Unposted — job-cost entries removed; edit and re-post.',
                  )
                }
              >
                Unpost
              </Button>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-80">
                  <label className="block text-xs font-medium text-emerald-900 mb-1">
                    Book to project
                  </label>
                  <Select
                    value={postProjectId}
                    onChange={(e) => setPostProjectId(e.target.value)}
                  >
                    <option value="">
                      + Create a new service job for this call
                    </option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.projectType === 'service' ? ' (service)' : ''}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  type="button"
                  disabled={pending}
                  onClick={saveThenPost}
                >
                  {pending ? '…' : 'Save & post'}
                </Button>
              </div>
              <p className="text-[11px] text-emerald-800">
                Saves everything on this page (rates included), then books
                each crew line (hours × cost rate) to the project&apos;s job
                costs and the P&amp;L direct-labor split.
              </p>
            </>
          )}
        </div>
      )}

      {/* Invoice link */}
      {!isVoid && (
        <div className="rounded-lg border border-slate-200 p-3 space-y-2">
          <p className="text-sm font-medium text-slate-800">Invoice</p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-80">
              <Select
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
              >
                <option value="">— no invoice linked —</option>
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    #{inv.number} · {formatMoney(Number(inv.total))}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    linkWorkOrderInvoiceAction({
                      id: workOrder.id,
                      invoiceId,
                    }),
                  'Invoice link saved.',
                )
              }
            >
              Save link
            </Button>
            <Link
              href={{
                pathname: '/invoices/new',
                query: { workOrder: workOrder.id },
              }}
            >
              <Button type="button" size="sm" variant="ghost">
                Create invoice →
              </Button>
            </Link>
            <Link
              href={{
                pathname: '/proposals/new',
                query: { workOrder: workOrder.id },
              }}
            >
              <Button type="button" size="sm" variant="ghost">
                Save as proposal →
              </Button>
            </Link>
          </div>
          <p className="text-[11px] text-slate-500">
            Bill the client from Invoices (pick this call&apos;s project),
            then link the invoice here so the work order shows how it was
            billed.
          </p>
        </div>
      )}
    </div>
  );
}
