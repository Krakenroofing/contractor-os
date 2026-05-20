'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import {
  matchInvoicePaymentAction,
  matchJobCostEntryAction,
  matchOwnerEquityAction,
  matchReceiptAction,
  matchTransferAction,
  unmatchTransactionAction,
} from '../actions';
import type { MatchCandidates } from '../lib/match-candidates';

export type ActiveMatchInfo = {
  matchId: string;
  matchType:
    | 'invoice_payment'
    | 'receipt'
    | 'job_cost_entry'
    | 'transfer'
    | 'owner_contribution'
    | 'owner_draw';
  /** Short human label, e.g. "Invoice #103 — Acme Corp $5,000". Built by the
   *  caller from the matched record so we don't need an extra fetch here. */
  targetLabel: string;
};

export type TransferCandidate = {
  id: string;
  accountName: string;
  transactionDate: string;
  description: string;
  amount: number;
  currency: string;
};

export type MatchPanelProps = {
  transactionId: string;
  bankAccountId: string;
  /** Signed amount on the bank txn: positive = money in. Drives which actions
   *  are available (e.g. owner contribution vs owner draw). */
  amount: number;
  candidates: MatchCandidates;
  transferCandidates: TransferCandidate[];
  active: ActiveMatchInfo | null;
  canEdit: boolean;
};

function confidenceBadge(confidence: 'exact' | 'high' | 'low') {
  const cls =
    confidence === 'exact'
      ? 'bg-emerald-100 text-emerald-800'
      : confidence === 'high'
        ? 'bg-blue-100 text-blue-800'
        : 'bg-slate-200 text-slate-700';
  return (
    <span className={`inline-block rounded ${cls} px-1.5 py-0.5 text-[10px]`}>
      {confidence}
    </span>
  );
}

function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function MatchPanel(props: MatchPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [transferMode, setTransferMode] = useState(false);
  const [pickedPairId, setPickedPairId] = useState('');
  const [err, setErr] = useState<string | null>(null);

  function runAndRefresh(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setErr(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setErr(res.error ?? 'Action failed.');
        return;
      }
      router.refresh();
    });
  }

  // ----- Reconciled state -----
  if (props.active) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="text-emerald-900">
            <span className="font-semibold">Reconciled</span> —{' '}
            {props.active.targetLabel}
          </div>
          {props.canEdit && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                runAndRefresh(() =>
                  unmatchTransactionAction({
                    transactionId: props.transactionId,
                  }),
                )
              }
            >
              {pending ? '…' : 'Unmatch'}
            </Button>
          )}
        </div>
        {err && <p className="mt-1 text-red-700">{err}</p>}
      </div>
    );
  }

  // ----- Transfer pick UI -----
  if (transferMode) {
    return (
      <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs space-y-2">
        <div className="font-medium text-blue-900">Pair with a transfer</div>
        <p className="text-blue-800">
          Pick a transaction from another bank account with the opposite
          amount, within ±7 days.
        </p>
        {props.transferCandidates.length === 0 ? (
          <p className="text-slate-600">
            No transfer-shaped candidates found. Cancel and try matching
            another way.
          </p>
        ) : (
          <div className="space-y-1">
            <Select
              value={pickedPairId}
              onChange={(e) => setPickedPairId(e.target.value)}
            >
              <option value="">— pick a candidate —</option>
              {props.transferCandidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.accountName} · {c.transactionDate} · ${fmtMoney(
                    Math.abs(c.amount),
                  )}{' '}
                  · {c.description.slice(0, 50)}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={pending || !pickedPairId}
            onClick={() =>
              runAndRefresh(() =>
                matchTransferAction({
                  transactionId: props.transactionId,
                  pairedTransactionId: pickedPairId,
                }),
              )
            }
          >
            {pending ? 'Pairing…' : 'Mark as transfer'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setTransferMode(false);
              setPickedPairId('');
              setErr(null);
            }}
          >
            Cancel
          </Button>
        </div>
        {err && <p className="text-red-700">{err}</p>}
      </div>
    );
  }

  // ----- Default: show candidates + action buttons -----
  const moneyIn = props.amount > 0;
  const moneyOut = props.amount < 0;
  const hasAny =
    props.candidates.invoicePayments.length > 0 ||
    props.candidates.receipts.length > 0 ||
    props.candidates.jobCostEntries.length > 0;

  if (!props.canEdit && !hasAny) return null;

  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium text-slate-700">Possible matches</span>
      </div>

      {moneyIn && props.candidates.invoicePayments.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Invoice payments
          </p>
          {props.candidates.invoicePayments.map((m) => (
            <div
              key={m.candidate.id}
              className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  Invoice {m.candidate.invoiceNumber} — {m.candidate.customerName} · ${fmtMoney(m.candidate.amount)}
                </div>
                <div className="text-[11px] text-slate-500">
                  {m.candidate.paidDate} ({m.dateDelta}d){' '}
                  {confidenceBadge(m.confidence)}
                </div>
              </div>
              {props.canEdit && (
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    runAndRefresh(() =>
                      matchInvoicePaymentAction({
                        transactionId: props.transactionId,
                        invoicePaymentId: m.candidate.id,
                        confidence: m.confidence,
                      }),
                    )
                  }
                >
                  Match
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {moneyOut && props.candidates.receipts.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Posted receipts
          </p>
          {props.candidates.receipts.map((m) => (
            <div
              key={m.candidate.id}
              className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  {m.candidate.vendorName} · ${fmtMoney(m.candidate.amount)}{' '}
                  — {m.candidate.description.slice(0, 60)}
                </div>
                <div className="text-[11px] text-slate-500">
                  {m.candidate.receiptDate} ({m.dateDelta}d){' '}
                  {confidenceBadge(m.confidence)}
                </div>
              </div>
              {props.canEdit && (
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    runAndRefresh(() =>
                      matchReceiptAction({
                        transactionId: props.transactionId,
                        receiptId: m.candidate.id,
                        confidence: m.confidence,
                      }),
                    )
                  }
                >
                  Match
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {props.candidates.jobCostEntries.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Job cost entries
          </p>
          {props.candidates.jobCostEntries.map((m) => (
            <div
              key={m.candidate.id}
              className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  {m.candidate.projectName
                    ? `${m.candidate.projectName}: `
                    : ''}
                  {m.candidate.description.slice(0, 70)} · ${fmtMoney(
                    m.candidate.amount,
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  {m.candidate.entryDate} ({m.dateDelta}d){' '}
                  {confidenceBadge(m.confidence)}
                </div>
              </div>
              {props.canEdit && (
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    runAndRefresh(() =>
                      matchJobCostEntryAction({
                        transactionId: props.transactionId,
                        jobCostEntryId: m.candidate.id,
                        confidence: m.confidence,
                      }),
                    )
                  }
                >
                  Match
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {!hasAny && props.canEdit && (
        <p className="text-slate-500">
          No suggested matches within ±7 days. Use the manual actions below.
        </p>
      )}

      {props.canEdit && (
        <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-slate-200">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setTransferMode(true)}
          >
            Mark as transfer
          </Button>
          {moneyIn && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                runAndRefresh(() =>
                  matchOwnerEquityAction({
                    transactionId: props.transactionId,
                    kind: 'owner_contribution',
                  }),
                )
              }
            >
              Owner contribution
            </Button>
          )}
          {moneyOut && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                runAndRefresh(() =>
                  matchOwnerEquityAction({
                    transactionId: props.transactionId,
                    kind: 'owner_draw',
                  }),
                )
              }
            >
              Owner draw
            </Button>
          )}
        </div>
      )}

      {err && <p className="text-red-700">{err}</p>}
    </div>
  );
}
