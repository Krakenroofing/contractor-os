// Server-only installer for the roofing cost-code seed.
//
// Lives in a separate file from the data (roofing-cost-codes.ts) so the
// client-side install card can import the seed array for preview without
// dragging the 'server-only' barrier — and the createCostCode server call —
// into the client bundle.

import 'server-only';
import {
  createCostCode,
  DuplicateCostCodeError,
} from '@/lib/data/cost-codes';
import {
  ROOFING_COST_CODE_SEED,
  type RoofingSeedResult,
} from './roofing-cost-codes';

/**
 * Install the roofing seed for a company. Idempotent — duplicate-code
 * errors are caught and counted as skipped rather than aborting the run.
 */
export async function installRoofingCostCodes(
  companyId: string,
): Promise<RoofingSeedResult> {
  const skippedCodes: string[] = [];
  let inserted = 0;
  for (const row of ROOFING_COST_CODE_SEED) {
    try {
      await createCostCode(companyId, row);
      inserted += 1;
    } catch (err) {
      if (err instanceof DuplicateCostCodeError) {
        skippedCodes.push(row.code);
        continue;
      }
      throw err;
    }
  }
  return {
    inserted,
    skipped: skippedCodes.length,
    skippedCodes,
  };
}
