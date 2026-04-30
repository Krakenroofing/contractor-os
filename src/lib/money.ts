// =====================================================================
// Canonical money / number module
//
// Every financial calculation in the app should route through here so
// rounding is consistent and float-drift is contained. Internally we
// round every elementary operation to 2 decimals (or the appropriate
// precision) using a Number.EPSILON-safe rounder.
// =====================================================================

export const MONEY_DECIMALS = 2;
export const PERCENT_DECIMALS = 3;
export const QUANTITY_DECIMALS = 4;

function roundTo(n: number, decimals: number): number {
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** decimals;
  // The EPSILON nudge keeps cases like 1.005 → 1.01 from drifting to 1.00.
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(n) * factor + Number.EPSILON)) / factor;
}

export function round2(n: number): number {
  return roundTo(n, MONEY_DECIMALS);
}

export function round3(n: number): number {
  return roundTo(n, PERCENT_DECIMALS);
}

export function round4(n: number): number {
  return roundTo(n, QUANTITY_DECIMALS);
}

// ===== Arithmetic =====

export function add(...values: number[]): number {
  let s = 0;
  for (const v of values) s += Number.isFinite(v) ? v : 0;
  return round2(s);
}

export function subtract(a: number, b: number): number {
  return round2((Number.isFinite(a) ? a : 0) - (Number.isFinite(b) ? b : 0));
}

export function multiply(a: number, b: number): number {
  return round2((Number.isFinite(a) ? a : 0) * (Number.isFinite(b) ? b : 0));
}

export function divide(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return round2(a / b);
}

/** Percentage helper: amount × (pct / 100). */
export function percent(amount: number, pct: number): number {
  return round2(
    (Number.isFinite(amount) ? amount : 0) *
      ((Number.isFinite(pct) ? pct : 0) / 100),
  );
}

// ===== Parsers (string → number, money-safe) =====

export function parseMoney(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return round2(n);
}

export function parsePercent(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return round3(n);
}

export function parseQuantity(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return round4(n);
}

// ===== String coercions for storage (numeric columns) =====

export function toMoneyString(n: number): string {
  return round2(n).toFixed(MONEY_DECIMALS);
}

export function toPercentString(n: number): string {
  return round3(n).toFixed(PERCENT_DECIMALS);
}

export function toQuantityString(n: number): string {
  return round4(n).toFixed(QUANTITY_DECIMALS);
}

// ===== Validation =====

export class MoneyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyValidationError';
  }
}

export function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new MoneyValidationError(`${label} must be a number`);
  }
  if (value < 0) {
    throw new MoneyValidationError(`${label} must not be negative (got ${value})`);
  }
}

export function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new MoneyValidationError(`${label} must be greater than zero (got ${value})`);
  }
}

export function assertPercent(value: number, label: string, max = 1000): void {
  if (!Number.isFinite(value)) {
    throw new MoneyValidationError(`${label} must be a number`);
  }
  if (value < 0) {
    throw new MoneyValidationError(`${label} must not be negative (got ${value})`);
  }
  if (value > max) {
    throw new MoneyValidationError(
      `${label} exceeds reasonable max of ${max}% (got ${value})`,
    );
  }
}

export function clampNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// ===== Formatting =====

export function formatMoney(
  value: string | number | null | undefined,
  currency = 'USD',
  locale = 'en-US',
): string {
  const n = parseMoney(value);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: MONEY_DECIMALS,
      maximumFractionDigits: MONEY_DECIMALS,
    }).format(n);
  } catch {
    // Unknown currency code — fall back to a generic formatted number.
    return `${currency} ${n.toFixed(MONEY_DECIMALS)}`;
  }
}

export function formatPercent(
  value: string | number | null | undefined,
  decimals = 1,
): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(decimals)}%`;
}

export function formatQuantity(
  value: string | number | null | undefined,
  maxDecimals = 2,
): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
}

// =====================================================================
// Calculation primitives — these are the canonical formulas every
// module should use. If a number ever needs to be computed for storage,
// reach for these instead of writing `qty * unitCost` inline.
// =====================================================================

// ----- Lines (estimates / change orders) -----

export type LineInput = {
  quantity: number;
  unitCost: number;
  markupPercent: number;
};

export type LineTotals = {
  cost: number;
  markup: number;
  total: number;
};

export function calcLineTotals(input: LineInput): LineTotals {
  const cost = multiply(input.quantity, input.unitCost);
  const markup = percent(cost, input.markupPercent);
  return { cost, markup, total: add(cost, markup) };
}

export function lineCost(input: LineInput): number {
  return multiply(input.quantity, input.unitCost);
}

export function lineTotal(input: LineInput): number {
  return calcLineTotals(input).total;
}

// ----- Estimate / change-order totals -----

export type EstimateTotals = {
  subtotal: number;
  markup: number;
  total: number;
};

export function calcEstimateTotals(lines: LineInput[]): EstimateTotals {
  let subtotal = 0;
  let total = 0;
  for (const l of lines) {
    const lt = calcLineTotals(l);
    subtotal = add(subtotal, lt.cost);
    total = add(total, lt.total);
  }
  return {
    subtotal,
    markup: subtract(total, subtotal),
    total,
  };
}

// ----- Purchase order totals -----

export type POLineInput = {
  quantityOrdered: number;
  unitCost: number;
};

export type POTotals = {
  subtotal: number;
  taxAmount: number;
  shipping: number;
  total: number;
};

export function calcPOTotals(input: {
  lines: POLineInput[];
  taxAmount: number;
  shipping: number;
}): POTotals {
  let subtotal = 0;
  for (const l of input.lines) {
    subtotal = add(subtotal, multiply(l.quantityOrdered, l.unitCost));
  }
  const taxAmount = round2(input.taxAmount);
  const shipping = round2(input.shipping);
  return {
    subtotal,
    taxAmount,
    shipping,
    total: add(subtotal, taxAmount, shipping),
  };
}

// ----- Landed cost totals (Bahamas-typical) -----
// CIF = supplier subtotal + freight + insurance
// FL delivery + crating are "handling" — added to the all-in total
// alongside duty / excise / env levy / VAT / local fees.

export type LandedCostInput = {
  quantity: number;
  unitCost: number;
  flDelivery: number;
  crating: number;
  freightCost: number;
  insurance: number;
  dutyPercent: number;
  vatPercent: number;
  envLevyPercent: number;
  excisePercent: number;
  brokerage: number;
  portFees: number;
  localDelivery: number;
};

export type LandedCostTotals = {
  supplierSubtotal: number;
  fob: number;
  cif: number;
  duty: number;
  excise: number;
  envLevy: number;
  vatBase: number;
  vat: number;
  localFees: number;
  handling: number;
  total: number;
  perUnit: number;
};

export function calcLandedCost(input: LandedCostInput): LandedCostTotals {
  const supplierSubtotal = multiply(input.quantity, input.unitCost);
  const handling = add(input.flDelivery, input.crating);
  const fob = add(supplierSubtotal, handling);
  const cif = add(supplierSubtotal, input.freightCost, input.insurance);
  const duty = percent(cif, input.dutyPercent);
  const excise = percent(cif, input.excisePercent);
  const envLevy = percent(cif, input.envLevyPercent);
  const vatBase = add(cif, duty, excise, envLevy);
  const vat = percent(vatBase, input.vatPercent);
  const localFees = add(input.brokerage, input.portFees, input.localDelivery);
  const total = add(
    supplierSubtotal,
    input.freightCost,
    input.insurance,
    duty,
    excise,
    envLevy,
    vat,
    localFees,
    handling,
  );
  const perUnit =
    input.quantity > 0 ? round2(total / input.quantity) : 0;
  return {
    supplierSubtotal,
    fob,
    cif,
    duty,
    excise,
    envLevy,
    vatBase,
    vat,
    localFees,
    handling,
    total,
    perUnit,
  };
}

// ----- Margin / GP -----

export function calcMargin(contract: number, cost: number) {
  const profit = subtract(contract, cost);
  const marginPct = contract > 0 ? round3((profit / contract) * 100) : 0;
  return { profit, marginPct };
}
