'use server';

// Spelling & grammar check for client-facing documents (invoices,
// proposals). Sends the form's prose fields to Claude (Haiku — fast and
// cheap) and returns corrected text per field; the UI shows before/after
// and applies only what the operator accepts.
//
// Requires ANTHROPIC_API_KEY in the environment (Vercel → Settings →
// Environment Variables). Without it the button renders disabled with a
// hint — nothing else in the app depends on the key.

import { requireAuth } from '@/lib/auth';

export type ProofreadField = { id: string; label: string; text: string };
export type ProofreadCorrection = { id: string; corrected: string };
export type ProofreadResult = {
  ok?: boolean;
  error?: string;
  /** Only fields that actually needed changes. */
  corrections?: ProofreadCorrection[];
};

const MODEL = process.env.PROOFREAD_MODEL || 'claude-haiku-4-5-20251001';

export async function proofreadFieldsAction(
  fields: ProofreadField[],
): Promise<ProofreadResult> {
  await requireAuth();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      error:
        'Spell check is not configured — add ANTHROPIC_API_KEY in the Vercel environment settings.',
    };
  }
  const cleaned = (fields ?? [])
    .filter(
      (f) =>
        f &&
        typeof f.id === 'string' &&
        typeof f.text === 'string' &&
        f.text.trim().length > 0,
    )
    .slice(0, 40)
    .map((f) => ({
      id: f.id.slice(0, 80),
      label: String(f.label ?? '').slice(0, 120),
      text: f.text.slice(0, 8000),
    }));
  if (cleaned.length === 0) {
    return { ok: true, corrections: [] };
  }

  const system = [
    'You are a meticulous copy editor for a roofing contractor\'s client-facing documents (invoices and proposals).',
    'Fix ONLY spelling, grammar, and punctuation. Keep the writer\'s meaning, tone, and structure.',
    'Never change: numbers, amounts, dates, units, product names/SKUs, line breaks, or list formatting.',
    'Keep construction/trade terms as written unless clearly misspelled (e.g. "facia" → "fascia", "flashing" stays).',
    'Respond with ONLY a JSON array of {"id": string, "corrected": string} — one entry PER FIELD THAT NEEDS CHANGES. Fields that are already correct must be omitted. No markdown fences, no commentary.',
  ].join(' ');

  const user = JSON.stringify(
    cleaned.map((f) => ({ id: f.id, label: f.label, text: f.text })),
  );

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        error: `Spell check failed (${res.status}): ${body.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const raw = (data.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('')
      .trim()
      // Defensive: strip accidental code fences.
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: 'Spell check returned an unreadable response — try again.' };
    }
    if (!Array.isArray(parsed)) {
      return { error: 'Spell check returned an unexpected shape — try again.' };
    }
    const validIds = new Set(cleaned.map((f) => f.id));
    const byId = new Map(cleaned.map((f) => [f.id, f.text]));
    const corrections: ProofreadCorrection[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as { id?: unknown }).id === 'string' &&
        typeof (item as { corrected?: unknown }).corrected === 'string'
      ) {
        const id = (item as { id: string }).id;
        const corrected = (item as { corrected: string }).corrected;
        // Only real changes to fields we actually sent.
        if (validIds.has(id) && corrected !== byId.get(id)) {
          corrections.push({ id, corrected });
        }
      }
    }
    return { ok: true, corrections };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Spell check failed: ${message}` };
  }
}
