// Small helper for "return to where you came from" navigation. When a user
// jumps off to create something (e.g. a project) mid-task, the originating
// page passes its path as a `returnTo` query param; the create flow validates
// it and offers a one-click way back instead of dumping them on a list.

/**
 * Accept only a SAME-ORIGIN relative path ("/invoices/new"). Rejects absolute
 * URLs, protocol-relative ("//evil.com"), and anything else — prevents an
 * open-redirect through the param. Returns the cleaned path or null.
 */
export function sanitizeReturnTo(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (v.length === 0 || v.length > 512) return null;
  // Must start with a single "/", not "//" (protocol-relative) or "/\".
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) {
    return null;
  }
  // No control chars / whitespace funny business.
  if (/[\x00-\x1f]/.test(v)) return null;
  return v;
}

/**
 * A friendly noun for the page a `returnTo` path points at, for button labels
 * like "← Back to invoice". Falls back to a generic phrase.
 */
export function returnToLabel(path: string): string {
  const p = path.split('?')[0];
  if (p.startsWith('/invoices')) return 'invoice';
  if (p.startsWith('/estimates')) return 'estimate';
  if (p.startsWith('/proposals')) return 'proposal';
  if (p.startsWith('/purchase-orders')) return 'purchase order';
  if (p.startsWith('/change-orders')) return 'change order';
  if (p.startsWith('/banking')) return 'banking';
  if (p.startsWith('/payments')) return 'payment';
  return 'where you were';
}
