// Capacitor runtime detection.
//
// The web app is loaded the same way whether it's running inside a
// Capacitor native shell or in a regular phone browser — same URL,
// same Next.js bundle. The difference is that Capacitor injects a
// global `window.Capacitor` bridge object before any page JS runs.
// Detecting that bridge tells us we can call native plugins like
// @capacitor/camera; absence means we're in a regular browser and
// must fall back to <input type="file" capture="environment">.
//
// `isNativePlatform()` is the canonical Capacitor API call; we also
// guard with a typeof window check so this file can be imported from
// server components without crashing.

export type Platform = 'web' | 'ios' | 'android';

export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

export function getPlatform(): Platform {
  if (typeof window === 'undefined') return 'web';
  const cap = (window as unknown as {
    Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean };
  }).Capacitor;
  if (!cap?.isNativePlatform?.()) return 'web';
  const p = cap.getPlatform?.();
  return p === 'ios' || p === 'android' ? p : 'web';
}
