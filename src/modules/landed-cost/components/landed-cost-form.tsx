'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { VendorPicker } from '@/modules/vendors/components/vendor-picker';
import { calcLandedCost, formatMoney } from '@/lib/money';
import {
  CARRIERS,
  CATEGORY_LABEL,
  type TariffRecord,
} from '@/modules/landed-cost/data';
import {
  createLandedCostAction,
  updateLandedCostAction,
  type CreateLandedCostState,
} from '../actions';

const initialState: CreateLandedCostState = {};

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export type ProjectOption = { id: string; label: string };
export type PurchaseOrderOption = {
  id: string;
  number: string;
  projectId: string;
  vendorId: string;
};
export type VendorOption = { id: string; label: string };

export type LandedCostFormInitial = {
  id: string;
  name: string;
  projectId: string;
  vendorId: string | null;
  purchaseOrderId: string | null;
  carrier: string;
  itemDescription: string | null;
  tariffCode: string | null;
  quantity: string;
  unitCost: string;
  flDelivery: string;
  crating: string;
  freightCost: string;
  insurance: string;
  dutyPercent: string;
  vatPercent: string;
  envLevyPercent: string;
  excisePercent: string;
  brokerage: string;
  portFees: string;
  localDelivery: string;
  notes: string | null;
};

export function LandedCostForm({
  projects,
  vendors,
  purchaseOrders,
  tariffs,
  defaultName,
  initial,
}: {
  projects: ProjectOption[];
  vendors: VendorOption[];
  purchaseOrders: PurchaseOrderOption[];
  tariffs: TariffRecord[];
  defaultName: string;
  /** When provided, the form runs in edit mode against this landed-cost id. */
  initial?: LandedCostFormInitial;
}) {
  const action = initial
    ? updateLandedCostAction.bind(null, initial.id)
    : createLandedCostAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  // Helpers: numeric pre-fill — drizzle numerics come back as strings with
  // trailing zeros; normalize to a friendly editable value.
  const num0 = (v: string | null | undefined, fallback: string): string => {
    if (v === null || v === undefined) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n.toString() : fallback;
  };

  // Tied entities
  const [projectId, setProjectId] = useState<string>(initial?.projectId ?? '');
  const [vendorId, setVendorId] = useState<string>(initial?.vendorId ?? '');
  const [purchaseOrderId, setPurchaseOrderId] = useState<string>(
    initial?.purchaseOrderId ?? '',
  );

  // Item + costs
  const [itemDescription, setItemDescription] = useState(
    initial?.itemDescription ?? '',
  );
  const [carrier, setCarrier] = useState<string>(initial?.carrier ?? 'Tropical');
  const [quantity, setQuantity] = useState(num0(initial?.quantity, '1'));
  const [unitCost, setUnitCost] = useState(num0(initial?.unitCost, '0'));
  const [flDelivery, setFlDelivery] = useState(num0(initial?.flDelivery, '0'));
  const [crating, setCrating] = useState(num0(initial?.crating, '0'));
  const [freightCost, setFreightCost] = useState(num0(initial?.freightCost, '0'));
  const [insurance, setInsurance] = useState(num0(initial?.insurance, '0'));
  const [brokerage, setBrokerage] = useState(num0(initial?.brokerage, '0'));
  const [portFees, setPortFees] = useState(num0(initial?.portFees, '0'));
  const [localDelivery, setLocalDelivery] = useState(
    num0(initial?.localDelivery, '0'),
  );

  // Tariff — match initial tariffCode to a record if possible.
  const initialTariff = initial?.tariffCode
    ? tariffs.find((t) => t.tariffCode === initial.tariffCode)
    : undefined;
  const [tariffId, setTariffId] = useState<string>(initialTariff?.id ?? '');
  const [tariffCode, setTariffCode] = useState<string>(initial?.tariffCode ?? '');
  const [dutyPercent, setDutyPercent] = useState(num0(initial?.dutyPercent, '0'));
  const [vatPercent, setVatPercent] = useState(num0(initial?.vatPercent, '10'));
  const [envLevyPercent, setEnvLevyPercent] = useState(
    num0(initial?.envLevyPercent, '0'),
  );
  const [excisePercent, setExcisePercent] = useState(
    num0(initial?.excisePercent, '0'),
  );
  const [permitNotes, setPermitNotes] = useState('');

  const onTariffChange = (id: string) => {
    const t = tariffs.find((x) => x.id === id);
    setTariffId(id);
    if (t) {
      setTariffCode(t.tariffCode);
      setDutyPercent(String(t.dutyPercent));
      setVatPercent(String(t.vatPercent));
      setEnvLevyPercent(String(t.envLevyPercent));
      setExcisePercent(String(t.excisePercent));
      setPermitNotes(t.requiredPermits);
    }
  };

  // Filter POs by selected project (and vendor if chosen)
  const filteredPOs = useMemo(
    () =>
      purchaseOrders.filter(
        (p) =>
          (!projectId || p.projectId === projectId) &&
          (!vendorId || p.vendorId === vendorId),
      ),
    [purchaseOrders, projectId, vendorId],
  );

  // ===== Live math (canonical) =====
  const totals = useMemo(
    () =>
      calcLandedCost({
        quantity: num(quantity),
        unitCost: num(unitCost),
        flDelivery: num(flDelivery),
        crating: num(crating),
        freightCost: num(freightCost),
        insurance: num(insurance),
        dutyPercent: num(dutyPercent),
        vatPercent: num(vatPercent),
        envLevyPercent: num(envLevyPercent),
        excisePercent: num(excisePercent),
        brokerage: num(brokerage),
        portFees: num(portFees),
        localDelivery: num(localDelivery),
      }),
    [
      quantity,
      unitCost,
      flDelivery,
      crating,
      freightCost,
      insurance,
      dutyPercent,
      vatPercent,
      envLevyPercent,
      excisePercent,
      brokerage,
      portFees,
      localDelivery,
    ],
  );

  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      {/* Hidden tariff code passes the actual HS string to the action */}
      <input type="hidden" name="tariffCode" value={tariffCode} />

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Tied to</legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Estimate name" error={err('name')} required>
            <Input
              name="name"
              defaultValue={initial?.name ?? defaultName}
              required
            />
          </Field>
          <Field label="Project" error={err('projectId')} required>
            <Select
              name="projectId"
              required
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setPurchaseOrderId('');
              }}
            >
              <option value="" disabled>
                {projects.length === 0
                  ? 'No projects in this company'
                  : 'Select a project'}
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Vendor (optional)" error={err('vendorId')}>
            <VendorPicker
              name="vendorId"
              value={vendorId}
              vendors={vendors.map((v) => ({ id: v.id, name: v.label }))}
              onChange={(id) => {
                setVendorId(id);
                setPurchaseOrderId('');
              }}
              noneLabel="— None —"
            />
          </Field>
          <Field label="Linked purchase order (optional)" error={err('purchaseOrderId')}>
            <Select
              name="purchaseOrderId"
              value={purchaseOrderId}
              onChange={(e) => setPurchaseOrderId(e.target.value)}
            >
              <option value="">— None —</option>
              {filteredPOs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.number}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Item & supplier</legend>
        <Field label="Item description" error={err('itemDescription')}>
          <Input
            name="itemDescription"
            value={itemDescription}
            onChange={(e) => setItemDescription(e.target.value)}
            placeholder="e.g. Architectural shingles, 22 squares"
          />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Quantity" error={err('quantity')} required>
            <Input
              name="quantity"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </Field>
          <Field label="Unit cost" error={err('unitCost')} required>
            <Input
              name="unitCost"
              inputMode="decimal"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              required
            />
          </Field>
          <Field label="Supplier subtotal (auto)">
            <Input
              value={formatMoney(totals.supplierSubtotal)}
              readOnly
              className="bg-slate-50 text-slate-700"
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          US handling & freight
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Florida delivery / handling" error={err('flDelivery')}>
            <Input
              name="flDelivery"
              inputMode="decimal"
              value={flDelivery}
              onChange={(e) => setFlDelivery(e.target.value)}
            />
          </Field>
          <Field label="Crating / packaging" error={err('crating')}>
            <Input
              name="crating"
              inputMode="decimal"
              value={crating}
              onChange={(e) => setCrating(e.target.value)}
            />
          </Field>
          <Field label="Freight carrier" error={err('carrier')} required>
            <Select
              name="carrier"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              required
            >
              {CARRIERS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Freight cost" error={err('freightCost')}>
            <Input
              name="freightCost"
              inputMode="decimal"
              value={freightCost}
              onChange={(e) => setFreightCost(e.target.value)}
            />
          </Field>
          <Field label="Insurance" error={err('insurance')}>
            <Input
              name="insurance"
              inputMode="decimal"
              value={insurance}
              onChange={(e) => setInsurance(e.target.value)}
            />
          </Field>
          <div />
        </div>
        <p className="px-2 text-xs text-slate-500">
          Freight benchmarks (from your import history): 40ft flatrack ≈
          $8,000–$10,500 · 20ft ≈ $5,000–$8,000 · LCL crate ≈ 15–25% of value.
          Insurance ≈ 1.85% of value. Heavy loads (e.g. asphalt shingles) run
          higher — freight tracks weight/volume, not price.
        </p>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Bahamas tariff & taxes
        </legend>
        <Field label="Tariff code (auto-fills duty / VAT / levies / permits)">
          <Select value={tariffId} onChange={(e) => onTariffChange(e.target.value)}>
            <option value="">— None selected —</option>
            {tariffs
              .filter((t) => t.isActive)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.tariffCode} · {t.description} · {CATEGORY_LABEL[t.category]}
                </option>
              ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Duty %" error={err('dutyPercent')}>
            <Input
              name="dutyPercent"
              inputMode="decimal"
              value={dutyPercent}
              onChange={(e) => setDutyPercent(e.target.value)}
            />
          </Field>
          <Field label="VAT %" error={err('vatPercent')}>
            <Input
              name="vatPercent"
              inputMode="decimal"
              value={vatPercent}
              onChange={(e) => setVatPercent(e.target.value)}
            />
          </Field>
          <Field label="Environmental levy %" error={err('envLevyPercent')}>
            <Input
              name="envLevyPercent"
              inputMode="decimal"
              value={envLevyPercent}
              onChange={(e) => setEnvLevyPercent(e.target.value)}
            />
          </Field>
          <Field label="Excise %" error={err('excisePercent')}>
            <Input
              name="excisePercent"
              inputMode="decimal"
              value={excisePercent}
              onChange={(e) => setExcisePercent(e.target.value)}
            />
          </Field>
        </div>
        {permitNotes && (
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
            <span className="font-medium">Permits / documents:</span> {permitNotes}
          </div>
        )}
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Local fees</legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Brokerage fees" error={err('brokerage')}>
            <Input
              name="brokerage"
              inputMode="decimal"
              value={brokerage}
              onChange={(e) => setBrokerage(e.target.value)}
            />
          </Field>
          <Field label="Port / terminal fees" error={err('portFees')}>
            <Input
              name="portFees"
              inputMode="decimal"
              value={portFees}
              onChange={(e) => setPortFees(e.target.value)}
            />
          </Field>
          <Field label="Local delivery" error={err('localDelivery')}>
            <Input
              name="localDelivery"
              inputMode="decimal"
              value={localDelivery}
              onChange={(e) => setLocalDelivery(e.target.value)}
            />
          </Field>
        </div>
      </fieldset>

      {/* ===== Summary cards ===== */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <SummaryCard label="CIF" value={formatMoney(totals.cif)} sub="supplier + freight + insurance" />
        <SummaryCard
          label={`Duty (${num(dutyPercent).toFixed(2)}%)`}
          value={formatMoney(totals.duty)}
        />
        <SummaryCard
          label="Processing fee"
          value={formatMoney(totals.processingFee)}
          sub="1% of value, max $1,000"
        />
        <SummaryCard
          label={`VAT (${num(vatPercent).toFixed(2)}%)`}
          value={formatMoney(totals.vat)}
          sub="on CIF + duty + fees"
        />
        <SummaryCard
          label="Total landed cost"
          value={formatMoney(totals.total)}
          highlight
        />
        <SummaryCard
          label="Landed cost / unit"
          value={formatMoney(totals.perUnit)}
          highlight
        />
      </div>

      <Field label="Notes" error={err('notes')}>
        <textarea
          name="notes"
          rows={3}
          defaultValue={initial?.notes ?? ''}
          className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          placeholder="Internal notes, broker name, timing, etc."
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending
            ? 'Saving…'
            : initial
              ? 'Save changes'
              : 'Save landed cost estimate'}
        </Button>
        <Link href={initial ? `/landed-cost/${initial.id}` : '/landed-cost'}>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
  className,
  required,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <Card
      className={highlight ? 'border-emerald-200 bg-emerald-50' : undefined}
    >
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${
            highlight ? 'text-emerald-700' : 'text-slate-900'
          }`}
        >
          {value}
        </p>
        {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </CardContent>
    </Card>
  );
}
