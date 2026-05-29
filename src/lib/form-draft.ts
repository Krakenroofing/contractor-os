// Tiny localStorage-backed form-draft store. Lets a half-filled form be
// saved and restored so navigating away doesn't wipe the work. Per-browser
// (not a server record) — see Path 1 in the save-as-draft design.
//
// Client-only; every function guards against SSR.

export type StoredDraft<T> = { savedAt: number; data: T };

export function saveDraft<T>(key: string, data: T): number | null {
  if (typeof window === 'undefined') return null;
  const savedAt = Date.now();
  try {
    window.localStorage.setItem(key, JSON.stringify({ savedAt, data }));
    return savedAt;
  } catch {
    // Quota exceeded or non-serializable — fail soft.
    return null;
  }
}

export function loadDraft<T>(key: string): StoredDraft<T> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { savedAt?: unknown }).savedAt === 'number' &&
      'data' in (parsed as object)
    ) {
      return parsed as StoredDraft<T>;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Short "Apr 30, 2:15 PM" style stamp for the resume banner. */
export function formatDraftTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return 'earlier';
  }
}
