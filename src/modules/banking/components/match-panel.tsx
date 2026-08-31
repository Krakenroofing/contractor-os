'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import {
  addReceiptToTransactionAction,
  markInterAccountTransferAction,
  transferToAccountAction,
  matchInvoicePaymentsAction,
  matchInvoiceBalancesAction,
  matchJobCostEntryAction,
  matchOwnerEquityAction,
  matchReceiptAction,
  matchBillsAction,
  matchTransferAction,
  searchInvoicesForMatchAction,
  searchBillsForMatchAction,
  unmatchTransactionAction,
  type InvoiceReconcileSearchResult,
  type BillSearchResult,
} from '../actions';
import { Input } from '@/components/ui/input';
import { directUploadFiles } from '@/lib/storage/direct-upload-client';
import {
  createReceiptUploadUrlsAction,
  uploadReceiptAttachmentAction,
} from '@/modules/receipts/actions';
import type { MatchCandidates } from '../lib/match-candidates';

// File types accepted when attaching a receipt straight from the match panel
// (mirrors the receipt page's uploader).
const RECEIPT_ACCEPT =
  'application/pdf,image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,image/gif';

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
  /** The matched receipt when matchType === 'receipt'. Lets the reconciled
   *  panel keep accepting extra receipt files (and link to the receipt)
   *  without unmatching first. */
  receiptId?: string | null;
};

export type TransferCandidate = {
  id: string;
  accountName: string;
  transactionDate: string;
  description: string;
  amount: number;
  currency: string;
};

/** One invoice payment already matched to this deposit. A lump customer
 *  payment can have several. */
export type ActiveInvoiceMatch = {
  matchId: string;
  invoiceNumber: string;
  customerName: string;
  amount: number;
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
  /** Every OTHER bank/card account — the pick-an-account transfer flow. */
  transferAccounts?: { id: string; name: string }[];
  /** Invoice payments already linked to this deposit (possibly several). */
  invoiceMatches: ActiveInvoiceMatch[];
  /** Bills (vendor receipts / payroll bills) inside this txn's active match —
   *  the reconciled banner lists them: who, bill date, amount, each linking
   *  to its editable detail. */
  billMatches?: Array<{
    matchId: string;
    kind: 'receipt' | 'payroll_bill';
    label: string;
    date: string;
    amount: number;
    href: string;
  }>;
  /** Whether the txn is fully reconciled (reconciled_at set). */
  reconciled: boolean;
  /** Expense accounts (COGS/OpEx) for the bank-fee picker on bill payments. */
  feeAccountOptions?: { id: string; name: string }[];
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
  const [transferAcctId, setTransferAcctId] = useState('');
  const [pickedPairId, setPickedPairId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [invoiceMode, setInvoiceMode] = useState(false);
  const [invoiceQuery, setInvoiceQuery] = useState('');
  const [invoiceResults, setInvoiceResults] = useState<
    InvoiceReconcileSearchResult[]
  >([]);
  const [invoiceSearched, setInvoiceSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  // Multi-select: invoices picked across one or more searches, keyed by
  // invoiceId and carrying the unreconciled amount so the tally survives
  // re-searches that drop a row from view.
  const [selected, setSelected] = useState<
    Map<string, { invoiceNumber: string; unreconciled: number }>
  >(new Map());

  // Amount already linked to this deposit by prior matches.
  const alreadyAllocated = props.invoiceMatches.reduce(
    (s, m) => s + m.amount,
    0,
  );
  const deposit = props.amount;
  // How much of the deposit is still unallocated before this round of ticks.
  const depositOpen = Math.round((deposit - alreadyAllocated) * 100) / 100;
  // Sum of the UNRECONCILED amounts the user has ticked. The amount actually
  // applied is capped at what's left of the deposit (mirrors the server's
  // sequential allocation), so it never over-reconciles.
  const selectedUnreconciledSum = Array.from(selected.values()).reduce(
    (s, v) => s + v.unreconciled,
    0,
  );
  const newlyApplied = Math.min(
    Math.round(selectedUnreconciledSum * 100) / 100,
    depositOpen,
  );
  const liveRemaining = Math.round((depositOpen - newlyApplied) * 100) / 100;

  function toggleSelected(r: InvoiceReconcileSearchResult) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(r.invoiceId)) next.delete(r.invoiceId);
      else
        next.set(r.invoiceId, {
          invoiceNumber: r.invoiceNumber,
          unreconciled: r.unreconciled,
        });
      return next;
    });
  }

  function commitInvoiceMatches() {
    if (selected.size === 0) return;
    setErr(null);
    startTransition(async () => {
      const res = await matchInvoiceBalancesAction({
        transactionId: props.transactionId,
        invoiceIds: Array.from(selected.keys()),
      });
      if (!res.ok) {
        setErr(res.error ?? 'Match failed.');
        return;
      }
      router.refresh();
    });
  }

  function runInvoiceSearch() {
    setErr(null);
    setSearching(true);
    startTransition(async () => {
      const res = await searchInvoicesForMatchAction({
        transactionId: props.transactionId,
        query: invoiceQuery,
      });
      setSearching(false);
      setInvoiceSearched(true);
      if (!res.ok) {
        setErr(res.error);
        setInvoiceResults([]);
        return;
      }
      setInvoiceResults(res.results);
    });
  }

  function resetInvoiceMode() {
    setInvoiceMode(false);
    setInvoiceQuery('');
    setInvoiceResults([]);
    setInvoiceSearched(false);
    setSelected(new Map());
    setErr(null);
  }

  // ----- Batch bill payment (money-out) state -----
  const [billMode, setBillMode] = useState(false);
  const [billQuery, setBillQuery] = useState('');
  const [billDateFrom, setBillDateFrom] = useState('');
  const [billDateTo, setBillDateTo] = useState('');
  const [billSort, setBillSort] = useState<'best' | 'amount-desc' | 'amount-asc' | 'date'>(
    'best',
  );
  const [billResults, setBillResults] = useState<BillSearchResult[]>([]);
  const [billSearched, setBillSearched] = useState(false);
  const [billSelected, setBillSelected] = useState<
    Map<
      string,
      {
        kind: 'receipt' | 'payroll_bill';
        label: string;
        date: string;
        amount: number;
        /** Editable text mirror of `amount` (payroll bills only — partial
         *  payments). Receipts always pay in full. */
        amountText: string;
        /** The bill's outstanding — the cap for a partial payment. */
        max: number;
      }
    >
  >(new Map());
  const [feeAccountId, setFeeAccountId] = useState('');

  const billAbs = Math.round(Math.abs(props.amount) * 100) / 100;
  const billSelectedSum = Array.from(billSelected.values()).reduce(
    (s, v) => s + v.amount,
    0,
  );
  const billRemaining = Math.round((billAbs - billSelectedSum) * 100) / 100;
  // The shortfall becomes the bank fee once a fee account is chosen.
  const billFee = feeAccountId && billRemaining > 0.005 ? billRemaining : 0;
  const billAfterFee = Math.round((billRemaining - billFee) * 100) / 100;

  function toggleBill(r: BillSearchResult) {
    setBillSelected((prev) => {
      const next = new Map(prev);
      if (next.has(r.id)) {
        next.delete(r.id);
        return next;
      }
      // Payroll bills can be paid PARTIALLY: default to what this payment can
      // still cover (never more than the bill's outstanding), so a $100
      // withdrawal against a $1,000 bill starts at 100, not 1,000.
      let amount = r.total;
      if (r.kind === 'payroll_bill') {
        const selectedSum = Array.from(next.values()).reduce(
          (s, v) => s + v.amount,
          0,
        );
        const unallocated = Math.round((billAbs - selectedSum) * 100) / 100;
        if (unallocated > 0.005 && unallocated < r.total) amount = unallocated;
      }
      next.set(r.id, {
        kind: r.kind,
        label: r.label,
        date: r.date,
        amount,
        amountText: amount.toFixed(2),
        max: r.total,
      });
      return next;
    });
  }

  function removeSelectedBill(id: string) {
    setBillSelected((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }

  function setBillAmount(id: string, text: string) {
    setBillSelected((prev) => {
      const next = new Map(prev);
      const cur = next.get(id);
      if (!cur) return prev;
      const parsed = Number(text);
      next.set(id, {
        ...cur,
        amountText: text,
        amount:
          Number.isFinite(parsed) && parsed > 0
            ? Math.round(parsed * 100) / 100
            : 0,
      });
      return next;
    });
  }

  function runBillSearch() {
    setErr(null);
    setSearching(true);
    startTransition(async () => {
      const res = await searchBillsForMatchAction({
        transactionId: props.transactionId,
        query: billQuery,
        dateFrom: billDateFrom || undefined,
        dateTo: billDateTo || undefined,
      });
      setSearching(false);
      setBillSearched(true);
      if (!res.ok) {
        setErr(res.error);
        setBillResults([]);
        return;
      }
      setBillResults(res.results);
    });
  }

  function commitBillMatches() {
    if (billSelected.size === 0) return;
    setErr(null);
    const receiptIds: string[] = [];
    const payrollBills: Array<{ id: string; amount: number }> = [];
    for (const [id, v] of billSelected) {
      if (v.kind === 'payroll_bill') {
        if (!(v.amount > 0)) {
          setErr('Enter an amount for each selected payroll bill.');
          return;
        }
        if (v.amount > v.max + 0.005) {
          setErr(
            `A payroll payment exceeds what's left on the bill ($${fmtMoney(v.max)}).`,
          );
          return;
        }
        payrollBills.push({ id, amount: v.amount });
      } else {
        receiptIds.push(id);
      }
    }
    startTransition(async () => {
      const res = await matchBillsAction({
        transactionId: props.transactionId,
        receiptIds,
        payrollBills,
        feeAccountId: feeAccountId || null,
      });
      if (!res.ok) {
        setErr(res.error ?? 'Match failed.');
        return;
      }
      router.refresh();
    });
  }

  function resetBillMode() {
    setBillMode(false);
    setBillQuery('');
    setBillDateFrom('');
    setBillDateTo('');
    setBillSort('best');
    setBillResults([]);
    setBillSearched(false);
    setBillSelected(new Map());
    setFeeAccountId('');
    setErr(null);
  }

  // Display order for the result list. 'best' keeps the server's ranking
  // (same-amount first, then newest).
  const billResultsSorted =
    billSort === 'best'
      ? billResults
      : [...billResults].sort((a, b) =>
          billSort === 'amount-desc'
            ? b.total - a.total
            : billSort === 'amount-asc'
              ? a.total - b.total
              : b.date.localeCompare(a.date),
        );

  // Add receipt = pick the file(s) right here. Clicking "+ Add receipt" opens
  // the OS file picker; on selection we create the draft receipt (linking +
  // reconciling this line), push the chosen files straight to storage, and
  // attach them — no hop to the receipt page. The attachment count then shows
  // as a paperclip on the transaction row.
  const [receiptUploading, setReceiptUploading] = useState(false);

  // Upload files to storage and attach them to an existing receipt. Shared by
  // the create-new path below and the already-reconciled "+ Add file" path.
  async function uploadFilesToReceipt(receiptId: string, files: File[]) {
    const outcome = await directUploadFiles({
      files,
      requestUrls: createReceiptUploadUrlsAction,
    });
    if (outcome.formError) {
      setErr(outcome.formError);
    } else if (outcome.refs.length > 0) {
      const fd = new FormData();
      fd.set('uploads', JSON.stringify(outcome.refs));
      const fin = await uploadReceiptAttachmentAction(receiptId, {}, fd);
      if (fin.formError) setErr(fin.formError);
    }
    if (!outcome.formError && outcome.failures.length > 0) {
      setErr(outcome.failures.join(' / '));
    }
  }

  async function addReceiptWithFiles(files: File[]) {
    if (files.length === 0) return;
    setErr(null);
    setReceiptUploading(true);
    try {
      const res = await addReceiptToTransactionAction({
        transactionId: props.transactionId,
      });
      if (!res.ok || !res.receiptId) {
        setErr(res.error ?? 'Could not add receipt.');
        return;
      }
      await uploadFilesToReceipt(res.receiptId, files);
      router.refresh();
    } catch {
      setErr(
        'Could not upload the receipt — check your connection and try again.',
      );
    } finally {
      setReceiptUploading(false);
    }
  }

  // Already matched to a receipt: extra files (a second paper receipt, a
  // delivery slip, the card slip) attach to that same receipt — no need to
  // unmatch first.
  async function appendFilesToMatchedReceipt(files: File[]) {
    const receiptId = props.active?.receiptId;
    if (!receiptId || files.length === 0) return;
    setErr(null);
    setReceiptUploading(true);
    try {
      await uploadFilesToReceipt(receiptId, files);
      router.refresh();
    } catch {
      setErr(
        'Could not upload the receipt — check your connection and try again.',
      );
    } finally {
      setReceiptUploading(false);
    }
  }

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
    const matchedReceiptId =
      props.active.matchType === 'receipt' ? props.active.receiptId : null;
    const bills = props.billMatches ?? [];
    const billTotal = bills.reduce((s, b) => s + b.amount, 0);
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="text-emerald-900">
            <span className="font-semibold">Reconciled</span> —{' '}
            {bills.length > 1 ? (
              <>
                {bills.length} bills paid · $
                <span className="tabular-nums">{fmtMoney(billTotal)}</span>
              </>
            ) : matchedReceiptId ? (
              <a
                href={`/banking/receipts/${matchedReceiptId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-emerald-700"
              >
                {props.active.targetLabel}
              </a>
            ) : bills.length === 1 ? (
              <a
                href={bills[0].href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-emerald-700"
              >
                {bills[0].label}
              </a>
            ) : (
              props.active.targetLabel
            )}
          </div>
          <div className="flex items-center gap-2">
            {props.canEdit && matchedReceiptId && (
              <label
                className={`inline-flex items-center justify-center rounded-md border border-emerald-300 bg-white px-2.5 h-7 text-xs font-medium text-emerald-900 hover:bg-emerald-100 focus-within:ring-2 focus-within:ring-emerald-400 ${
                  pending || receiptUploading
                    ? 'opacity-50 pointer-events-none'
                    : 'cursor-pointer'
                }`}
                aria-disabled={pending || receiptUploading}
                title="Attach more receipt files (photos or PDFs) to the matched receipt"
              >
                {receiptUploading ? 'Uploading…' : '+ Add file'}
                <input
                  type="file"
                  accept={RECEIPT_ACCEPT}
                  multiple
                  className="sr-only"
                  disabled={pending || receiptUploading}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    void appendFilesToMatchedReceipt(files);
                  }}
                />
              </label>
            )}
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
        </div>
        {bills.length > 1 && (
          <ul className="mt-1.5 space-y-0.5 border-t border-emerald-200 pt-1.5">
            {bills.map((b) => (
              <li
                key={b.matchId}
                className="flex items-center justify-between gap-2 text-slate-700"
              >
                <span className="min-w-0 truncate">
                  <a
                    href={b.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
                    title={
                      b.kind === 'payroll_bill'
                        ? 'Open the pay run — adjust pay and regenerate bills there'
                        : 'Open this bill'
                    }
                  >
                    {b.label}
                  </a>{' '}
                  <span className="text-slate-400">· {b.date}</span>
                </span>
                <span className="shrink-0 tabular-nums">${fmtMoney(b.amount)}</span>
              </li>
            ))}
          </ul>
        )}
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
        <div className="flex flex-wrap items-center gap-2">
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
        {(props.transferAccounts?.length ?? 0) > 0 && (
          <div className="border-t border-blue-200 pt-2">
            <p className="mb-1 text-blue-800">
              Or just pick the other account — pairs with the matching amount
              there, or creates the entry in that register if the statement
              line isn&apos;t imported yet:
            </p>
            <div className="flex items-center gap-2">
              <div className="w-64">
                <Select
                  value={transferAcctId}
                  onChange={(e) => setTransferAcctId(e.target.value)}
                >
                  <option value="">— pick account —</option>
                  {props.transferAccounts!.map((a) => (
                    <option key={a.id} value={a.id}>
                      ⇄ {a.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={pending || !transferAcctId}
                onClick={() =>
                  runAndRefresh(() =>
                    transferToAccountAction({
                      transactionId: props.transactionId,
                      otherBankAccountId: transferAcctId,
                    }),
                  )
                }
              >
                {pending ? '…' : 'Record transfer'}
              </Button>
            </div>
          </div>
        )}
        <div className="border-t border-blue-200 pt-2">
          <p className="mb-1 text-blue-800">
            Other account not loaded in KrakenOps? Book it as an inter-account
            transfer (balance sheet — kept out of the P&amp;L):
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              runAndRefresh(() =>
                markInterAccountTransferAction({
                  transactionId: props.transactionId,
                }),
              )
            }
          >
            {pending ? '…' : 'It’s an inter-account transfer'}
          </Button>
        </div>
        {err && <p className="text-red-700">{err}</p>}
      </div>
    );
  }

  // ----- Manual invoice match: pick ONE OR MORE invoice payments -----
  if (invoiceMode) {
    const balances = Math.abs(liveRemaining) < 0.005;
    return (
      <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs space-y-2">
        <div className="font-medium text-blue-900">Match deposit to invoices</div>
        <p className="text-blue-800">
          Tick the invoices this deposit pays — including ones already marked
          paid whose payment isn&apos;t on a bank deposit yet. Each is reconciled
          by the lesser of its unreconciled amount and what&apos;s left of the
          deposit; if a deposit only covers part of an invoice, the rest waits
          for a later deposit. Matches regardless of the date gap.
        </p>

        {/* Running tally */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded bg-white px-2 py-1.5">
          <span className="text-slate-600">
            Deposit{' '}
            <span className="font-semibold tabular-nums text-slate-900">
              ${fmtMoney(deposit)}
            </span>
          </span>
          <span className="text-slate-600">
            Allocated{' '}
            <span className="font-semibold tabular-nums text-slate-900">
              ${fmtMoney(alreadyAllocated + newlyApplied)}
            </span>
          </span>
          <span
            className={
              balances ? 'font-semibold text-emerald-700' : 'text-amber-700'
            }
          >
            Remaining{' '}
            <span className="font-semibold tabular-nums">
              ${fmtMoney(liveRemaining)}
            </span>
            {balances ? ' — balances ✓' : ''}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={invoiceQuery}
            onChange={(e) => setInvoiceQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runInvoiceSearch();
              }
            }}
            placeholder="Invoice # or customer name"
            className="h-8 text-xs"
          />
          <Button
            type="button"
            size="sm"
            disabled={pending || searching}
            onClick={runInvoiceSearch}
          >
            {searching ? 'Searching…' : 'Search'}
          </Button>
        </div>

        {invoiceSearched && invoiceResults.length === 0 && !err && (
          <p className="text-slate-600">
            No invoices with an unreconciled amount match that search.
          </p>
        )}

        {invoiceResults.length > 0 && (
          <div className="space-y-1">
            {invoiceResults.map((r) => {
              const checked = selected.has(r.invoiceId);
              const note =
                r.status === 'paid'
                  ? 'marked paid — not on a bank deposit yet'
                  : r.unreconciled < r.total - 0.005
                    ? 'partly reconciled'
                    : 'open balance';
              return (
                <label
                  key={r.invoiceId}
                  className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 ${
                    checked ? 'bg-blue-100' : 'bg-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={checked}
                    onChange={() => toggleSelected(r)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      Invoice {r.invoiceNumber} — {r.customerName} ·{' '}
                      <span className="font-medium tabular-nums">
                        ${fmtMoney(r.unreconciled)}
                      </span>{' '}
                      to reconcile
                    </div>
                    <div className="text-[11px] text-slate-500">
                      invoice ${fmtMoney(r.total)} · {note}{' '}
                      {r.sameAmount && (
                        <span className="inline-block rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[10px]">
                          matches deposit
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            disabled={pending || selected.size === 0}
            onClick={commitInvoiceMatches}
          >
            {pending
              ? 'Matching…'
              : `Match ${selected.size || ''} invoice${
                  selected.size === 1 ? '' : 's'
                }`.trim()}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={resetInvoiceMode}
          >
            Cancel
          </Button>
        </div>
        {err && <p className="text-red-700">{err}</p>}
      </div>
    );
  }

  // ----- Batch bill payment: pick MANY bills + a bank-fee line -----
  if (billMode) {
    const balances = Math.abs(billAfterFee) < 0.005;
    return (
      <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs space-y-2">
        <div className="font-medium text-blue-900">
          Pay bills from this withdrawal
        </div>
        <p className="text-blue-800">
          One payment can settle several bills. Tick bills until the remaining
          balance is $0; any shortfall can be booked as a bank/transaction fee.
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded bg-white px-2 py-1.5">
          <span className="text-slate-600">
            Payment{' '}
            <span className="font-semibold tabular-nums text-slate-900">
              ${fmtMoney(billAbs)}
            </span>
          </span>
          <span className="text-slate-600">
            Bills{' '}
            <span className="font-semibold tabular-nums text-slate-900">
              ${fmtMoney(billSelectedSum)}
            </span>
          </span>
          {billFee > 0 && (
            <span className="text-slate-600">
              Fee{' '}
              <span className="font-semibold tabular-nums text-slate-900">
                ${fmtMoney(billFee)}
              </span>
            </span>
          )}
          <span
            className={
              balances ? 'font-semibold text-emerald-700' : 'text-amber-700'
            }
          >
            Remaining{' '}
            <span className="font-semibold tabular-nums">
              ${fmtMoney(billAfterFee)}
            </span>
            {balances ? ' — balances ✓' : ''}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={billQuery}
            onChange={(e) => setBillQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runBillSearch();
              }
            }}
            placeholder="Vendor / employee name"
            className="h-8 w-44 text-xs"
          />
          <label className="inline-flex items-center gap-1 text-[11px] text-slate-600">
            From
            <Input
              type="date"
              value={billDateFrom}
              onChange={(e) => setBillDateFrom(e.target.value)}
              className="h-8 w-32 text-xs"
            />
          </label>
          <label className="inline-flex items-center gap-1 text-[11px] text-slate-600">
            To
            <Input
              type="date"
              value={billDateTo}
              onChange={(e) => setBillDateTo(e.target.value)}
              className="h-8 w-32 text-xs"
            />
          </label>
          <Button
            type="button"
            size="sm"
            disabled={pending || searching}
            onClick={runBillSearch}
          >
            {searching ? 'Searching…' : 'Search'}
          </Button>
          {billResults.length > 1 && (
            <label className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-600">
              Sort
              <select
                value={billSort}
                onChange={(e) =>
                  setBillSort(e.target.value as typeof billSort)
                }
                className="h-8 rounded-md border border-slate-300 bg-white px-1.5 text-xs"
              >
                <option value="best">Best match</option>
                <option value="amount-desc">Amount ↓</option>
                <option value="amount-asc">Amount ↑</option>
                <option value="date">Newest first</option>
              </select>
            </label>
          )}
        </div>

        {billSelected.size > 0 && (
          <div className="rounded border border-blue-300 bg-white px-2 py-1.5">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Selected — {billSelected.size} bill
              {billSelected.size === 1 ? '' : 's'} · $
              {fmtMoney(billSelectedSum)}
            </p>
            <ul className="space-y-1">
              {Array.from(billSelected.entries()).map(([id, v]) => (
                <li key={id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {v.label}{' '}
                    <span className="text-slate-400">· {v.date}</span>
                  </span>
                  {v.kind === 'payroll_bill' ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="text-[11px] text-slate-500">Pay $</span>
                      <Input
                        value={v.amountText}
                        onChange={(e) => setBillAmount(id, e.target.value)}
                        className="h-7 w-24 text-right text-xs tabular-nums"
                        inputMode="decimal"
                        title={`Amount of this payment to apply — up to $${fmtMoney(v.max)} outstanding. Paying less keeps the rest of the bill open.`}
                      />
                    </span>
                  ) : (
                    <span className="shrink-0 tabular-nums">
                      ${fmtMoney(v.amount)}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${v.label}`}
                    onClick={() => removeSelectedBill(id)}
                    className="shrink-0 rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {billSearched && billResults.length === 0 && !err && (
          <p className="text-slate-600">
            No unmatched posted bills found. Try a different search.
          </p>
        )}

        {billResults.length > 0 && (
          <div className="space-y-1">
            {billResultsSorted.map((r) => {
              const checked = billSelected.has(r.id);
              return (
                <label
                  key={r.id}
                  className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 ${
                    checked ? 'bg-blue-100' : 'bg-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={checked}
                    onChange={() => toggleBill(r)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      {r.label} · ${fmtMoney(r.total)}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {r.date}{' '}
                      {r.sameAmount && (
                        <span className="inline-block rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[10px]">
                          same amount
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        {billRemaining > 0.005 && (props.feeAccountOptions?.length ?? 0) > 0 && (
          <div className="rounded bg-white px-2 py-1.5 space-y-1">
            <p className="text-[11px] text-slate-600">
              Book the ${fmtMoney(billRemaining)} difference as a bank fee:
            </p>
            <Select
              value={feeAccountId}
              onChange={(e) => setFeeAccountId(e.target.value)}
              className="h-8 text-xs"
            >
              <option value="">— No fee (match exact only) —</option>
              {props.feeAccountOptions!.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            disabled={pending || billSelected.size === 0}
            onClick={commitBillMatches}
          >
            {pending
              ? 'Matching…'
              : `Pay ${billSelected.size || ''} bill${
                  billSelected.size === 1 ? '' : 's'
                }`.trim()}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={resetBillMode}
          >
            Cancel
          </Button>
        </div>
        {err && <p className="text-red-700">{err}</p>}
      </div>
    );
  }

  // ----- Deposit already linked to invoice(s): reconciled or partial -----
  if (props.invoiceMatches.length > 0) {
    const fullyMatchedRemaining =
      Math.round((deposit - alreadyAllocated) * 100) / 100;
    const isPartial = !props.reconciled;
    return (
      <div
        className={`rounded-md border px-3 py-2 text-xs ${
          isPartial
            ? 'border-amber-200 bg-amber-50'
            : 'border-emerald-200 bg-emerald-50'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className={isPartial ? 'text-amber-900' : 'text-emerald-900'}>
            <span className="font-semibold">
              {isPartial ? 'Partially matched' : 'Reconciled'}
            </span>{' '}
            — {props.invoiceMatches.length} invoice
            {props.invoiceMatches.length === 1 ? '' : 's'}
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
        <ul className="mt-1 space-y-0.5">
          {props.invoiceMatches.map((m) => (
            <li
              key={m.matchId}
              className="flex items-center justify-between gap-2 text-slate-700"
            >
              <span className="truncate">
                Invoice {m.invoiceNumber} — {m.customerName}
              </span>
              <span className="tabular-nums">${fmtMoney(m.amount)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-1 flex items-center justify-between gap-2 border-t border-slate-200 pt-1">
          <span className="text-slate-600">
            Allocated{' '}
            <span className="font-medium tabular-nums">
              ${fmtMoney(alreadyAllocated)}
            </span>{' '}
            of ${fmtMoney(deposit)}
          </span>
          {isPartial && (
            <span className="font-medium tabular-nums text-amber-700">
              ${fmtMoney(fullyMatchedRemaining)} left
            </span>
          )}
        </div>
        {isPartial && props.canEdit && (
          <div className="mt-1">
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => {
                setErr(null);
                setInvoiceMode(true);
              }}
            >
              Match more invoices…
            </Button>
          </div>
        )}
        {err && <p className="mt-1 text-red-700">{err}</p>}
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
                      matchInvoicePaymentsAction({
                        transactionId: props.transactionId,
                        invoicePaymentIds: [m.candidate.id],
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
              onClick={() => {
                setErr(null);
                setInvoiceMode(true);
              }}
            >
              Match to invoice…
            </Button>
          )}
          {moneyOut && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setErr(null);
                setBillMode(true);
              }}
            >
              Match to bills…
            </Button>
          )}
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
          {moneyOut && (
            <label
              className={`inline-flex items-center justify-center gap-1 rounded-md bg-slate-900 text-white text-sm font-medium px-3 h-8 hover:bg-slate-800 focus-within:ring-2 focus-within:ring-slate-400 focus-within:ring-offset-2 ${
                pending || receiptUploading
                  ? 'opacity-50 pointer-events-none'
                  : 'cursor-pointer'
              }`}
              aria-disabled={pending || receiptUploading}
              title="Pick a receipt file (PDF or photo) to attach to this transaction"
            >
              {receiptUploading ? 'Uploading…' : '+ Add receipt'}
              <input
                type="file"
                accept={RECEIPT_ACCEPT}
                multiple
                className="sr-only"
                disabled={pending || receiptUploading}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  void addReceiptWithFiles(files);
                }}
              />
            </label>
          )}
        </div>
      )}

      {err && <p className="text-red-700">{err}</p>}
    </div>
  );
}
