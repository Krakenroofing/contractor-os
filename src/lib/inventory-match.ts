// Fuzzy matcher: rank inventory_items against a free-text line description
// from an Excel row or an extracted PDF line. Used by the PO upload flows
// in Phase 6.2 to suggest catalog matches without auto-applying them
// (per the "conservative: always suggest" design decision).
//
// Pure / client-safe — no DB, no server imports. Pass the catalog in.

export type InventoryMatchCandidate = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string | null;
  defaultCost: number;
  defaultCostCodeId?: string | null;
};

export type InventoryMatchResult = {
  candidate: InventoryMatchCandidate;
  score: number;
  reason: 'sku' | 'name' | 'substring' | 'words';
};

export type MatchInput = {
  /** Free-text description from the source row (Excel/PDF). */
  description: string;
  /** Optional SKU pulled from the source row. */
  sku?: string | null;
};

function normalize(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(s: string): string[] {
  return normalize(s).split(' ').filter((t) => t.length >= 2);
}

// Jaccard similarity on word-set, biased to recall (short queries shouldn't
// score 0 just because the catalog name has extra noise words like "lb",
// "box", color qualifiers, etc).
function wordOverlapScore(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let hits = 0;
  for (const t of A) if (B.has(t)) hits += 1;
  // Asymmetric: divide by the smaller set so a long catalog name doesn't
  // tank a short, specific query.
  const denom = Math.min(A.size, B.size);
  return hits / denom;
}

/**
 * Score one candidate against one source row. Highest-scoring reason wins.
 */
function scoreOne(
  input: MatchInput,
  c: InventoryMatchCandidate,
): InventoryMatchResult | null {
  const qSku = normalize(input.sku ?? '');
  const cSku = normalize(c.sku ?? '');
  if (qSku !== '' && cSku !== '' && qSku === cSku) {
    return { candidate: c, score: 1, reason: 'sku' };
  }

  const qDesc = normalize(input.description);
  const cName = normalize(c.name);
  if (qDesc === '' || cName === '') return null;

  if (qDesc === cName) {
    return { candidate: c, score: 0.95, reason: 'name' };
  }

  if (cName.includes(qDesc) || qDesc.includes(cName)) {
    // Longer substring shared = higher score, capped at 0.85.
    const shared = Math.min(qDesc.length, cName.length);
    const max = Math.max(qDesc.length, cName.length);
    return {
      candidate: c,
      score: 0.6 + 0.25 * (shared / max),
      reason: 'substring',
    };
  }

  const overlap = wordOverlapScore(input.description, c.name);
  if (overlap > 0) {
    return { candidate: c, score: 0.3 + 0.5 * overlap, reason: 'words' };
  }

  return null;
}

/**
 * Return the top N candidates for a source row, sorted by score descending.
 * Empty array if nothing scores above the floor. Defaults: topN=5, floor=0.35.
 */
export function matchInventoryItem(
  input: MatchInput,
  catalog: InventoryMatchCandidate[],
  opts: { topN?: number; floor?: number } = {},
): InventoryMatchResult[] {
  const topN = opts.topN ?? 5;
  const floor = opts.floor ?? 0.35;
  const scored: InventoryMatchResult[] = [];
  for (const c of catalog) {
    const r = scoreOne(input, c);
    if (r && r.score >= floor) scored.push(r);
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

/**
 * Convenience: return only the single best match, or null if nothing
 * clears the floor.
 */
export function bestInventoryMatch(
  input: MatchInput,
  catalog: InventoryMatchCandidate[],
  opts: { floor?: number } = {},
): InventoryMatchResult | null {
  const results = matchInventoryItem(input, catalog, { ...opts, topN: 1 });
  return results[0] ?? null;
}
