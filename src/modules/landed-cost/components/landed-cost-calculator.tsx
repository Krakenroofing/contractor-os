'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { calcLandedCost, formatMoney } from '@/lib/money';
import {
  CARRIERS,
  CATEGORY_LABEL,
  CONSTRUCTION_CATEGORIES,
  HOUSEHOLD_CATEGORIES,
  SEED_TARIFF_LIBRARY,
  TARIFF_CATEGORIES,
  type TariffCategory,
  type TariffRecord,
} from '../data';

// ===== Calculator inputs =====
type CalcInputs = {
  materialCost: string;
  flDelivery: string;
  crating: string;
  freightCarrier: string;
  freightCost: string;
  insurance: string;
  selectedTariffId: string;
  dutyPercent: string;
  vatPercent: string;
  envLevyPercent: string;
  excisePercent: string;
  brokerage: string;
  portFees: string;
  localDelivery: string;
  quantity: string;
  permitNotes: string;
};

const defaultInputs: CalcInputs = {
  materialCost: '10000',
  flDelivery: '500',
  crating: '400',
  freightCarrier: 'Tropical',
  freightCost: '1200',
  insurance: '150',
  selectedTariffId: SEED_TARIFF_LIBRARY[0].id,
  dutyPercent: String(SEED_TARIFF_LIBRARY[0].dutyPercent),
  vatPercent: String(SEED_TARIFF_LIBRARY[0].vatPercent),
  envLevyPercent: String(SEED_TARIFF_LIBRARY[0].envLevyPercent),
  excisePercent: String(SEED_TARIFF_LIBRARY[0].excisePercent),
  brokerage: '250',
  portFees: '180',
  localDelivery: '200',
  quantity: '50',
  permitNotes: SEED_TARIFF_LIBRARY[0].requiredPermits,
};

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ===== Filter helpers =====
type RateBucket = '' | '0' | 'le5' | '6to25' | 'gt25';

const RATE_BUCKETS: { value: RateBucket; label: string }[] = [
  { value: '', label: 'Any' },
  { value: '0', label: '0%' },
  { value: 'le5', label: '≤ 5%' },
  { value: '6to25', label: '6 – 25%' },
  { value: 'gt25', label: '> 25%' },
];

function rateMatches(value: number, bucket: RateBucket): boolean {
  switch (bucket) {
    case '':
      return true;
    case '0':
      return value === 0;
    case 'le5':
      return value <= 5;
    case '6to25':
      return value > 5 && value <= 25;
    case 'gt25':
      return value > 25;
  }
}

type Scope = 'all' | 'construction' | 'household';

// ===== Component =====
export function LandedCostCalculator() {
  const [library, setLibrary] = useState<TariffRecord[]>(SEED_TARIFF_LIBRARY);
  const [calc, setCalc] = useState<CalcInputs>(defaultInputs);

  // Library filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'' | TariffCategory>('');
  const [dutyBucket, setDutyBucket] = useState<RateBucket>('');
  const [vatBucket, setVatBucket] = useState<RateBucket>('');
  const [permitOnly, setPermitOnly] = useState(false);
  const [frequentOnly, setFrequentOnly] = useState(false);
  const [scope, setScope] = useState<Scope>('all');
  const [activeOnly, setActiveOnly] = useState(true);
  // The library table has 15 columns — too wide to fit. Hide the rarely-edited
  // metadata columns (permits, notes, source, effective date) by default so the
  // rate-editing columns fit without horizontal scroll.
  const [showDetail, setShowDetail] = useState(false);

  // ===== Calculator state updates =====
  const update = <K extends keyof CalcInputs>(key: K, value: CalcInputs[K]) => {
    setCalc((prev) => ({ ...prev, [key]: value }));
  };

  const onTariffChange = (id: string) => {
    const t = library.find((r) => r.id === id);
    setCalc((prev) => ({
      ...prev,
      selectedTariffId: id,
      dutyPercent: t ? String(t.dutyPercent) : prev.dutyPercent,
      vatPercent: t ? String(t.vatPercent) : prev.vatPercent,
      envLevyPercent: t ? String(t.envLevyPercent) : prev.envLevyPercent,
      excisePercent: t ? String(t.excisePercent) : prev.excisePercent,
      permitNotes: t ? t.requiredPermits : '',
    }));
  };

  // ===== Math (canonical) =====
  // Scratch pad uses a flat "material cost" (supplier subtotal) plus a
  // quantity for per-unit roll-up. Map that to calcLandedCost by deriving
  // unit cost = material / qty so supplier subtotal = qty × unitCost = material.
  const totals = useMemo(() => {
    const qty = num(calc.quantity);
    const material = num(calc.materialCost);
    const unitCost = qty > 0 ? material / qty : 0;
    return calcLandedCost({
      quantity: qty,
      unitCost,
      flDelivery: num(calc.flDelivery),
      crating: num(calc.crating),
      freightCost: num(calc.freightCost),
      insurance: num(calc.insurance),
      dutyPercent: num(calc.dutyPercent),
      vatPercent: num(calc.vatPercent),
      envLevyPercent: num(calc.envLevyPercent),
      excisePercent: num(calc.excisePercent),
      brokerage: num(calc.brokerage),
      portFees: num(calc.portFees),
      localDelivery: num(calc.localDelivery),
    });
  }, [calc]);

  // ===== Filtered library =====
  const filteredLibrary = useMemo(() => {
    const q = search.trim().toLowerCase();
    return library.filter((t) => {
      if (activeOnly && !t.isActive) return false;
      if (categoryFilter && t.category !== categoryFilter) return false;
      if (!rateMatches(t.dutyPercent, dutyBucket)) return false;
      if (!rateMatches(t.vatPercent, vatBucket)) return false;
      if (permitOnly && !t.requiredPermits.trim()) return false;
      if (frequentOnly && !t.isFrequentlyUsed) return false;
      if (scope === 'construction' && !CONSTRUCTION_CATEGORIES.includes(t.category)) {
        return false;
      }
      if (scope === 'household' && !HOUSEHOLD_CATEGORIES.includes(t.category)) {
        return false;
      }
      if (q) {
        const haystack = [
          t.tariffCode,
          t.description,
          CATEGORY_LABEL[t.category],
          t.internalNotes,
          t.requiredPermits,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [library, search, categoryFilter, dutyBucket, vatBucket, permitOnly, frequentOnly, scope, activeOnly]);

  // ===== Library row handlers =====
  const addRow = () =>
    setLibrary((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        tariffCode: '',
        description: '',
        category: 'general',
        dutyPercent: 0,
        vatPercent: 0,
        envLevyPercent: 0,
        excisePercent: 0,
        processingFeeNotes: '',
        requiredPermits: '',
        sourceReference: '',
        effectiveDate: new Date().toISOString().slice(0, 10),
        isActive: true,
        isFrequentlyUsed: false,
        internalNotes: '',
      },
    ]);

  const updateRow = (id: string, patch: Partial<TariffRecord>) =>
    setLibrary((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const removeRow = (id: string) =>
    setLibrary((prev) => prev.filter((r) => r.id !== id));

  const clearFilters = () => {
    setSearch('');
    setCategoryFilter('');
    setDutyBucket('');
    setVatBucket('');
    setPermitOnly(false);
    setFrequentOnly(false);
    setScope('all');
  };

  const selectedTariff = library.find((r) => r.id === calc.selectedTariffId);

  return (
    <div className="space-y-6">
      {/* ============================================================ */}
      {/* Calculator                                                   */}
      {/* ============================================================ */}
      <Card>
        <CardHeader>
          <CardTitle>Landed cost calculator</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Section label="Source costs (FOB build-up)">
            <Money
              label="Material / vendor cost"
              value={calc.materialCost}
              onChange={(v) => update('materialCost', v)}
            />
            <Money
              label="FL delivery & handling"
              value={calc.flDelivery}
              onChange={(v) => update('flDelivery', v)}
            />
            <Money
              label="Crating"
              value={calc.crating}
              onChange={(v) => update('crating', v)}
            />
          </Section>

          <Section label="Freight">
            <Field label="Freight carrier / broker">
              <Select
                value={calc.freightCarrier}
                onChange={(e) => update('freightCarrier', e.target.value)}
              >
                {CARRIERS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Money
              label="Freight cost"
              value={calc.freightCost}
              onChange={(v) => update('freightCost', v)}
            />
            <Money
              label="Insurance"
              value={calc.insurance}
              onChange={(v) => update('insurance', v)}
            />
          </Section>

          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">
              Tariff & taxes
            </p>
            <div className="space-y-3">
              <Field label="Bahamas tariff code (auto-fills duty / VAT / levies / permits)">
                <Select
                  value={calc.selectedTariffId}
                  onChange={(e) => onTariffChange(e.target.value)}
                >
                  {library
                    .filter((r) => r.isActive)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {(r.tariffCode || '—') + ' · ' + (r.description || 'Untitled')} ·{' '}
                        {CATEGORY_LABEL[r.category]}
                      </option>
                    ))}
                </Select>
              </Field>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Field label="Duty %">
                  <Input
                    inputMode="decimal"
                    value={calc.dutyPercent}
                    onChange={(e) => update('dutyPercent', e.target.value)}
                  />
                </Field>
                <Field label="VAT %">
                  <Input
                    inputMode="decimal"
                    value={calc.vatPercent}
                    onChange={(e) => update('vatPercent', e.target.value)}
                  />
                </Field>
                <Field label="Environmental levy %">
                  <Input
                    inputMode="decimal"
                    value={calc.envLevyPercent}
                    onChange={(e) => update('envLevyPercent', e.target.value)}
                  />
                </Field>
                <Field label="Excise %">
                  <Input
                    inputMode="decimal"
                    value={calc.excisePercent}
                    onChange={(e) => update('excisePercent', e.target.value)}
                  />
                </Field>
              </div>

              {selectedTariff && selectedTariff.requiredPermits && (
                <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                  <span className="font-medium">Permits / documents:</span>{' '}
                  {selectedTariff.requiredPermits}
                </div>
              )}
              {selectedTariff && selectedTariff.processingFeeNotes && (
                <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700">
                  <span className="font-medium">Processing notes:</span>{' '}
                  {selectedTariff.processingFeeNotes}
                </div>
              )}
            </div>
          </div>

          <Section label="Local fees">
            <Money
              label="Brokerage fees"
              value={calc.brokerage}
              onChange={(v) => update('brokerage', v)}
            />
            <Money
              label="Port / terminal fees"
              value={calc.portFees}
              onChange={(v) => update('portFees', v)}
            />
            <Money
              label="Local delivery"
              value={calc.localDelivery}
              onChange={(v) => update('localDelivery', v)}
            />
          </Section>

          <Section label="Quantity">
            <Field label="Units">
              <Input
                inputMode="decimal"
                value={calc.quantity}
                onChange={(e) => update('quantity', e.target.value)}
              />
            </Field>
            <div />
            <div />
          </Section>
        </CardContent>
      </Card>

      {/* ============================================================ */}
      {/* Results                                                      */}
      {/* ============================================================ */}
      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Result label="FOB" value={formatMoney(totals.fob)} sub="material + FL + crating" />
            <Result label="CIF" value={formatMoney(totals.cif)} sub="material + freight + insurance" />
            <Result
              label={`Duty (${num(calc.dutyPercent).toFixed(2)}%)`}
              value={formatMoney(totals.duty)}
            />
            <Result
              label={`Excise (${num(calc.excisePercent).toFixed(2)}%)`}
              value={formatMoney(totals.excise)}
            />
            <Result
              label={`Env. levy (${num(calc.envLevyPercent).toFixed(2)}%)`}
              value={formatMoney(totals.envLevy)}
            />
            <Result
              label="Processing fee"
              value={formatMoney(totals.processingFee)}
              sub="1% of value, max $1,000"
            />
            <Result
              label={`VAT (${num(calc.vatPercent).toFixed(2)}%)`}
              value={formatMoney(totals.vat)}
              sub="on CIF + duty + fees"
            />
            <Result label="Local fees" value={formatMoney(totals.localFees)} sub="brokerage + port + local" />
            <Result
              label="Total landed cost"
              value={formatMoney(totals.total)}
              valueClassName="text-emerald-700"
              highlight
            />
            <Result
              label="Quantity"
              value={num(calc.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              sub="units"
            />
            <Result
              label="Landed cost / unit"
              value={formatMoney(totals.perUnit)}
              valueClassName="text-emerald-700"
              highlight
            />
          </div>
        </CardContent>
      </Card>

      {/* ============================================================ */}
      {/* Bahamas Tariff Library                                       */}
      {/* ============================================================ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle>
              Bahamas Tariff Library ({filteredLibrary.length} of {library.length})
            </CardTitle>
            <div className="flex gap-2 flex-wrap">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowDetail((v) => !v)}
              >
                {showDetail ? 'Hide detail columns' : 'Show detail columns'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled
                title="CSV import wires up after persistence is added"
              >
                Import from CSV (coming soon)
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={addRow}>
                + Add row
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
            <span className="font-semibold">⚠ Verify before use:</span> Duty
            classifications and rates must be verified against the current Bahamas
            Customs Tariff Schedule and/or customs broker classification before use.
            Values shown are illustrative for planning only.
          </div>

          {/* ---------- Filters ---------- */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label>Search</Label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Code, description, category, keyword…"
              />
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as '' | TariffCategory)}
              >
                <option value="">All categories</option>
                {TARIFF_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Duty rate</Label>
              <Select
                value={dutyBucket}
                onChange={(e) => setDutyBucket(e.target.value as RateBucket)}
              >
                {RATE_BUCKETS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label>VAT rate</Label>
              <Select
                value={vatBucket}
                onChange={(e) => setVatBucket(e.target.value as RateBucket)}
              >
                {RATE_BUCKETS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <ToggleChip
              label="Permit required"
              active={permitOnly}
              onClick={() => setPermitOnly((v) => !v)}
            />
            <ToggleChip
              label="Frequently used by us"
              active={frequentOnly}
              onClick={() => setFrequentOnly((v) => !v)}
            />
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Scope:</span>
              <Select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                <option value="all">All</option>
                <option value="construction">Construction only</option>
                <option value="household">Household / personal only</option>
              </Select>
            </div>
            <ToggleChip
              label="Active only"
              active={activeOnly}
              onClick={() => setActiveOnly((v) => !v)}
            />
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>

          {/* ---------- Table ---------- */}
          <div className="overflow-auto rounded-md border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead className="min-w-[120px]">Tariff / HS code</TableHead>
                  <TableHead className="min-w-[200px]">Description</TableHead>
                  <TableHead className="min-w-[150px]">Category</TableHead>
                  <TableHead className="min-w-[84px] whitespace-nowrap text-right">
                    Duty %
                  </TableHead>
                  <TableHead className="min-w-[80px] whitespace-nowrap text-right">
                    VAT %
                  </TableHead>
                  <TableHead className="min-w-[96px] whitespace-nowrap text-right">
                    Env levy %
                  </TableHead>
                  <TableHead className="min-w-[84px] whitespace-nowrap text-right">
                    Excise %
                  </TableHead>
                  {showDetail && (
                    <>
                      <TableHead className="min-w-[180px]">Permits / docs</TableHead>
                      <TableHead className="min-w-[150px]">Processing notes</TableHead>
                      <TableHead className="min-w-[150px]">Source / reference</TableHead>
                      <TableHead className="min-w-[140px] whitespace-nowrap">Effective</TableHead>
                    </>
                  )}
                  <TableHead className="min-w-[88px] whitespace-nowrap">Active</TableHead>
                  {showDetail && (
                    <TableHead className="min-w-[150px]">Internal notes</TableHead>
                  )}
                  <TableHead className="min-w-[48px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLibrary.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={15} className="p-6 text-center text-slate-500">
                      No tariff records match those filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLibrary.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <button
                          type="button"
                          aria-label="Toggle frequently used"
                          onClick={() =>
                            updateRow(r.id, { isFrequentlyUsed: !r.isFrequentlyUsed })
                          }
                          className={`h-7 w-7 rounded border text-sm ${
                            r.isFrequentlyUsed
                              ? 'border-amber-300 bg-amber-50 text-amber-700'
                              : 'border-slate-300 bg-white text-slate-400 hover:text-slate-600'
                          }`}
                          title={
                            r.isFrequentlyUsed
                              ? 'Frequently used — click to unmark'
                              : 'Click to mark as frequently used'
                          }
                        >
                          ★
                        </button>
                      </TableCell>
                      <TableCell>
                        <Input
                          value={r.tariffCode}
                          onChange={(e) => updateRow(r.id, { tariffCode: e.target.value })}
                          placeholder="6807.10.00"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={r.description}
                          onChange={(e) => updateRow(r.id, { description: e.target.value })}
                          placeholder="Description"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={r.category}
                          onChange={(e) =>
                            updateRow(r.id, { category: e.target.value as TariffCategory })
                          }
                        >
                          {TARIFF_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {CATEGORY_LABEL[c]}
                            </option>
                          ))}
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          inputMode="decimal"
                          value={String(r.dutyPercent)}
                          onChange={(e) =>
                            updateRow(r.id, { dutyPercent: num(e.target.value) })
                          }
                          className="text-right tabular-nums"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          inputMode="decimal"
                          value={String(r.vatPercent)}
                          onChange={(e) =>
                            updateRow(r.id, { vatPercent: num(e.target.value) })
                          }
                          className="text-right tabular-nums"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          inputMode="decimal"
                          value={String(r.envLevyPercent)}
                          onChange={(e) =>
                            updateRow(r.id, { envLevyPercent: num(e.target.value) })
                          }
                          className="text-right tabular-nums"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          inputMode="decimal"
                          value={String(r.excisePercent)}
                          onChange={(e) =>
                            updateRow(r.id, { excisePercent: num(e.target.value) })
                          }
                          className="text-right tabular-nums"
                        />
                      </TableCell>
                      {showDetail && (
                        <>
                          <TableCell>
                            <Input
                              value={r.requiredPermits}
                              onChange={(e) => updateRow(r.id, { requiredPermits: e.target.value })}
                              placeholder="None"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={r.processingFeeNotes}
                              onChange={(e) =>
                                updateRow(r.id, { processingFeeNotes: e.target.value })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={r.sourceReference}
                              onChange={(e) =>
                                updateRow(r.id, { sourceReference: e.target.value })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="date"
                              value={r.effectiveDate}
                              onChange={(e) =>
                                updateRow(r.id, { effectiveDate: e.target.value })
                              }
                            />
                          </TableCell>
                        </>
                      )}
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => updateRow(r.id, { isActive: !r.isActive })}
                          className="text-xs"
                        >
                          {r.isActive ? (
                            <Badge tone="green">Active</Badge>
                          ) : (
                            <Badge tone="slate">Inactive</Badge>
                          )}
                        </button>
                      </TableCell>
                      {showDetail && (
                        <TableCell>
                          <Input
                            value={r.internalNotes}
                            onChange={(e) =>
                              updateRow(r.id, { internalNotes: e.target.value })
                            }
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => removeRow(r.id)}
                          aria-label="Remove row"
                        >
                          ✕
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="text-xs text-slate-500 leading-relaxed">
            Edits live in this session only. The "Frequently used by us" star marks
            common TRB / Kraken items without limiting the full library. CSV import
            will accept the full official Bahamas Customs tariff schedule once
            persistence is added.
          </div>
        </CardContent>
      </Card>

      {/* ============================================================ */}
      {/* Carrier reference                                            */}
      {/* ============================================================ */}
      <Card>
        <CardHeader>
          <CardTitle>Carrier / broker reference</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-700 flex flex-wrap gap-2">
          {CARRIERS.map((c) => (
            <Badge key={c} tone="slate">
              {c}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ===== Small UI helpers =====
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">{label}</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Money({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function Result({
  label,
  value,
  sub,
  valueClassName,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        highlight ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          valueClassName ?? 'text-slate-900'
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
        active
          ? 'bg-slate-900 text-white border-slate-900'
          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );
}
