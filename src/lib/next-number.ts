/**
 * Infer the next document number from the sequence already in use.
 *
 * Takes the most recently created number that ends in digits, strips any
 * " (2)" copy suffix, and increments the trailing digit run while keeping
 * the prefix and zero-padding intact ("6071" -> "6072", "PO018" -> "PO019",
 * "CM-2026-004" -> "CM-2026-005"). Bumps past numbers that are already
 * taken so voided/reissued duplicates never collide.
 *
 * Sorting by createdAt (not max value) matters: companies often carry
 * several historical series (e.g. invoices that ran 1000s -> 2000s ->
 * 3000s -> 6000s), and the suggestion should follow the series currently
 * in use, not the all-time numeric max.
 *
 * Returns `fallback` when no existing number ends in digits (fresh company).
 */
export function nextNumberInSequence(
  existing: ReadonlyArray<{ number: string; createdAt?: Date | string | null }>,
  fallback: string,
): string {
  const taken = new Set(existing.map((e) => e.number.trim()));
  const ts = (v: Date | string | null | undefined): number => {
    if (v == null) return Number.NEGATIVE_INFINITY;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
  };
  // Stable sort: rows without createdAt sink to the end in original order.
  const rows = [...existing].sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
  for (const row of rows) {
    // "1033 (2)" is a copy of 1033, not sequence position 2.
    const base = row.number.trim().replace(/\s*\(\d+\)$/, '');
    const m = /^(.*?)(\d+)$/.exec(base);
    if (!m) continue;
    const [, prefix, digits] = m;
    const start = Number(digits);
    if (!Number.isSafeInteger(start + 1)) continue;
    let n = start + 1;
    let candidate = prefix + String(n).padStart(digits.length, '0');
    while (taken.has(candidate)) {
      n += 1;
      candidate = prefix + String(n).padStart(digits.length, '0');
    }
    return candidate;
  }
  return fallback;
}
