// Pure rule matcher. Runs in both server (page render, action apply) and
// browser (rule-form test panel). No I/O, no `server-only` import.
//
// Design contract:
//   - matchRule(txn, rule) is total and never throws. An invalid regex stored
//     in a rule is silently skipped (no match), never bubbles up.
//   - firstMatchingRule(txn, rules) returns the lowest-priority match, or null.
//   - All comparison is case-insensitive unless the matcher explicitly opts
//     into `case_sensitive: true`.

export const MATCHER_FIELDS = [
  'description',
  'payee',
  'memo',
  'reference',
] as const;
export type MatcherField = (typeof MATCHER_FIELDS)[number];

export const MATCHER_OPS = [
  'contains',
  'equals',
  'starts_with',
  'regex',
] as const;
export type MatcherOp = (typeof MATCHER_OPS)[number];

export const APPLIES_TO_VALUES = ['all', 'debits', 'credits'] as const;
export type AppliesTo = (typeof APPLIES_TO_VALUES)[number];

export const RULE_MODES = ['suggest', 'auto_apply'] as const;
export type RuleMode = (typeof RULE_MODES)[number];

export type Matcher = {
  field: MatcherField;
  op: MatcherOp;
  value: string;
  case_sensitive?: boolean;
};

export type RuleActionPayload = {
  // Phase 1 supported keys. Tolerates extras for forward-compat.
  accountingAccountId?: string | null;
  projectId?: string | null;
  costCodeId?: string | null;
  notes?: string | null;
  // Phase 2: stamp a payee, and optionally auto-split each matched
  // (VAT-inclusive) transaction into net cost + VAT Input lines.
  vendorId?: string | null;
  autoVatSplit?: boolean;
  vatRateOverride?: number | null;
  [k: string]: unknown;
};

export type RuleForMatching = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  appliesTo: AppliesTo;
  bankAccountId: string | null;
  amountMin: number | null;
  amountMax: number | null;
  matchers: Matcher[];
  actions: RuleActionPayload;
};

export type TxnForMatching = {
  bankAccountId: string;
  description: string;
  payee: string | null;
  memo: string | null;
  reference: string | null;
  /** Signed: positive = credit (money in), negative = debit (money out). */
  amount: number;
  isReviewed: boolean;
  isIgnored: boolean;
  accountingAccountId: string | null;
  appliedRuleId: string | null;
  /** True when an active transaction_matches row exists for this txn.
   *  Optional — callers that don't care about reconciliation (rule-test
   *  panel, applyRuleAction's stale-match recheck) can omit it. */
  reconciled?: boolean;
};

export type MatchReason = {
  field: MatcherField;
  op: MatcherOp;
  value: string;
  /** The actual cell value from the transaction that satisfied this matcher. */
  matchedAgainst: string;
};

export type MatchResult =
  | { matched: true; rule: RuleForMatching; reasons: MatchReason[] }
  | { matched: false };

function fieldValue(txn: TxnForMatching, field: MatcherField): string {
  switch (field) {
    case 'description':
      return txn.description ?? '';
    case 'payee':
      return txn.payee ?? '';
    case 'memo':
      return txn.memo ?? '';
    case 'reference':
      return txn.reference ?? '';
  }
}

/** Best-effort regex compile. Returns null when the pattern is invalid so the
 *  matcher can skip this rule rather than crash the page. */
function safeRegex(pattern: string, flags: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

export function matcherHits(
  matcher: Matcher,
  txn: TxnForMatching,
): { hit: true; matchedAgainst: string } | { hit: false } {
  const raw = fieldValue(txn, matcher.field);
  const subject = matcher.case_sensitive ? raw : raw.toLowerCase();
  const probe = matcher.case_sensitive
    ? matcher.value
    : matcher.value.toLowerCase();

  if (probe === '') return { hit: false };

  switch (matcher.op) {
    case 'contains':
      return subject.includes(probe)
        ? { hit: true, matchedAgainst: raw }
        : { hit: false };
    case 'equals':
      return subject === probe
        ? { hit: true, matchedAgainst: raw }
        : { hit: false };
    case 'starts_with':
      return subject.startsWith(probe)
        ? { hit: true, matchedAgainst: raw }
        : { hit: false };
    case 'regex': {
      const flags = matcher.case_sensitive ? '' : 'i';
      const re = safeRegex(matcher.value, flags);
      if (!re) return { hit: false };
      return re.test(raw)
        ? { hit: true, matchedAgainst: raw }
        : { hit: false };
    }
  }
}

export function matchRule(
  txn: TxnForMatching,
  rule: RuleForMatching,
): MatchResult {
  if (!rule.enabled) return { matched: false };
  if (rule.bankAccountId && rule.bankAccountId !== txn.bankAccountId) {
    return { matched: false };
  }
  if (rule.appliesTo === 'debits' && txn.amount >= 0) return { matched: false };
  if (rule.appliesTo === 'credits' && txn.amount <= 0) return { matched: false };

  const abs = Math.abs(txn.amount);
  if (rule.amountMin !== null && abs < rule.amountMin) return { matched: false };
  if (rule.amountMax !== null && abs > rule.amountMax) return { matched: false };

  if (!Array.isArray(rule.matchers) || rule.matchers.length === 0) {
    return { matched: false };
  }

  const reasons: MatchReason[] = [];
  for (const m of rule.matchers) {
    const result = matcherHits(m, txn);
    if (!result.hit) return { matched: false };
    reasons.push({
      field: m.field,
      op: m.op,
      value: m.value,
      matchedAgainst: result.matchedAgainst,
    });
  }
  return { matched: true, rule, reasons };
}

/** Returns the lowest-priority matching rule, or null. Rules sorted by
 *  priority ASC then created_at ASC (caller pre-sorts). */
export function firstMatchingRule(
  txn: TxnForMatching,
  sortedRules: RuleForMatching[],
): MatchResult & { matched: true } | null {
  for (const r of sortedRules) {
    const m = matchRule(txn, r);
    if (m.matched) return m;
  }
  return null;
}

/** Triage state computed from row + match status. Drives badge selection.
 *  Order roughly reflects priority — `reconciled` outranks `reviewed` because
 *  a reconciled txn is definitively settled, while reviewed-without-match
 *  just means a human looked at it. */
export type TxnTriageState =
  | 'ignored'
  | 'reconciled'
  | 'reviewed'
  | 'auto_filled' // rule wrote category, awaiting human review
  | 'manually_categorized'
  | 'suggested' // rule matches an uncategorized txn
  | 'uncategorized';

export function triageState(
  txn: TxnForMatching,
  matched: MatchResult | null,
): TxnTriageState {
  if (txn.isIgnored) return 'ignored';
  if (txn.reconciled === true) return 'reconciled';
  if (txn.isReviewed) return 'reviewed';
  if (txn.appliedRuleId) return 'auto_filled';
  if (txn.accountingAccountId) return 'manually_categorized';
  if (matched && matched.matched) return 'suggested';
  return 'uncategorized';
}

// ===== DB-row → matcher shape adapters =====

/** Coerce a DB banking_rules row (matchers/actions are JSONB strings/objects,
 *  amountMin/amountMax are numeric strings) into the matcher's RuleForMatching
 *  shape. Defensive — bad JSON simply produces an empty matcher list which the
 *  engine then treats as a non-match. */
export function toRuleForMatching(row: {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  appliesTo: string;
  bankAccountId: string | null;
  amountMin: string | null;
  amountMax: string | null;
  matchers: unknown;
  actions: unknown;
}): RuleForMatching {
  const applies: AppliesTo =
    row.appliesTo === 'debits' || row.appliesTo === 'credits'
      ? row.appliesTo
      : 'all';
  const matchers: Matcher[] = Array.isArray(row.matchers)
    ? (row.matchers as unknown[]).filter(isMatcher)
    : [];
  const actions: RuleActionPayload =
    row.actions !== null && typeof row.actions === 'object'
      ? (row.actions as RuleActionPayload)
      : {};
  const toNum = (v: string | null): number | null => {
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    priority: row.priority,
    appliesTo: applies,
    bankAccountId: row.bankAccountId,
    amountMin: toNum(row.amountMin),
    amountMax: toNum(row.amountMax),
    matchers,
    actions,
  };
}

function isMatcher(v: unknown): v is Matcher {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.field === 'string' &&
    (MATCHER_FIELDS as readonly string[]).includes(o.field) &&
    typeof o.op === 'string' &&
    (MATCHER_OPS as readonly string[]).includes(o.op) &&
    typeof o.value === 'string'
  );
}

/** Coerce an imported_transactions row to the matcher's TxnForMatching shape. */
export function toTxnForMatching(row: {
  bankAccountId: string;
  description: string;
  payee: string | null;
  memo: string | null;
  reference: string | null;
  amount: string;
  isReviewed: boolean;
  isIgnored: boolean;
  accountingAccountId: string | null;
  appliedRuleId: string | null;
  reconciledAt?: Date | null;
}): TxnForMatching {
  const amount = Number(row.amount);
  return {
    bankAccountId: row.bankAccountId,
    description: row.description,
    payee: row.payee,
    memo: row.memo,
    reference: row.reference,
    amount: Number.isFinite(amount) ? amount : 0,
    isReviewed: row.isReviewed,
    isIgnored: row.isIgnored,
    accountingAccountId: row.accountingAccountId,
    appliedRuleId: row.appliedRuleId,
    reconciled: Boolean(row.reconciledAt),
  };
}

/** Human-readable description of a matched matcher. Used in the "why it
 *  matched" line under the Suggested badge. */
export function describeReason(reason: MatchReason): string {
  const fieldLabel: Record<MatcherField, string> = {
    description: 'Description',
    payee: 'Payee',
    memo: 'Memo',
    reference: 'Reference',
  };
  const opLabel: Record<MatcherOp, string> = {
    contains: 'contains',
    equals: 'equals',
    starts_with: 'starts with',
    regex: 'matches regex',
  };
  return `${fieldLabel[reason.field]} ${opLabel[reason.op]} "${reason.value}"`;
}
