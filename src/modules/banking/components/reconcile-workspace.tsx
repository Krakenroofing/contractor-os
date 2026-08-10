'use client';

// The reconciliation workspace: QB-style summary math up top (beginning −
// payments + deposits = cleared balance vs statement ending balance →
// difference), checkbox-per-row below. Checkbox state is optimistic — the
// server action runs in the background and the row set is authoritative on
// the next server render; Finish re-verifies everything server-side anyway.

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  AccountingAccountPicker,
  type AccountingAccountOption,
} from '@/modules/accounting/components/accounting-account-picker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney } from '@/lib/money';
import { useActionState } from 'react';
import {
  addManualTransactionAction,
  cancelReconciliationAction,
  deleteManualTransactionAction,
  finishReconciliationAction,
  setAllClearedAction,
  toggleClearedAction,
  updateManualTransactionAction,
  updateReconciliationInfoAction,
  type ReconcileActionState,
} from '../reconcile-actions';

export type ReconcileTxnRow = {
  id: string;
  date: string;
  description: string;
  payee: string | null;
  reference: string | null;
  categoryName: string | null;
  /** Signed: positive = deposit, negative = payment. */
  amount: number;
  cleared: boolean;
  /** Hand-entered via "Add missing transaction" — editable/deletable.
   *  Imported statement rows mirror the bank and are not. */
  manual: boolean;
};

export type ReconcileOption = { id: string; label: string };

export function ReconcileWorkspace({
  reconciliationId,
  accountName,
  currency,
  statementDate,
  beginningBalance,
  endingBalance,
  completed,
  rows,
  accountOptions,
  vendorOptions,
  projectOptions,
}: {
  reconciliationId: string;
  accountName: string;
  currency: string;
  statementDate: string;
  beginningBalance: number;
  endingBalance: number;
  completed: boolean;
  rows: ReconcileTxnRow[];
  /** Grouped accounting categories for the add-transaction form. */
  accountOptions: AccountingAccountOption[];
  vendorOptions: ReconcileOption[];
  projectOptions: ReconcileOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Optimistic cleared state, seeded from the server rows.
  const [clearedById, setClearedById] = useState<Map<string, boolean>>(
    () => new Map(rows.map((r) => [r.id, r.cleared])),
  );
  const [showEditInfo, setShowEditInfo] = useState(false);
  const [showAddTxn, setShowAddTxn] = useState(false);
  /** Manual row currently open in the inline editor, if any. */
  const [editTxn, setEditTxn] = useState<ReconcileTxnRow | null>(null);

  const totals = useMemo(() => {
    let deposits = 0;
    let payments = 0;
    let clearedCount = 0;
    for (const r of rows) {
      if (!(clearedById.get(r.id) ?? r.cleared)) continue;
      clearedCount += 1;
      if (r.amount > 0) deposits += r.amount;
      else payments += -r.amount;
    }
    deposits = Math.round(deposits * 100) / 100;
    payments = Math.round(payments * 100) / 100;
    const clearedBalance =
      Math.round((beginningBalance + deposits - payments) * 100) / 100;
    const difference =
      Math.round((endingBalance - clearedBalance) * 100) / 100;
    return { deposits, payments, clearedBalance, difference, clearedCount };
  }, [rows, clearedById, beginningBalance, endingBalance]);

  const balanced = Math.abs(totals.difference) < 0.005;

  function toggle(row: ReconcileTxnRow) {
    if (completed) return;
    const next = !(clearedById.get(row.id) ?? row.cleared);
    setClearedById((m) => new Map(m).set(row.id, next));
    setError(null);
    startTransition(async () => {
      const res = await toggleClearedAction(reconciliationId, row.id, next);
      if (res.formError) {
        setError(res.formError);
        setClearedById((m) => new Map(m).set(row.id, !next));
      }
    });
  }

  function setAll(cleared: boolean) {
    if (completed) return;
    setClearedById(new Map(rows.map((r) => [r.id, cleared])));
    setError(null);
    startTransition(async () => {
      const res = await setAllClearedAction(reconciliationId, cleared);
      if (res.formError) setError(res.formError);
    });
  }

  function finish() {
    setError(null);
    startTransition(async () => {
      const res = await finishReconciliationAction(reconciliationId);
      if (res?.formError) setError(res.formError);
    });
  }

  function cancel() {
    if (
      !confirm(
        'Cancel this reconciliation?\n\nNothing is deleted — every transaction is released back to uncleared and the statement info is discarded.',
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await cancelReconciliationAction(reconciliationId);
      if (res?.formError) setError(res.formError);
    });
  }

  return (
    <div className="space-y-4">
      {/* ===== Summary math ===== */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <SummaryStat
              label="Beginning balance"
              value={formatMoney(beginningBalance, currency)}
            />
            <span className="text-slate-400">−</span>
            <SummaryStat
              label={`${rows.filter((r) => (clearedById.get(r.id) ?? r.cleared) && r.amount < 0).length} payments`}
              value={formatMoney(totals.payments, currency)}
            />
            <span className="text-slate-400">+</span>
            <SummaryStat
              label={`${rows.filter((r) => (clearedById.get(r.id) ?? r.cleared) && r.amount > 0).length} deposits`}
              value={formatMoney(totals.deposits, currency)}
            />
            <span className="text-slate-400">=</span>
            <SummaryStat
              label="Cleared balance"
              value={formatMoney(totals.clearedBalance, currency)}
            />
            <span className="text-slate-400">vs</span>
            <SummaryStat
              label={`Statement ending (${statementDate})`}
              value={formatMoney(endingBalance, currency)}
            />
            <div
              className={`ml-auto rounded-md px-4 py-2 text-right ${
                balanced
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-800'
              }`}
            >
              <div className="text-[11px] uppercase tracking-wide">
                Difference
              </div>
              <div className="text-lg font-semibold tabular-nums">
                {formatMoney(totals.difference, currency)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== Toolbar ===== */}
      {!completed && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={finish} disabled={!balanced || pending}>
            {balanced ? 'Finish reconciliation' : 'Difference must be 0.00'}
          </Button>
          <Button variant="outline" onClick={() => setAll(true)} disabled={pending}>
            Check all
          </Button>
          <Button variant="outline" onClick={() => setAll(false)} disabled={pending}>
            Uncheck all
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setShowAddTxn((v) => !v);
              setShowEditInfo(false);
            }}
          >
            + Add missing transaction
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setShowEditInfo((v) => !v);
              setShowAddTxn(false);
            }}
          >
            Edit statement info
          </Button>
          <Button
            variant="outline"
            onClick={cancel}
            disabled={pending}
            className="text-red-600 hover:text-red-700 ml-auto"
          >
            Cancel reconciliation
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {showEditInfo && !completed && (
        <EditInfoForm
          reconciliationId={reconciliationId}
          statementDate={statementDate}
          beginningBalance={beginningBalance}
          endingBalance={endingBalance}
          onDone={() => setShowEditInfo(false)}
        />
      )}

      {showAddTxn && !completed && (
        <AddTxnForm
          reconciliationId={reconciliationId}
          statementDate={statementDate}
          accountOptions={accountOptions}
          vendorOptions={vendorOptions}
          projectOptions={projectOptions}
          onDone={() => setShowAddTxn(false)}
        />
      )}

      {editTxn && !completed && (
        <EditTxnForm
          key={editTxn.id}
          txn={editTxn}
          statementDate={statementDate}
          onDone={() => setEditTxn(null)}
        />
      )}

      {/* ===== Transactions ===== */}
      <Card>
        <CardHeader>
          <CardTitle>
            {accountName} — {rows.length} transaction
            {rows.length === 1 ? '' : 's'} on or before {statementDate} (
            {totals.clearedCount} cleared)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No transactions for this account on or before the statement date.
              Import the statement first, or add missing entries manually.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-center">✓</TableHead>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="w-24">Ref</TableHead>
                  <TableHead className="text-right w-32">Payment</TableHead>
                  <TableHead className="text-right w-32">Deposit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const cleared = clearedById.get(r.id) ?? r.cleared;
                  return (
                    <TableRow
                      key={r.id}
                      className={cleared ? '' : 'opacity-60'}
                    >
                      <TableCell className="text-center">
                        <input
                          type="checkbox"
                          checked={cleared}
                          disabled={completed || pending}
                          onChange={() => toggle(r)}
                          className="h-4 w-4 accent-emerald-700 cursor-pointer"
                          aria-label={cleared ? 'Uncheck' : 'Check'}
                        />
                      </TableCell>
                      <TableCell className="tabular-nums text-slate-700">
                        {r.date}
                      </TableCell>
                      <TableCell className="max-w-md truncate">
                        <Link
                          href={{ pathname: `/banking/transactions/${r.id}` }}
                          target="_blank"
                          className="hover:underline"
                          title="Open transaction"
                        >
                          {r.payee || r.description}
                        </Link>
                        {r.manual && (
                          <span className="ml-2 inline-flex items-center gap-1">
                            <span className="text-[10px] uppercase tracking-wide text-slate-400">
                              manual
                            </span>
                            {!completed && (
                              <button
                                type="button"
                                onClick={() => {
                                  setShowAddTxn(false);
                                  setShowEditInfo(false);
                                  setEditTxn(r);
                                }}
                                className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                                title="Edit this manual entry (fix amount / direction / date)"
                              >
                                ✎ Edit
                              </button>
                            )}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {r.categoryName ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {r.reference ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.amount < 0 ? formatMoney(-r.amount, currency) : ''}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700">
                        {r.amount > 0 ? formatMoney(r.amount, currency) : ''}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums text-slate-900">
        {value}
      </div>
    </div>
  );
}

function EditInfoForm({
  reconciliationId,
  statementDate,
  beginningBalance,
  endingBalance,
  onDone,
}: {
  reconciliationId: string;
  statementDate: string;
  beginningBalance: number;
  endingBalance: number;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    ReconcileActionState,
    FormData
  >(async (prev, fd) => {
    const res = await updateReconciliationInfoAction(prev, fd);
    if (res.ok) onDone();
    return res;
  }, {});
  return (
    <Card>
      <CardContent className="py-4">
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="reconciliationId" value={reconciliationId} />
          <div className="space-y-1.5">
            <Label htmlFor="edit-beginning">Beginning balance</Label>
            <Input
              id="edit-beginning"
              name="beginningBalance"
              inputMode="decimal"
              defaultValue={beginningBalance.toFixed(2)}
              className="w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-ending">Statement ending balance</Label>
            <Input
              id="edit-ending"
              name="endingBalance"
              inputMode="decimal"
              defaultValue={endingBalance.toFixed(2)}
              className="w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-date">Statement ending date</Label>
            <Input
              id="edit-date"
              name="statementDate"
              type="date"
              defaultValue={statementDate}
              className="w-44"
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" variant="outline" onClick={onDone}>
            Close
          </Button>
          {state.formError && (
            <p className="text-sm text-red-600 w-full">{state.formError}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function EditTxnForm({
  txn,
  statementDate,
  onDone,
}: {
  txn: ReconcileTxnRow;
  statementDate: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    ReconcileActionState,
    FormData
  >(async (prev, fd) => {
    const res = await updateManualTransactionAction(prev, fd);
    if (res.ok) onDone();
    return res;
  }, {});
  const [deleting, startDeleting] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function remove() {
    if (
      !confirm(
        `Delete the manual entry "${txn.description}" (${Math.abs(txn.amount).toFixed(2)})?\n\nUse this when it duplicates an imported statement row.`,
      )
    ) {
      return;
    }
    setDeleteError(null);
    startDeleting(async () => {
      const res = await deleteManualTransactionAction(txn.id);
      if (res.formError) {
        setDeleteError(res.formError);
        return;
      }
      onDone();
    });
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-2">
        <p className="text-xs text-slate-500">
          Editing the manual entry <b>{txn.description}</b> — fix the amount,
          flip money in/out, or correct the date. Imported statement rows
          can&apos;t be edited (they mirror the bank).
        </p>
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="transactionId" value={txn.id} />
          <div className="space-y-1.5">
            <Label htmlFor="edit-txn-date">Date</Label>
            <Input
              id="edit-txn-date"
              name="transactionDate"
              type="date"
              max={statementDate}
              defaultValue={txn.date}
              required
              className="w-44"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-txn-desc">Description</Label>
            <Input
              id="edit-txn-desc"
              name="description"
              defaultValue={txn.description}
              required
              className="w-64"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-txn-direction">Type</Label>
            <select
              id="edit-txn-direction"
              name="direction"
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
              defaultValue={txn.amount < 0 ? 'out' : 'in'}
            >
              <option value="out">Money out (payment)</option>
              <option value="in">Money in (deposit)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-txn-amount">Amount</Label>
            <Input
              id="edit-txn-amount"
              name="amount"
              inputMode="decimal"
              defaultValue={Math.abs(txn.amount).toFixed(2)}
              required
              className="w-32"
            />
          </div>
          <Button type="submit" disabled={pending || deleting}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={remove}
            disabled={pending || deleting}
            className="text-red-600 hover:text-red-700"
          >
            {deleting ? 'Deleting…' : 'Delete entry'}
          </Button>
          <Button type="button" variant="outline" onClick={onDone}>
            Close
          </Button>
          {(state.formError || deleteError) && (
            <p className="text-sm text-red-600 w-full">
              {state.formError ?? deleteError}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function AddTxnForm({
  reconciliationId,
  statementDate,
  accountOptions,
  vendorOptions,
  projectOptions,
  onDone,
}: {
  reconciliationId: string;
  statementDate: string;
  accountOptions: AccountingAccountOption[];
  vendorOptions: ReconcileOption[];
  projectOptions: ReconcileOption[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    ReconcileActionState,
    FormData
  >(async (prev, fd) => {
    const res = await addManualTransactionAction(prev, fd);
    if (res.ok) onDone();
    return res;
  }, {});
  const [categoryId, setCategoryId] = useState('');
  return (
    <Card>
      <CardContent className="py-4 space-y-2">
        <p className="text-xs text-slate-500">
          On the statement but missing from the import? Add it here — it&apos;s
          checked into this reconciliation. Category, payee, and job are
          optional: set the category now to skip the review queue, or leave
          everything blank and categorize later like any imported row.
        </p>
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="reconciliationId" value={reconciliationId} />
          <div className="space-y-1.5">
            <Label htmlFor="add-date">Date</Label>
            <Input
              id="add-date"
              name="transactionDate"
              type="date"
              max={statementDate}
              required
              className="w-44"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-desc">Description</Label>
            <Input
              id="add-desc"
              name="description"
              placeholder="e.g. Wire fee — CIBC"
              required
              className="w-64"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-direction">Type</Label>
            <select
              id="add-direction"
              name="direction"
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
              defaultValue="out"
            >
              <option value="out">Money out (payment)</option>
              <option value="in">Money in (deposit)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-amount">Amount</Label>
            <Input
              id="add-amount"
              name="amount"
              inputMode="decimal"
              placeholder="0.00"
              required
              className="w-32"
            />
          </div>
          <div className="space-y-1.5 w-64">
            <Label htmlFor="add-category">Accounting category (optional)</Label>
            <AccountingAccountPicker
              id="add-category"
              name="accountingAccountId"
              value={categoryId}
              onChange={setCategoryId}
              accounts={accountOptions}
              placeholder="— none —"
            />
          </div>
          <div className="space-y-1.5 w-56">
            <Label htmlFor="add-vendor">Payee / vendor (optional)</Label>
            <Select id="add-vendor" name="vendorId" defaultValue="">
              <option value="">— none —</option>
              {vendorOptions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5 w-56">
            <Label htmlFor="add-project">Job / project (optional)</Label>
            <Select id="add-project" name="projectId" defaultValue="">
              <option value="">— none —</option>
              {projectOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Adding…' : 'Add'}
          </Button>
          <Button type="button" variant="outline" onClick={onDone}>
            Close
          </Button>
          {state.formError && (
            <p className="text-sm text-red-600 w-full">{state.formError}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
