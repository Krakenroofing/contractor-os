'use client';

import { useActionState, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  applyMapping,
  summarizeDrafts,
  type AmountStrategy,
  type DateFormat,
  AMOUNT_STRATEGIES,
  DATE_FORMATS,
  type ColumnMap,
} from '../lib/mapping';
import {
  commitImportAction,
  type BankingActionState,
} from '../actions';

const FIELD_LABELS: Record<keyof ColumnMap, string> = {
  date: 'Transaction date *',
  postedDate: 'Posted date',
  description: 'Description *',
  payee: 'Payee',
  memo: 'Memo',
  amount: 'Amount (signed)',
  debit: 'Debit',
  credit: 'Credit',
  reference: 'Reference / Check #',
};

const NONE_VALUE = '__none__';

export type MappingWizardProps = {
  batchId: string;
  filename: string;
  headers: string[];
  sampleRows: Record<string, string>[];
  truncated: boolean;
  initial?: {
    columnMap: Partial<ColumnMap>;
    dateFormat: DateFormat;
    amountStrategy: AmountStrategy;
    decimalSeparator: string;
    thousandsSeparator: string;
    skipRows: number;
    label: string;
  };
};

function guessMatch(headers: string[], candidates: string[]): string | '' {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const cand of candidates) {
    const idx = lower.indexOf(cand.toLowerCase());
    if (idx >= 0) return headers[idx];
  }
  for (let i = 0; i < lower.length; i++) {
    for (const cand of candidates) {
      if (lower[i].includes(cand.toLowerCase())) return headers[i];
    }
  }
  return '';
}

export function MappingWizard(props: MappingWizardProps) {
  const headers = props.headers;
  const initial = props.initial;
  const [label, setLabel] = useState(initial?.label ?? 'Default mapping');
  const [dateFormat, setDateFormat] = useState<DateFormat>(
    initial?.dateFormat ?? 'YYYY-MM-DD',
  );
  const [amountStrategy, setAmountStrategy] = useState<AmountStrategy>(
    initial?.amountStrategy ?? 'signed_amount',
  );
  const [decimalSeparator, setDecimalSeparator] = useState(
    initial?.decimalSeparator ?? '.',
  );
  const [thousandsSeparator, setThousandsSeparator] = useState(
    initial?.thousandsSeparator ?? ',',
  );
  const [skipRows, setSkipRows] = useState(initial?.skipRows ?? 0);

  const initialCols: ColumnMap = {
    date: initial?.columnMap.date ?? guessMatch(headers, ['date', 'transaction date', 'txn date']),
    postedDate:
      initial?.columnMap.postedDate ??
      guessMatch(headers, ['posted date', 'posted', 'post date']),
    description:
      initial?.columnMap.description ??
      guessMatch(headers, ['description', 'details', 'narration', 'memo']),
    payee: initial?.columnMap.payee ?? guessMatch(headers, ['payee', 'name']),
    memo: initial?.columnMap.memo ?? guessMatch(headers, ['memo', 'notes']),
    amount:
      initial?.columnMap.amount ??
      guessMatch(headers, ['amount', 'value', 'transaction amount']),
    debit: initial?.columnMap.debit ?? guessMatch(headers, ['debit', 'withdrawal', 'out']),
    credit: initial?.columnMap.credit ?? guessMatch(headers, ['credit', 'deposit', 'in']),
    reference:
      initial?.columnMap.reference ??
      guessMatch(headers, ['reference', 'check #', 'check no', 'ref']),
  };
  const [cols, setCols] = useState<ColumnMap>(initialCols);

  function setCol(k: keyof ColumnMap, v: string) {
    setCols((prev) => ({ ...prev, [k]: v === NONE_VALUE ? '' : v }));
  }

  // Live preview computed client-side from the same applyMapping used on the
  // server. Keeps "what you see" honest before committing.
  const preview = useMemo(() => {
    const { drafts, errors } = applyMapping(props.sampleRows, {
      columnMap: cols,
      dateFormat,
      amountStrategy,
      decimalSeparator,
      thousandsSeparator,
      skipRows: 0, // preview always shows from the start of the sample
    });
    const totals = summarizeDrafts(drafts);
    return { drafts: drafts.slice(0, 20), errors, totals };
  }, [
    props.sampleRows,
    cols,
    dateFormat,
    amountStrategy,
    decimalSeparator,
    thousandsSeparator,
  ]);

  const bound = commitImportAction.bind(null, props.batchId);
  const [state, action, pending] = useActionState<BankingActionState, FormData>(
    bound,
    {},
  );

  function renderHeaderSelect(field: keyof ColumnMap, required = false) {
    const value = cols[field] ?? '';
    return (
      <Select
        name={`col_${field}`}
        value={value === '' ? NONE_VALUE : value}
        onChange={(e) => setCol(field, e.target.value)}
        required={required}
      >
        <option value={NONE_VALUE}>— none —</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </Select>
    );
  }

  const usingSplit = amountStrategy === 'debit_credit_split';

  return (
    <form action={action} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="label">Mapping label</Label>
          <Input
            id="label"
            name="label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="TRB checking — CSV"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Saved per bank account so the next import auto-fills these settings.
          </p>
        </div>
        <div>
          <Label htmlFor="dateFormat">Date format</Label>
          <Select
            id="dateFormat"
            name="dateFormat"
            value={dateFormat}
            onChange={(e) => setDateFormat(e.target.value as DateFormat)}
          >
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="amountStrategy">Amount strategy</Label>
          <Select
            id="amountStrategy"
            name="amountStrategy"
            value={amountStrategy}
            onChange={(e) =>
              setAmountStrategy(e.target.value as AmountStrategy)
            }
          >
            {AMOUNT_STRATEGIES.map((a) => (
              <option key={a} value={a}>
                {a === 'signed_amount'
                  ? 'One column, signed (+credit / −debit)'
                  : 'Two columns (Debit / Credit)'}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="decimalSeparator">Decimal</Label>
            <Select
              id="decimalSeparator"
              name="decimalSeparator"
              value={decimalSeparator}
              onChange={(e) => setDecimalSeparator(e.target.value)}
            >
              <option value=".">. (1,234.56)</option>
              <option value=",">, (1.234,56)</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="thousandsSeparator">Thousands</Label>
            <Select
              id="thousandsSeparator"
              name="thousandsSeparator"
              value={thousandsSeparator}
              onChange={(e) => setThousandsSeparator(e.target.value)}
            >
              <option value=",">,</option>
              <option value=".">.</option>
              <option value=" ">space</option>
              <option value="">(none)</option>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="skipRows">Skip rows (above the header)</Label>
          <Input
            id="skipRows"
            name="skipRows"
            type="number"
            min={0}
            max={50}
            value={skipRows}
            onChange={(e) => setSkipRows(Number(e.target.value) || 0)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label>{FIELD_LABELS.date}</Label>
          {renderHeaderSelect('date', true)}
        </div>
        <div>
          <Label>{FIELD_LABELS.postedDate}</Label>
          {renderHeaderSelect('postedDate')}
        </div>
        <div>
          <Label>{FIELD_LABELS.description}</Label>
          {renderHeaderSelect('description', true)}
        </div>
        <div>
          <Label>{FIELD_LABELS.payee}</Label>
          {renderHeaderSelect('payee')}
        </div>
        <div>
          <Label>{FIELD_LABELS.memo}</Label>
          {renderHeaderSelect('memo')}
        </div>
        <div>
          <Label>{FIELD_LABELS.reference}</Label>
          {renderHeaderSelect('reference')}
        </div>
        {!usingSplit && (
          <div className="md:col-span-3">
            <Label>{FIELD_LABELS.amount}</Label>
            {renderHeaderSelect('amount', true)}
            <p className="mt-1 text-[11px] text-slate-500">
              Positive = money in (credit). Negative = money out (debit).
            </p>
          </div>
        )}
        {usingSplit && (
          <>
            <div>
              <Label>{FIELD_LABELS.debit}</Label>
              {renderHeaderSelect('debit')}
            </div>
            <div>
              <Label>{FIELD_LABELS.credit}</Label>
              {renderHeaderSelect('credit')}
            </div>
          </>
        )}
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-900">Preview totals</h3>
          <div className="text-xs text-slate-600">
            {preview.totals.rowCount} row(s) parseable · {preview.errors.length} error(s)
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              Debits (money out)
            </p>
            <p className="font-semibold text-amber-700 tabular-nums">
              {preview.totals.totalsDebit}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              Credits (money in)
            </p>
            <p className="font-semibold text-emerald-700 tabular-nums">
              {preview.totals.totalsCredit}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              Net
            </p>
            <p className="font-semibold tabular-nums">
              {(
                Number(preview.totals.totalsCredit) -
                Number(preview.totals.totalsDebit)
              ).toFixed(2)}
            </p>
          </div>
        </div>
        {preview.errors.length > 0 && (
          <div className="mt-3 text-xs text-red-700 space-y-1">
            {preview.errors.slice(0, 8).map((e, i) => (
              <p key={i}>• {e.reason}</p>
            ))}
            {preview.errors.length > 8 && (
              <p className="text-slate-500">
                …and {preview.errors.length - 8} more.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Payee</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Reference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.drafts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-slate-500 p-6">
                  No rows parsed yet. Pick the required columns above.
                </TableCell>
              </TableRow>
            ) : (
              preview.drafts.map((d, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs font-mono">{d.transactionDate}</TableCell>
                  <TableCell className="text-sm">{d.description}</TableCell>
                  <TableCell className="text-xs text-slate-600">{d.payee ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums text-amber-700">
                    {d.debit !== null ? d.debit.toFixed(2) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-700">
                    {d.credit !== null ? d.credit.toFixed(2) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {d.amount.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-slate-500">
                    {d.reference ?? '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending || preview.drafts.length === 0}>
          {pending ? 'Importing…' : `Commit ${preview.totals.rowCount} row(s)`}
        </Button>
        {props.truncated && (
          <p className="text-xs text-amber-700">
            File contained more than the row cap; only the first batch is shown
            in this preview. The full file will be processed on commit.
          </p>
        )}
        {state.formError && (
          <p className="text-xs text-red-600">{state.formError}</p>
        )}
      </div>
    </form>
  );
}
