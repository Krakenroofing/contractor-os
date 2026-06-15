'use client';

// Phase 2.6 OCR auto-fill UI. Lives on the receipt detail page next to
// the attachments list. The flow:
//   1. Operator clicks "Auto-fill from receipt" on an attachment.
//   2. Server runs Document AI, returns a parsed suggestion (no DB write).
//   3. We render the suggestion inline with editable fields.
//   4. Operator clicks "Apply" → server writes to the receipt header +
//      lines, page refreshes so the form picks up the new values.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { VendorPicker } from '@/modules/vendors/components/vendor-picker';
import {
  applyExtractedToReceiptAction,
  extractFromAttachmentAction,
  type OcrSuggestion,
} from '../ocr-actions';

export type OcrPanelProps = {
  receiptId: string;
  attachments: Array<{ id: string; originalFilename: string; mimeType: string }>;
  vendors: Array<{ id: string; label: string }>;
  enabled: boolean;
};

type SuggestionState = OcrSuggestion & {
  // Form-editable fields (string) so the operator can tweak before apply.
  formVendorId: string;
  formReceiptDate: string;
  formCurrency: string;
  formTotal: string;
  formVatRate: string;
  formLineItems: Array<{ description: string; amount: string }>;
};

function toFormState(s: OcrSuggestion): SuggestionState {
  return {
    ...s,
    formVendorId: s.vendorMatchId ?? '',
    formReceiptDate: s.receiptDate ?? '',
    formCurrency: s.currency ?? '',
    formTotal: s.total !== undefined ? s.total.toFixed(2) : '',
    formVatRate: s.vatRate !== undefined ? s.vatRate.toString() : '',
    formLineItems: (s.lineItems ?? []).map((li) => ({
      description: li.description ?? '',
      amount: li.amount !== undefined ? li.amount.toFixed(2) : '',
    })),
  };
}

export function OcrPanel(props: OcrPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeAttachmentId, setActiveAttachmentId] = useState<string | null>(
    null,
  );
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!props.enabled || props.attachments.length === 0) return null;

  function onExtract(attachmentId: string) {
    setError(null);
    setSuggestion(null);
    setActiveAttachmentId(attachmentId);
    startTransition(async () => {
      const res = await extractFromAttachmentAction({
        receiptId: props.receiptId,
        attachmentId,
      });
      if (!res.ok) {
        setError(res.error);
        setActiveAttachmentId(null);
        return;
      }
      setSuggestion(toFormState(res.suggestion));
    });
  }

  function onApply() {
    if (!suggestion) return;
    setError(null);
    const totalN = Number(suggestion.formTotal);
    const rateN = Number(suggestion.formVatRate);
    const lineItems = suggestion.formLineItems
      .filter((li) => li.description || li.amount)
      .map((li) => ({
        description: li.description || undefined,
        amount: li.amount ? Number(li.amount) : undefined,
      }));
    startTransition(async () => {
      const res = await applyExtractedToReceiptAction({
        receiptId: props.receiptId,
        vendorId: suggestion.formVendorId || null,
        receiptDate: suggestion.formReceiptDate || undefined,
        currency: suggestion.formCurrency || undefined,
        total: Number.isFinite(totalN) && totalN > 0 ? totalN : undefined,
        vatRate: Number.isFinite(rateN) ? rateN : undefined,
        lineItems: lineItems.length > 0 ? lineItems : undefined,
      });
      if (!res.ok) {
        setError(res.error ?? 'Apply failed.');
        return;
      }
      setSuggestion(null);
      setActiveAttachmentId(null);
      router.refresh();
    });
  }

  function onCancel() {
    setSuggestion(null);
    setActiveAttachmentId(null);
    setError(null);
  }

  function updateLineItem(
    index: number,
    patch: Partial<{ description: string; amount: string }>,
  ) {
    if (!suggestion) return;
    setSuggestion({
      ...suggestion,
      formLineItems: suggestion.formLineItems.map((li, i) =>
        i === index ? { ...li, ...patch } : li,
      ),
    });
  }
  function removeLineItem(index: number) {
    if (!suggestion) return;
    setSuggestion({
      ...suggestion,
      formLineItems: suggestion.formLineItems.filter((_, i) => i !== index),
    });
  }
  function addLineItem() {
    if (!suggestion) return;
    setSuggestion({
      ...suggestion,
      formLineItems: [
        ...suggestion.formLineItems,
        { description: '', amount: '' },
      ],
    });
  }

  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 p-3 space-y-2">
      <div className="text-xs font-medium text-blue-900">
        Auto-fill from receipt (OCR)
      </div>
      <p className="text-[11px] text-blue-800">
        Reads the photo or PDF and suggests vendor, date, total, and line
        items. You can edit before applying.
      </p>
      {!suggestion && (
        <div className="flex flex-wrap items-center gap-2">
          {props.attachments.map((a) => (
            <Button
              key={a.id}
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => onExtract(a.id)}
            >
              {pending && activeAttachmentId === a.id
                ? 'Reading…'
                : `Use “${truncate(a.originalFilename, 30)}”`}
            </Button>
          ))}
        </div>
      )}
      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </p>
      )}
      {suggestion && (
        <div className="rounded-md border border-blue-200 bg-white p-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Vendor</Label>
              <VendorPicker
                value={suggestion.formVendorId}
                vendors={props.vendors.map((v) => ({ id: v.id, name: v.label }))}
                onChange={(id) =>
                  setSuggestion({ ...suggestion, formVendorId: id })
                }
                noneLabel="— none —"
              />
              {suggestion.vendorName && (
                <p className="mt-1 text-[10px] text-slate-500">
                  OCR read: <span className="italic">{suggestion.vendorName}</span>
                  {suggestion.vendorMatchId
                    ? ' (matched)'
                    : ' (no vendor match — pick or leave blank)'}
                </p>
              )}
            </div>
            <div>
              <Label>Receipt date</Label>
              <Input
                type="date"
                value={suggestion.formReceiptDate}
                onChange={(e) =>
                  setSuggestion({
                    ...suggestion,
                    formReceiptDate: e.target.value,
                  })
                }
              />
            </div>
            <div>
              <Label>Currency</Label>
              <Input
                value={suggestion.formCurrency}
                maxLength={3}
                onChange={(e) =>
                  setSuggestion({
                    ...suggestion,
                    formCurrency: e.target.value.toUpperCase(),
                  })
                }
                placeholder="USD"
              />
            </div>
            <div>
              <Label>Total (gross)</Label>
              <Input
                inputMode="decimal"
                value={suggestion.formTotal}
                onChange={(e) =>
                  setSuggestion({ ...suggestion, formTotal: e.target.value })
                }
              />
            </div>
            <div>
              <Label>VAT rate %</Label>
              <Input
                inputMode="decimal"
                value={suggestion.formVatRate}
                onChange={(e) =>
                  setSuggestion({ ...suggestion, formVatRate: e.target.value })
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Line items (optional — replaces current lines)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addLineItem}
              >
                + Add
              </Button>
            </div>
            {suggestion.formLineItems.length === 0 && (
              <p className="text-[11px] text-slate-500">
                No line items extracted. The total above will be applied to a
                single line.
              </p>
            )}
            {suggestion.formLineItems.map((li, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-8">
                  <Input
                    value={li.description}
                    onChange={(e) =>
                      updateLineItem(idx, { description: e.target.value })
                    }
                    placeholder="Description"
                  />
                </div>
                <div className="col-span-3">
                  <Input
                    inputMode="decimal"
                    value={li.amount}
                    onChange={(e) =>
                      updateLineItem(idx, { amount: e.target.value })
                    }
                    placeholder="0.00"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeLineItem(idx)}
                  className="col-span-1 text-[11px] text-red-600 hover:text-red-800"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" disabled={pending} onClick={onApply}>
              {pending ? 'Applying…' : 'Apply to receipt'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={onCancel}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
