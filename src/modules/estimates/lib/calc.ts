// Thin re-export layer kept for back-compat with existing imports.
// All math now routes through the canonical money module.
export {
  calcEstimateTotals,
  calcLineTotals,
  lineCost,
  lineTotal,
  toMoneyString,
  type EstimateTotals,
  type LineInput as LineForCalc,
  type LineTotals,
} from '@/lib/money';
