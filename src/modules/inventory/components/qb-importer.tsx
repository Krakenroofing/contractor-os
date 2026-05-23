'use client';

import { useActionState, useState } from 'react';
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
import { formatMoney } from '@/lib/money';
import {
  importInventoryItemsAction,
  type ImportInventoryItemsState,
} from '../actions';
import {
  parseQbProductListBuffer,
  type ParsedQbProductRow,
} from '../lib/parse-qb-export';

export function QbImporter() {
  const router = useRouter();
  const [rows, setRows] = useState<ParsedQbProductRow[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const initial: ImportInventoryItemsState = {};
  const [state, formAction, pending] = useActionState(
    importInventoryItemsAction,
    initial,
  );

  async function handleFile(file: File) {
    setParseError(null);
    setWarnings([]);
    setRows(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseQbProductListBuffer(buf);
      setRows(parsed.rows);
      setWarnings(parsed.warnings);
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : 'Could not parse the file.',
      );
    }
  }

  const successResult = state.result;

  return (
    <div className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      {successResult ? (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-4 text-sm text-emerald-900 space-y-2">
          <div className="font-semibold">Import complete.</div>
          <div>
            Inserted <strong>{successResult.inserted}</strong> product
            {successResult.inserted === 1 ? '' : 's'}.
            {successResult.skipped > 0 && (
              <>
                {' '}
                Skipped <strong>{successResult.skipped}</strong> row
                {successResult.skipped === 1 ? '' : 's'} with SKUs that already
                exist.
              </>
            )}
          </div>
          {successResult.skippedSkus.length > 0 && (
            <div className="text-xs">
              Skipped SKUs: {successResult.skippedSkus.slice(0, 10).join(', ')}
              {successResult.skippedSkus.length > 10 &&
                ` … and ${successResult.skippedSkus.length - 10} more`}
            </div>
          )}
          <Button
            type="button"
            onClick={() => router.push('/inventory')}
            className="mt-2"
          >
            Back to Products
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-md border-2 border-dashed border-slate-300 p-6 text-center">
            <label className="block">
              <span className="text-sm text-slate-600">
                Drop a QuickBooks Product/Service List export (.xls / .xlsx)
              </span>
              <input
                type="file"
                accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
                className="mt-3 block mx-auto text-sm"
              />
            </label>
            {fileName && (
              <div className="mt-3 text-xs text-slate-500">
                Loaded: {fileName}
              </div>
            )}
          </div>

          {parseError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {parseError}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 space-y-1">
              {warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}

          {rows && rows.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-700">
                  Found <strong>{rows.length}</strong> product
                  {rows.length === 1 ? '' : 's'}. Review and confirm.
                </p>
              </div>

              <div className="border rounded-md overflow-hidden max-h-[480px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead>Tax</TableHead>
                      <TableHead>QB account</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 200).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-slate-900">{r.name}</TableCell>
                        <TableCell className="text-slate-600">
                          {r.category ?? '—'}
                        </TableCell>
                        <TableCell className="text-slate-600">
                          {r.sku ?? '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(r.defaultCost)}
                        </TableCell>
                        <TableCell className="text-slate-600">
                          {r.isTaxable ? 'Yes' : 'No'}
                        </TableCell>
                        <TableCell className="text-slate-500 text-xs">
                          {r.qbGlAccountText ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {rows.length > 200 && (
                  <div className="px-3 py-2 text-xs text-slate-500 border-t bg-slate-50">
                    Showing first 200 of {rows.length} rows. All rows will be
                    imported.
                  </div>
                )}
              </div>

              <form action={formAction}>
                <input
                  type="hidden"
                  name="payload"
                  value={JSON.stringify({ rows })}
                />
                <Button type="submit" disabled={pending}>
                  {pending
                    ? 'Importing…'
                    : `Import ${rows.length} product${rows.length === 1 ? '' : 's'}`}
                </Button>
              </form>
            </>
          )}
        </>
      )}
    </div>
  );
}
