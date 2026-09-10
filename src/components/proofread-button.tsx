'use client';

// "Check spelling & grammar" for document forms (invoices, proposals).
//
// Zero per-form wiring: any input/textarea inside the SAME <form> that
// carries a `data-proofread="Human label"` attribute is picked up. On
// click, the current values go to the Claude-backed proofread action;
// suggestions render as before/after cards with per-field Apply (and
// Apply all). Applying writes back through the element's native value
// setter + an `input` event, which updates BOTH uncontrolled fields and
// React-controlled ones (the event walks React's onChange).
//
// When ANTHROPIC_API_KEY isn't configured the button renders disabled
// with a hint, so the operator knows how to switch it on. Browser
// spellcheck (red squiggles) works on the same fields regardless.

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  proofreadFieldsAction,
  type ProofreadField,
} from '@/modules/ai/proofread';

type Suggestion = {
  id: string;
  label: string;
  before: string;
  after: string;
  applied: boolean;
};

function setElementValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function ProofreadButton({ available }: { available: boolean }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);

  function collectFields(): Map<
    string,
    { el: HTMLInputElement | HTMLTextAreaElement; field: ProofreadField }
  > {
    const map = new Map<
      string,
      { el: HTMLInputElement | HTMLTextAreaElement; field: ProofreadField }
    >();
    const form = anchorRef.current?.closest('form');
    if (!form) return map;
    const nodes = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[data-proofread], textarea[data-proofread]',
    );
    let i = 0;
    for (const el of nodes) {
      const id = `f${i++}`;
      map.set(id, {
        el,
        field: {
          id,
          label: el.dataset.proofread || 'Text',
          text: el.value,
        },
      });
    }
    return map;
  }

  async function run() {
    setError(null);
    setSuggestions(null);
    const fields = collectFields();
    const withText = [...fields.values()]
      .map((f) => f.field)
      .filter((f) => f.text.trim().length > 0);
    if (withText.length === 0) {
      setError('Nothing to check yet — the text fields are empty.');
      return;
    }
    setBusy(true);
    try {
      const res = await proofreadFieldsAction(withText);
      if (!res.ok) {
        setError(res.error ?? 'Spell check failed.');
        return;
      }
      const out: Suggestion[] = [];
      for (const c of res.corrections ?? []) {
        const entry = fields.get(c.id);
        if (!entry) continue;
        out.push({
          id: c.id,
          label: entry.field.label,
          before: entry.field.text,
          after: c.corrected,
          applied: false,
        });
      }
      setSuggestions(out);
    } finally {
      setBusy(false);
    }
  }

  function apply(s: Suggestion) {
    // Re-collect so we target the live element even after re-renders.
    const fields = collectFields();
    const entry = fields.get(s.id);
    if (entry) setElementValue(entry.el, s.after);
    setSuggestions(
      (prev) =>
        prev?.map((x) => (x.id === s.id ? { ...x, applied: true } : x)) ?? null,
    );
  }

  return (
    <div ref={anchorRef} className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!available || busy}
          onClick={run}
          title={
            available
              ? 'Reviews the text fields for spelling and grammar and suggests fixes'
              : 'Add ANTHROPIC_API_KEY in the Vercel environment settings to enable AI spell check'
          }
        >
          {busy ? 'Checking…' : '✓ Check spelling & grammar'}
        </Button>
        {!available && (
          <span className="text-[11px] text-slate-500">
            Needs ANTHROPIC_API_KEY (Vercel → Settings → Environment
            Variables). Browser spellcheck still underlines typos as you type.
          </span>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {suggestions !== null && suggestions.length === 0 && (
        <p className="text-xs text-emerald-700">
          No spelling or grammar issues found ✓
        </p>
      )}

      {suggestions !== null && suggestions.length > 0 && (
        <div className="rounded-md border border-blue-200 bg-blue-50/50 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-blue-900">
              {suggestions.length} suggestion
              {suggestions.length === 1 ? '' : 's'}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  suggestions.filter((s) => !s.applied).forEach(apply)
                }
              >
                Apply all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSuggestions(null)}
              >
                Dismiss
              </Button>
            </div>
          </div>
          {suggestions.map((s) => (
            <div
              key={s.id}
              className="rounded border border-slate-200 bg-white p-2 text-xs space-y-1"
            >
              <p className="font-medium text-slate-700">{s.label}</p>
              <p className="text-red-700 line-through whitespace-pre-wrap">
                {s.before}
              </p>
              <p className="text-emerald-800 whitespace-pre-wrap">{s.after}</p>
              <div>
                {s.applied ? (
                  <span className="text-emerald-700">Applied ✓</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => apply(s)}
                    className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50"
                  >
                    Apply
                  </button>
                )}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-slate-500">
            Applying updates the fields above — remember to Save.
          </p>
        </div>
      )}
    </div>
  );
}
