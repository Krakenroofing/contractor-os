// Rule matcher: ALL vs ANY condition combination, plus the triage state's
// honest "auto-filled" classification.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchRule,
  triageState,
  type RuleForMatching,
  type TxnForMatching,
} from './rules';

const baseTxn: TxnForMatching = {
  bankAccountId: 'acct-1',
  description: 'JBR HARDWARE PURCHASE',
  payee: null,
  memo: null,
  reference: null,
  amount: -100,
  isReviewed: false,
  isIgnored: false,
  accountingAccountId: null,
  appliedRuleId: null,
};

function ruleWith(
  overrides: Partial<RuleForMatching>,
): RuleForMatching {
  return {
    id: 'r1',
    name: 'JBR',
    enabled: true,
    priority: 100,
    appliesTo: 'all',
    bankAccountId: null,
    amountMin: null,
    amountMax: null,
    matchers: [],
    actions: {},
    ...overrides,
  };
}

test('ALL mode (default): every condition must hit', () => {
  const rule = ruleWith({
    matchers: [
      { field: 'description', op: 'contains', value: 'JBR' },
      { field: 'description', op: 'contains', value: 'PLUMBING' },
    ],
  });
  // 'PLUMBING' is absent → ALL fails.
  assert.equal(matchRule(baseTxn, rule).matched, false);
});

test('ANY mode: one matching condition is enough (JBR / J B R variants)', () => {
  const rule = ruleWith({
    matchMode: 'any',
    matchers: [
      { field: 'description', op: 'contains', value: 'J B R' },
      { field: 'description', op: 'contains', value: 'JBR' },
    ],
  });
  // 'J B R' misses but 'JBR' hits → ANY matches.
  const res = matchRule(baseTxn, rule);
  assert.equal(res.matched, true);
});

test('ANY mode still fails when no condition hits', () => {
  const rule = ruleWith({
    matchMode: 'any',
    matchers: [
      { field: 'description', op: 'contains', value: 'HOME DEPOT' },
      { field: 'description', op: 'contains', value: 'LOWES' },
    ],
  });
  assert.equal(matchRule(baseTxn, rule).matched, false);
});

test('triage: rule applied WITHOUT a category is not "auto_filled"', () => {
  const txn: TxnForMatching = {
    ...baseTxn,
    appliedRuleId: 'r1',
    accountingAccountId: null,
  };
  assert.equal(triageState(txn, null), 'uncategorized');
});

test('triage: rule applied WITH a category is "auto_filled"', () => {
  const txn: TxnForMatching = {
    ...baseTxn,
    appliedRuleId: 'r1',
    accountingAccountId: 'cat-1',
  };
  assert.equal(triageState(txn, null), 'auto_filled');
});
