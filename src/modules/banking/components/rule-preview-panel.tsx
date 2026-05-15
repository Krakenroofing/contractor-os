'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  bulkApplyRuleAction,
  previewRuleMatchesAction,
  type PreviewMatch,
} from '../actions';
import { describeReason } from '../lib/rules';

// Preview "what would this saved rule match?" + Bulk apply. Lives on the
// rule edit page so the operator has to save the rule before exercising it
// at scale.
export function RulePreviewPanel({
  ruleId,
  canApply,
}: {
  ruleId: string;
  canApply: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<{
    matches: PreviewMatch[];
    totalHits: number;
    scanned: number;
    truncated: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{
    applied: number;
    skipped: number;
    scanned: number;
  } | null>(null);

  async function onPreview() {
    setError(null);
    setLoadingPreview(true);
    setResult(null);
    const res = await previewRuleMatchesAction({ ruleId });
    setLoadingPreview(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPreview({
      matches: res.matches,
      totalHits: res.totalHits,
      scanned: res.scanned,
      truncated: res.truncated,
    });
  }

  function onBulkApply() {
    setError(null);
    setConfirming(false);
    startTransition(async () => {
      const res = await bulkApplyRuleAction({ ruleId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({
        applied: res.applied,
        skipped: res.skipped,
        scanned: res.scanned,
      });
      // Re-preview so the panel reflects post-apply state (matched rows
      // are now reviewed-or-categorized and may disappear from triage list).
      await onPreview();
      router.refresh();
    });
  }

  const triagableCount = preview
    ? preview.matches.filter((m) => true).length
    : 0;
  void triagableCount; // matches list is already filtered by listRecentTransactionsForRules in the bulk path; preview shows all hits regardless

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onPreview}
          disabled={loadingPreview}
        >
          {loadingPreview ? 'Scanning…' : 'Preview matches (last 500 txns)'}
        </Button>
        {canApply && preview && preview.totalHits > 0 && (
          <Button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending}
          >
            {pending ? 'Applying…' : `Apply to all matching (${preview.totalHits})`}
          </Button>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {result && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 space-y-0.5">
          <div className="font-medium">
            Applied to {result.applied} transaction(s).
          </div>
          {result.skipped > 0 && (
            <div className="text-emerald-800">
              {result.skipped} skipped — they were reviewed or categorized
              between scan and apply.
            </div>
          )}
        </div>
      )}

      {preview && (
        <div className="rounded-md border border-slate-200 bg-white">
          <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between text-xs">
            <div>
              <span className="font-medium text-slate-900">
                {preview.totalHits}
              </span>{' '}
              match(es) in last {preview.scanned} transactions
              {preview.truncated && (
                <>
                  {' '}
                  <span className="text-slate-500">
                    (showing first {preview.matches.length})
                  </span>
                </>
              )}
            </div>
          </div>
          {preview.matches.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No matches. Try loosening the conditions or check the rule&apos;s
              account / debit-credit filter.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Why</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.matches.map((m) => (
                  <TableRow key={m.transactionId}>
                    <TableCell className="text-xs font-mono">
                      {m.transactionDate}
                    </TableCell>
                    <TableCell className="text-sm">{m.description}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {Number(m.amount).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {m.reasons.map(describeReason).join(' · ')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {confirming && preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-md shadow-xl max-w-lg w-full p-5 space-y-3">
            <h3 className="text-base font-semibold">Bulk apply</h3>
            <p className="text-sm text-slate-700">
              This will auto-fill category, project, cost code, and notes on{' '}
              <span className="font-semibold">
                {preview.totalHits} transaction(s)
              </span>
              . Already-reviewed or already-categorized rows are skipped. No
              postings to job costing happen — Phase 1 contract.
            </p>
            {preview.matches.length > 0 && (
              <div className="bg-slate-50 rounded p-2 text-xs space-y-1 max-h-32 overflow-y-auto">
                {preview.matches.slice(0, 3).map((m) => (
                  <div key={m.transactionId} className="truncate">
                    {m.transactionDate} · {m.description}
                  </div>
                ))}
                {preview.matches.length > 3 && (
                  <div className="text-slate-500">
                    …and {preview.totalHits - 3} more
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button type="button" onClick={onBulkApply} disabled={pending}>
                {pending ? 'Applying…' : 'Apply'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
