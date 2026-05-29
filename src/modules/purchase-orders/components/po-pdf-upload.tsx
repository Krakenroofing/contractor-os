'use client';

// Two-phase client component for the PDF-to-PO flow.
//
// Phase 1 (upload): drag-drop / file picker. POSTs the file to
// extractPoPdfAction. While pending, shows a spinner. When the action
// returns an extracted payload, we transition to phase 2.
//
// Phase 2 (preview): editable extracted form. Vendor + project pickers
// (vendor pre-matched by name), per-line cost-code + inventory-match
// dropdowns, header totals. Submits via createPoFromExtractedAction,
// which creates the draft PO, re-uploads the source PDF as a
// project_document, and redirects to the PO detail page.

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
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
import { formatMoney, multiply } from '@/lib/money';
import {
  matchInventoryItem,
  type InventoryMatchCandidate,
} from '@/lib/inventory-match';
import { QuickAddProductDrawer } from '@/modules/inventory/components/quick-add-product-drawer';
import {
  createPoFromExtractedAction,
  extractPoPdfAction,
  runDocumentAiDiagnosisAction,
  type CreatePoFromExtractedState,
  type DocumentAiDiagnosisState,
  type ExtractPoPdfState,
} from '../actions';

type ProjectOption = { id: string; label: string };
type VendorOption = { id: string; name: string };
type CostCodeOption = { id: string; code: string; description: string };

// Sentinel for the per-line "+ Add new item" option — opens the quick-add
// inventory drawer instead of selecting an existing product.
const ADD_NEW_ITEM = '__add_new_item__';

type EditableLine = {
  rowId: string;
  description: string;
  quantity: string;
  unitCost: string;
  unit: string;
  selectedInventoryItemId: string;
  selectedCostCodeId: string;
};

const initialExtract: ExtractPoPdfState = {};
const initialCreate: CreatePoFromExtractedState = {};

export function PoPdfUpload({
  projects,
  vendors,
  costCodes,
  products,
}: {
  projects: ProjectOption[];
  vendors: VendorOption[];
  costCodes: CostCodeOption[];
  products: InventoryMatchCandidate[];
}) {
  const [extractState, extractAction, extractPending] = useActionState(
    extractPoPdfAction,
    initialExtract,
  );

  return (
    <div className="space-y-6">
      {!extractState.extracted ? (
        <UploadPhase
          state={extractState}
          formAction={extractAction}
          pending={extractPending}
        />
      ) : (
        <PreviewPhase
          state={extractState}
          projects={projects}
          vendors={vendors}
          costCodes={costCodes}
          products={products}
        />
      )}
    </div>
  );
}

function UploadPhase({
  state,
  formAction,
  pending,
}: {
  state: ExtractPoPdfState;
  formAction: (formData: FormData) => void;
  pending: boolean;
}) {
  const [diag, diagAction, diagPending] = useActionState<
    DocumentAiDiagnosisState | null,
    FormData
  >(async () => runDocumentAiDiagnosisAction(null), null);

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        {state.formError && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {state.formError}
          </div>
        )}
        <div className="rounded-md border-2 border-dashed border-slate-300 p-10 text-center">
          <label className="block cursor-pointer">
            <span className="text-sm text-slate-700 block">
              Drop a vendor estimate or quote (PDF / JPG / PNG / HEIC, max 25
              MB).
            </span>
            <span className="text-xs text-slate-500 block mt-1">
              Pick a single document — multi-page PDFs are read as one estimate.
            </span>
            <input
              type="file"
              name="file"
              required
              accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.gif,application/pdf,image/*"
              className="mt-4 block mx-auto text-sm"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              disabled={pending}
            />
          </label>
          {pending && (
            <div className="mt-4 text-sm text-slate-600">
              Reading the document… this usually takes 5–15 seconds.
            </div>
          )}
        </div>
      </form>

      <details className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm">
        <summary className="cursor-pointer text-slate-700 font-medium">
          Troubleshooting — test Document AI connection
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-600">
            If uploads keep failing with &quot;Document AI did not return a usable
            error&quot;, click this to test auth + connectivity without sending
            a document. The test calls <code>listProcessors</code>, which
            exercises credentials + transport but skips the
            document-processing layer.
          </p>
          <form action={diagAction}>
            <Button type="submit" size="sm" variant="outline" disabled={diagPending}>
              {diagPending ? 'Testing…' : 'Run diagnostic'}
            </Button>
          </form>
          {diag && <DiagnosticResult result={diag} />}
        </div>
      </details>
    </div>
  );
}

function DiagnosticResult({ result }: { result: DocumentAiDiagnosisState }) {
  if ('formError' in result) {
    return (
      <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
        {result.formError}
      </div>
    );
  }
  // Effective status is driven by REST (what production uses), not by gRPC
  // (which is permanently broken in this Next.js/Vercel bundle — kept only
  // as a regression detector). If the gRPC path happens to succeed (it
  // shouldn't, but if the SDK is ever fixed), that's fine too.
  const restWorks = result.rest?.ok === true;
  const grpcWorks = result.ok === true;
  const effectiveOk = grpcWorks || restWorks;
  const productionPath = grpcWorks ? 'gRPC + REST' : restWorks ? 'REST' : 'neither';
  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs space-y-2 ${
        effectiveOk
          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
          : 'bg-red-50 border-red-200 text-red-900'
      }`}
    >
      <div className="font-medium">
        {effectiveOk
          ? `✓ Document AI reachable via ${productionPath}. Production extraction will work.`
          : `✗ Document AI unreachable via every path tested.`}
      </div>
      {!effectiveOk && result.detail && (
        <div className="text-red-800">{result.detail}</div>
      )}
      {effectiveOk && !grpcWorks && (
        <div className="text-emerald-800 text-[11px]">
          (gRPC SDK still fails opaquely — known Next.js/Vercel bundling
          quirk. Production calls go through REST, which works fine.)
        </div>
      )}
      <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
        <dt>Project ID</dt>
        <dd className="break-all">{result.info.projectId ?? '—'}</dd>
        <dt>Location</dt>
        <dd>{result.info.location ?? '—'}</dd>
        <dt>Processor ID (env)</dt>
        <dd className="break-all">{result.info.processorId ?? '—'}</dd>
        <dt>Service account</dt>
        <dd className="break-all">{result.info.serviceAccountEmail ?? '—'}</dd>
        <dt>Private key ID</dt>
        <dd className="break-all">{result.info.privateKeyId ?? '—'}</dd>
        <dt>Key starts with</dt>
        <dd className="break-all">{result.info.privateKeyStartsWith ?? '—'}</dd>
        <dt>Key ends with</dt>
        <dd className="break-all">{result.info.privateKeyEndsWith ?? '—'}</dd>
        <dt>Key length</dt>
        <dd>{result.info.privateKeyLength ?? '—'}</dd>
        <dt>Has real newlines</dt>
        <dd>{String(result.info.privateKeyHasRealNewlines ?? false)}</dd>
        <dt>Raw JSON length</dt>
        <dd>{result.info.credentialsRawLength ?? '—'}</dd>
      </dl>
      {grpcWorks && result.processorIdsFound && (
        <div>
          <div className="font-medium">Processor IDs found in project (via gRPC):</div>
          <ul className="list-disc list-inside font-mono text-[11px]">
            {result.processorIdsFound.map((id) => (
              <li
                key={id}
                className={
                  id === result.info.processorId
                    ? 'text-emerald-700 font-bold'
                    : ''
                }
              >
                {id}
                {id === result.info.processorId && ' ← matches env var ✓'}
              </li>
            ))}
          </ul>
          {result.targetProcessorPresent === false && (
            <div className="text-red-700 font-medium mt-1">
              ⚠ Env var processor ID is NOT in this project/location — that&apos;s
              the bug.
            </div>
          )}
        </div>
      )}
      {result.tokenIdentity && (() => {
        // Token email matching is only conclusive when Google actually
        // populates the email field. For SA tokens, tokeninfo often omits
        // email — the token still represents the SA (azp is the numeric
        // UID) but we can't verify by email comparison. Don't scream "BUG"
        // in that case; just say "couldn't verify".
        const emailMatch =
          result.tokenIdentity.ok &&
          typeof result.tokenIdentity.email === 'string' &&
          result.tokenIdentity.email === result.info.serviceAccountEmail;
        const emailMismatch =
          result.tokenIdentity.ok &&
          typeof result.tokenIdentity.email === 'string' &&
          result.tokenIdentity.email !== result.info.serviceAccountEmail;
        const emailMissing =
          result.tokenIdentity.ok && !result.tokenIdentity.email;
        return (
        <div
          className={`rounded border px-2 py-1 ${
            emailMatch
              ? 'bg-emerald-100 border-emerald-300 text-emerald-900'
              : emailMismatch
                ? 'bg-red-100 border-red-300 text-red-900'
                : 'bg-slate-100 border-slate-300 text-slate-800'
          }`}
        >
          <div className="font-medium">
            Token identity check (what Google says we are):
          </div>
          {result.tokenIdentity.ok ? (
            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 font-mono text-[11px] mt-1">
              <dt>Token email</dt>
              <dd className="break-all">
                {result.tokenIdentity.email ?? '(not included — normal for SA tokens)'}
              </dd>
              <dt>Identity</dt>
              <dd>
                {emailMatch ? (
                  <span className="text-emerald-700 font-bold">
                    ✓ token email matches the SA in our credentials
                  </span>
                ) : emailMismatch ? (
                  <span className="text-red-700 font-bold">
                    ✗ token is for a DIFFERENT email — investigate which SA is actually being used
                  </span>
                ) : (
                  <span className="text-slate-700">
                    ⓘ email not populated by Google&apos;s tokeninfo (typical
                    for SA tokens). Identity verified indirectly via{' '}
                    <code>azp</code> below — that numeric ID is the
                    SA&apos;s unique UID.
                  </span>
                )}
              </dd>
              <dt>Authorized to (azp)</dt>
              <dd className="break-all">{result.tokenIdentity.issuedTo ?? '—'}</dd>
              <dt>Audience (aud)</dt>
              <dd className="break-all">{result.tokenIdentity.audience ?? '—'}</dd>
              <dt>Scope</dt>
              <dd className="break-all">{result.tokenIdentity.scope ?? '—'}</dd>
              <dt>Expires in</dt>
              <dd>{result.tokenIdentity.expiresIn ?? '—'}s</dd>
            </dl>
          ) : (
            <div className="text-amber-800 mt-1">
              tokeninfo call failed: {result.tokenIdentity.error}
            </div>
          )}
        </div>
        );
      })()}
      {result.rest && (
        <div
          className={`rounded border px-2 py-1 ${
            result.rest.ok
              ? 'bg-emerald-100 border-emerald-300 text-emerald-900'
              : 'bg-white border-slate-200 text-slate-700'
          }`}
        >
          <div className="font-medium">
            REST fallback:{' '}
            {result.rest.ok
              ? `✓ works (${result.rest.processorCount ?? 0} processors)`
              : '✗ also failed'}
          </div>
          {result.rest.ok && (
            <>
              {result.rest.targetPresent ? (
                <div className="text-emerald-800 mt-1">
                  ✓ Your processor IS reachable via REST. Bug is gRPC-only —
                  refactoring extractReceipt to use REST will fix it.
                </div>
              ) : (
                <div className="text-amber-800 mt-1">
                  ⚠ REST works but your env-var processor ID isn&apos;t in the
                  list — the processor is in a different project/location, or
                  the env var has a typo. Found IDs:{' '}
                  {result.rest.processorIds?.join(', ') || '(none)'}
                </div>
              )}
            </>
          )}
          {!result.rest.ok && result.rest.error && (
            <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] bg-white/50 p-2 rounded">
              {result.rest.error}
            </pre>
          )}
        </div>
      )}
      {!grpcWorks && result.rawError && (
        <details>
          <summary className="cursor-pointer">
            Raw gRPC error (informational — gRPC is not the production path)
          </summary>
          <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] bg-white/50 p-2 rounded">
            {result.rawError}
          </pre>
        </details>
      )}
    </div>
  );
}

function PreviewPhase({
  state,
  projects,
  vendors,
  costCodes,
  products,
}: {
  state: ExtractPoPdfState;
  projects: ProjectOption[];
  vendors: VendorOption[];
  costCodes: CostCodeOption[];
  products: InventoryMatchCandidate[];
}) {
  const extracted = state.extracted!;
  const source = state.source!;

  const [createState, createAction, createPending] = useActionState(
    createPoFromExtractedAction,
    initialCreate,
  );

  // Pre-match vendor by fuzzy name (containment, like receipts pipeline).
  const autoVendorId = useMemo<string>(() => {
    if (!extracted.vendorName) return '';
    const needle = extracted.vendorName.toLowerCase().trim();
    const hit =
      vendors.find((v) => v.name.toLowerCase() === needle) ??
      vendors.find((v) => v.name.toLowerCase().includes(needle)) ??
      vendors.find((v) => needle.includes(v.name.toLowerCase()));
    return hit?.id ?? '';
  }, [extracted.vendorName, vendors]);

  // Products created inline via the "+ Add new item" drawer, merged ahead of
  // the server-provided catalog. `addingLineRowId` tracks which line opened
  // the drawer so the created item lands on the right row.
  const [addedProducts, setAddedProducts] = useState<InventoryMatchCandidate[]>(
    [],
  );
  const [addingLineRowId, setAddingLineRowId] = useState<string | null>(null);
  const allProducts = useMemo(
    () => [...addedProducts, ...products],
    [addedProducts, products],
  );

  const productsById = useMemo(() => {
    const m = new Map<string, InventoryMatchCandidate>();
    for (const p of allProducts) m.set(p.id, p);
    return m;
  }, [allProducts]);

  const [vendorId, setVendorId] = useState<string>(autoVendorId);
  const [projectId, setProjectId] = useState<string>('');
  const [defaultCostCodeId, setDefaultCostCodeId] = useState<string>('');
  const [issueDate, setIssueDate] = useState<string>(
    extracted.documentDate ?? new Date().toISOString().slice(0, 10),
  );
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>('');
  const [taxAmount, setTaxAmount] = useState<string>(
    extracted.taxAmount !== null ? String(extracted.taxAmount) : '0',
  );
  const [shipping, setShipping] = useState<string>('0');
  const [notes, setNotes] = useState<string>(
    `Created from uploaded estimate ${source.fileName}`,
  );

  const [lines, setLines] = useState<EditableLine[]>(() =>
    extracted.lines.map((l) => {
      const top = matchInventoryItem(
        { description: l.description },
        products,
        { topN: 1 },
      )[0];
      return {
        rowId: crypto.randomUUID(),
        description: l.description,
        quantity: String(l.quantity),
        unitCost: String(l.unitCost),
        unit: top?.candidate.unit ?? '',
        selectedInventoryItemId: top ? top.candidate.id : '',
        selectedCostCodeId: top?.candidate.defaultCostCodeId ?? '',
      };
    }),
  );

  // When the user picks a default cost code, propagate to any rows that
  // don't already have one set.
  const lastAppliedDefault = useRef<string>('');
  useEffect(() => {
    if (defaultCostCodeId === '' || defaultCostCodeId === lastAppliedDefault.current) return;
    lastAppliedDefault.current = defaultCostCodeId;
    setLines((prev) =>
      prev.map((l) =>
        l.selectedCostCodeId === '' ? { ...l, selectedCostCodeId: defaultCostCodeId } : l,
      ),
    );
  }, [defaultCostCodeId]);

  const updateLine = (rowId: string, patch: Partial<EditableLine>) => {
    setLines((prev) => prev.map((l) => (l.rowId === rowId ? { ...l, ...patch } : l)));
  };

  const linesPayload = lines.map((l) => ({
    inventoryItemId: l.selectedInventoryItemId,
    costCodeId: l.selectedCostCodeId,
    description: l.description,
    unit: l.unit,
    quantity: l.quantity,
    unitCost: l.unitCost,
  }));

  const subtotal = lines.reduce(
    (acc, l) => acc + multiply(Number(l.quantity) || 0, Number(l.unitCost) || 0),
    0,
  );
  const total = subtotal + (Number(taxAmount) || 0) + (Number(shipping) || 0);

  const err = (key: string) => createState.errors?.[key]?.[0];

  return (
    <form action={createAction} className="space-y-6">
      {createState.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {createState.formError}
        </div>
      )}

      <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-900">
        Parsed <strong>{source.fileName}</strong> ({Math.round(source.byteSize / 1024)}{' '}
        KB). Vendor: <strong>{extracted.vendorName ?? 'not detected'}</strong> · Date:{' '}
        <strong>{extracted.documentDate ?? 'not detected'}</strong> · Lines:{' '}
        <strong>{extracted.lines.length}</strong>. Review below, fix anything wrong, and
        create the draft PO.
      </div>

      <input type="hidden" name="sourceStoragePath" value={source.storagePath} />
      <input type="hidden" name="sourceFileName" value={source.fileName} />
      <input type="hidden" name="sourceMimeType" value={source.mimeType} />
      <input type="hidden" name="sourceByteSize" value={String(source.byteSize)} />
      <input type="hidden" name="lines" value={JSON.stringify(linesPayload)} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="PO number (leave blank to auto-generate)" error={err('number')}>
          <Input name="number" placeholder="PO-2026-…" />
        </Field>

        <Field label="Vendor" error={err('vendorId')} required>
          <Select
            name="vendorId"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            required
          >
            <option value="" disabled>
              {vendors.length === 0 ? 'No vendors yet' : 'Select a vendor'}
            </option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
          {extracted.vendorName && (
            <p className="text-xs text-slate-500">
              Extracted vendor: &quot;{extracted.vendorName}&quot;
              {autoVendorId === '' && ' (no match in your vendor list — pick one or add the vendor first)'}
            </p>
          )}
        </Field>

        <Field label="Project" error={err('projectId')} required>
          <Select
            name="projectId"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            required
          >
            <option value="" disabled>
              {projects.length === 0 ? 'No projects yet' : 'Select a project'}
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-500">
            The estimate PDF doesn&apos;t know which job this is for — you pick.
          </p>
        </Field>

        <Field label="Default cost code for unmatched lines" error={err('costCodeId')}>
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
            Applied to rows that didn&apos;t inherit a cost code from a matched
            catalog item. Override per-line below.
          </p>
        </Field>

        <Field label="Issue date" error={err('issueDate')}>
          <Input
            name="issueDate"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
          />
        </Field>

        <Field label="Expected delivery" error={err('expectedDeliveryDate')}>
          <Input
            name="expectedDeliveryDate"
            type="date"
            value={expectedDeliveryDate}
            onChange={(e) => setExpectedDeliveryDate(e.target.value)}
          />
        </Field>
      </div>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-3">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Line items ({lines.length})
        </legend>

        {err('lines') && <p className="text-xs text-red-600">{err('lines')}</p>}

        <div className="border rounded-md overflow-x-auto">
          <Table className="[&_th]:px-2 [&_td]:px-2">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[240px]">Description</TableHead>
                <TableHead className="w-44">Match to inventory</TableHead>
                <TableHead className="w-36">Cost code</TableHead>
                <TableHead className="text-right w-20">Qty</TableHead>
                <TableHead className="w-16">Unit</TableHead>
                <TableHead className="text-right w-28">Unit cost</TableHead>
                <TableHead className="text-right w-28">Total</TableHead>
                <TableHead className="w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => {
                const suggestions = matchInventoryItem(
                  { description: l.description },
                  allProducts,
                  { topN: 5 },
                );
                const selectedOption =
                  l.selectedInventoryItemId !== '' &&
                  !suggestions.some((s) => s.candidate.id === l.selectedInventoryItemId)
                    ? productsById.get(l.selectedInventoryItemId)
                    : undefined;
                const lineTotal = multiply(
                  Number(l.quantity) || 0,
                  Number(l.unitCost) || 0,
                );
                return (
                  <TableRow key={l.rowId}>
                    <TableCell>
                      <Input
                        value={l.description}
                        className="h-8"
                        onChange={(e) =>
                          updateLine(l.rowId, { description: e.target.value })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={l.selectedInventoryItemId}
                        className="h-8"
                        onChange={(e) => {
                          if (e.target.value === ADD_NEW_ITEM) {
                            setAddingLineRowId(l.rowId);
                            return;
                          }
                          const picked = productsById.get(e.target.value);
                          updateLine(l.rowId, {
                            selectedInventoryItemId: e.target.value,
                            selectedCostCodeId:
                              picked?.defaultCostCodeId ||
                              l.selectedCostCodeId ||
                              defaultCostCodeId,
                            unit: picked?.unit ?? l.unit,
                          });
                        }}
                      >
                        <option value="">— Free text —</option>
                        {selectedOption && (
                          <option value={selectedOption.id}>
                            {selectedOption.name} (manual)
                          </option>
                        )}
                        {suggestions.map((s) => (
                          <option key={s.candidate.id} value={s.candidate.id}>
                            {s.candidate.name} — {Math.round(s.score * 100)}%
                          </option>
                        ))}
                        <option value={ADD_NEW_ITEM}>+ Add new item…</option>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={l.selectedCostCodeId}
                        className="h-8"
                        onChange={(e) =>
                          updateLine(l.rowId, { selectedCostCodeId: e.target.value })
                        }
                      >
                        <option value="" disabled>
                          Select code
                        </option>
                        {costCodes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code}
                          </option>
                        ))}
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={l.quantity}
                        inputMode="decimal"
                        className="h-8 text-right tabular-nums"
                        onChange={(e) =>
                          updateLine(l.rowId, { quantity: e.target.value })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={l.unit}
                        className="h-8"
                        onChange={(e) => updateLine(l.rowId, { unit: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={l.unitCost}
                        inputMode="decimal"
                        className="h-8 text-right tabular-nums"
                        onChange={(e) =>
                          updateLine(l.rowId, { unitCost: e.target.value })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      {formatMoney(lineTotal)}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setLines((prev) => prev.filter((x) => x.rowId !== l.rowId))
                        }
                        disabled={lines.length === 1}
                        aria-label="Remove line"
                      >
                        ✕
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </fieldset>

      <QuickAddProductDrawer
        open={addingLineRowId !== null}
        onClose={() => setAddingLineRowId(null)}
        initialName={
          lines.find((l) => l.rowId === addingLineRowId)?.description ?? ''
        }
        onCreated={(item) => {
          setAddedProducts((prev) => [item, ...prev]);
          const rowId = addingLineRowId;
          if (rowId) {
            const line = lines.find((l) => l.rowId === rowId);
            updateLine(rowId, {
              selectedInventoryItemId: item.id,
              selectedCostCodeId:
                item.defaultCostCodeId ||
                line?.selectedCostCodeId ||
                defaultCostCodeId,
              unit: item.unit ?? line?.unit ?? '',
            });
          }
          setAddingLineRowId(null);
        }}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Tax" error={err('taxAmount')}>
          <Input
            name="taxAmount"
            inputMode="decimal"
            value={taxAmount}
            onChange={(e) => setTaxAmount(e.target.value)}
          />
        </Field>
        <Field label="Freight / duty" error={err('shipping')}>
          <Input
            name="shipping"
            inputMode="decimal"
            value={shipping}
            onChange={(e) => setShipping(e.target.value)}
          />
        </Field>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 grid grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Subtotal</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">
            {formatMoney(subtotal)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Extracted total
          </p>
          <p className="mt-0.5 text-base font-semibold tabular-nums text-slate-500">
            {extracted.total !== null ? formatMoney(extracted.total) : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">PO total</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">
            {formatMoney(total)}
          </p>
        </div>
      </div>

      <Field label="Notes" error={err('notes')}>
        <textarea
          name="notes"
          rows={3}
          className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={createPending}>
          {createPending ? 'Creating draft PO…' : 'Create draft PO'}
        </Button>
        <Link href="/purchase-orders/upload">
          <Button type="button" variant="ghost">
            Cancel &amp; upload another
          </Button>
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
  required,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
