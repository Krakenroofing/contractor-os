'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  applyRuleAction,
  markTransactionReviewedAction,
} from '../actions';
import {
  describeReason,
  type MatchReason,
  type TxnTriageState,
} from '../lib/rules';

export type TransactionRulePanelProps = {
  transactionId: string;
  triage: TxnTriageState;
  match: {
    ruleId: string;
    ruleName: string;
    reasons: MatchReason[];
  } | null;
  appliedRule: { id: string; name: string } | null;
  canApply: boolean;
  canReview: boolean;
  canCreateRule: boolean;
};

// Per-row badge + action row. Three visual states drive copy/color:
//   - suggested        → blue, with [Apply] button + "Why?" reasons
//   - auto_filled      → purple, "auto-filled by rule X — awaiting review"
//                        + [Mark reviewed]
//   - manually_categorized / reviewed → slate, with [Create rule from this]
// Other states (uncategorized / ignored) render nothing here.
export function TransactionRulePanel(props: TransactionRulePanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onApply() {
    if (!props.match) return;
    const ruleId = props.match.ruleId;
    startTransition(async () => {
      const res = await applyRuleAction({
        transactionId: props.transactionId,
        ruleId,
      });
      if (!res.ok && res.error) {
        alert(res.error);
      }
      router.refresh();
    });
  }

  function onMarkReviewed() {
    startTransition(async () => {
      const res = await markTransactionReviewedAction({
        id: props.transactionId,
        reviewed: true,
      });
      if (!res.ok && res.error) alert(res.error);
      router.refresh();
    });
  }

  if (props.triage === 'suggested' && props.match && props.canApply) {
    return (
      <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium text-blue-900">
            Suggested by rule:{' '}
            <span className="font-semibold">{props.match.ruleName}</span>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={onApply}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {pending ? '…' : 'Apply suggestion'}
          </Button>
        </div>
        <ul className="text-blue-800 list-disc pl-4">
          {props.match.reasons.map((r, i) => (
            <li key={i}>{describeReason(r)}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (props.triage === 'auto_filled' && props.appliedRule) {
    return (
      <div className="rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="text-purple-900">
            Auto-filled by rule:{' '}
            <span className="font-semibold">{props.appliedRule.name}</span>{' '}
            <span className="text-purple-700">— awaiting review</span>
          </div>
          {props.canReview && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={onMarkReviewed}
            >
              {pending ? '…' : 'Mark reviewed'}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (
    (props.triage === 'manually_categorized' || props.triage === 'reviewed') &&
    props.canCreateRule
  ) {
    return (
      <div className="flex items-center justify-end gap-2 text-xs">
        {props.triage === 'manually_categorized' && props.canReview && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={onMarkReviewed}
          >
            {pending ? '…' : 'Mark reviewed'}
          </Button>
        )}
        <Link
          href={{
            pathname: '/banking/rules/new',
            query: { fromTxn: props.transactionId },
          }}
          className="text-slate-600 underline hover:text-slate-900"
        >
          Create rule from this
        </Link>
      </div>
    );
  }

  return null;
}
