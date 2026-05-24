'use client';

// In-form Excel/CSV importer for PO line items. User picks a file, we parse
// it client-side with sheetjs, score each parsed row against the inventory
// catalog, render a preview where they can adjust matches + cost code,
// then hand back a list of normalized lines for the parent form to append.
//
// Per the Phase 6.2 design decision, auto-matching is conservative: the
// best-scoring catalog item is pre-selected, but a per-row dropdown lets
// the user override or fall back to "free text" before insertion.

import { useMemo, useState } from 'react';
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
import { formatMoney } from '@/lib/money';
import {
  matchInventoryItem,
  type InventoryMatchCandidate,
} from '@/lib/inventory-match';
import {
  parsePoLinesBuffer,
  type ParsedPoLineRow,
} from '../lib/parse-po-lines-excel';

export type ImportedLine = {
  inventoryItemId: string;
  costCodeId: string;
  description: string;
  unit: string;
  quantity: string;
  unitCost: string;
};

type CostCodeOption = { id: string; code: string; description: string };

type PreviewRow = ParsedPoLineRow & {
  rowId: string;
  selectedItemId: string; // '' = free text
};

export function PoLinesExcelImportDialog({
  open,
  onClose,
  products,
  costCodes,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  products: InventoryMatchCandidate[];
  costCodes: CostCodeOption[];
  onInsert: (lines: ImportedLine[]) => void;
}) {
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [defaultCostCodeId, setDefaultCostCodeId] = useState<string>('');

  const productsById = useMemo(() => {
    const m = new Map<string, InventoryMatchCandidate>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  async function handleFile(file: File) {
    setParseError(null);
    setWarnings([]);
    setRows(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parsePoLinesBuffer(buf);
      const preview: PreviewRow[] = parsed.rows.map((r) => {
        const top = matchInventoryItem(
          { description: r.description, sku: r.sku },
          products,
          { topN: 1 },
        )[0];
        return {
          ...r,
          rowId: crypto.randomUUID(),
          selectedItemId: top ? top.candidate.id : '',
        };
      });
      setRows(preview);
      setWarnings(parsed.warnings);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Could not parse the file.');
    }
  }

  function reset() {
    setFileName('');
    setParseError(null);
    setWarnings([]);
    setRows(null);
    setDefaultCostCodeId('');
  }

  function close() {
    reset();
    onClose();
  }

  function insert() {
    if (!rows) return;
    const lines: ImportedLine[] = rows.map((r) => {
      const picked = productsById.get(r.selectedItemId);
      // If the user picked a catalog match, prefer its cost-code default
      // when the row didn't get one applied yet. Otherwise fall back to
      // the dialog-level default cost code.
      const costCodeId =
        picked?.defaultCostCodeId && picked.defaultCostCodeId !== ''
          ? picked.defaultCostCodeId
          : defaultCostCodeId;
      return {
        inventoryItemId: picked?.id ?? '',
        costCodeId,
        description: picked?.name ?? r.description,
        unit: r.unit ?? picked?.unit ?? '',
        quantity: r.quantity,
        unitCost: r.unitCost,
      };
    });
    onInsert(lines);
    close();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-6 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-5xl my-8">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">
            Upload line items from Excel
          </h2>
          <Button type="button" variant="ghost" size="sm" onClick={close}>
            ✕
          </Button>
        </div>

        <div className="p-5 space-y-5">
          {!rows && (
            <div className="rounded-md border-2 border-dashed border-slate-300 p-6 text-center">
              <label className="block">
                <span className="text-sm text-slate-600">
                  Drop a vendor quote spreadsheet (.xls / .xlsx / .csv).
                  Expected columns include Description (required), Qty, Unit,
                  Cost / Price, and SKU (optional).
                </span>
                <input
                  type="file"
                  accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                  className="mt-3 block mx-auto text-sm"
                />
              </label>
              {fileName && (
                <div className="mt-3 text-xs text-slate-500">Loaded: {fileName}</div>
              )}
            </div>
          )}

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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Default cost code for new lines</Label>
                  <Select
                    value={defaultCostCodeId}
                    onChange={(e) => setDefaultCostCodeId(e.target.value)}
                  >
                    <option value="">— Pick a cost code —</option>
                    {costCodes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.description}
                      </option>
                    ))}
                  </Select>
                  <p className="text-xs text-slate-500">
                    Applied to rows that don&apos;t inherit one from their matched
                    catalog item. You can change codes per-line after insertion.
                  </p>
                </div>
                <div className="text-sm text-slate-700 self-end">
                  Found <strong>{rows.length}</strong> line item
                  {rows.length === 1 ? '' : 's'}.{' '}
                  {fileName && <span className="text-xs text-slate-500">({fileName})</span>}
                </div>
              </div>

              <div className="border rounded-md overflow-hidden max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead>Match to inventory</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const suggestions = matchInventoryItem(
                        { description: r.description, sku: r.sku },
                        products,
                        { topN: 5 },
                      );
                      // Make sure the currently-selected item is always in the
                      // dropdown even if it dropped out of the top 5 (e.g. user
                      // manually re-picked something with a low score).
                      const selectedOption =
                        r.selectedItemId !== '' &&
                        !suggestions.some((s) => s.candidate.id === r.selectedItemId)
                          ? productsById.get(r.selectedItemId)
                          : undefined;
                      return (
                        <TableRow key={r.rowId}>
                          <TableCell className="text-slate-900">
                            {r.description}
                          </TableCell>
                          <TableCell className="text-slate-600">
                            {r.sku ?? '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <Input
                              value={r.quantity}
                              inputMode="decimal"
                              className="h-8 text-right tabular-nums"
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev?.map((p) =>
                                    p.rowId === r.rowId
                                      ? { ...p, quantity: e.target.value }
                                      : p,
                                  ) ?? prev,
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="text-slate-600">
                            {r.unit ?? '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <Input
                              value={r.unitCost}
                              inputMode="decimal"
                              className="h-8 text-right tabular-nums"
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev?.map((p) =>
                                    p.rowId === r.rowId
                                      ? { ...p, unitCost: e.target.value }
                                      : p,
                                  ) ?? prev,
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={r.selectedItemId}
                              className="h-8"
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev?.map((p) =>
                                    p.rowId === r.rowId
                                      ? { ...p, selectedItemId: e.target.value }
                                      : p,
                                  ) ?? prev,
                                )
                              }
                            >
                              <option value="">— Free text —</option>
                              {selectedOption && (
                                <option value={selectedOption.id}>
                                  {selectedOption.name} (manual)
                                </option>
                              )}
                              {suggestions.map((s) => (
                                <option key={s.candidate.id} value={s.candidate.id}>
                                  {s.candidate.name}
                                  {s.candidate.sku ? ` · ${s.candidate.sku}` : ''} —{' '}
                                  {Math.round(s.score * 100)}%
                                </option>
                              ))}
                            </Select>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-md bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-700">
                Total:{' '}
                <span className="font-semibold tabular-nums">
                  {formatMoney(
                    rows.reduce(
                      (acc, r) =>
                        acc + (Number(r.quantity) || 0) * (Number(r.unitCost) || 0),
                      0,
                    ),
                  )}
                </span>{' '}
                across {rows.length} line{rows.length === 1 ? '' : 's'}.
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={insert}
            disabled={!rows || rows.length === 0 || defaultCostCodeId === ''}
          >
            Insert {rows ? rows.length : 0} line
            {rows && rows.length === 1 ? '' : 's'} into PO
          </Button>
        </div>
      </div>
    </div>
  );
}
