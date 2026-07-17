// Native geolocation bridge for the field app.
//
// Inside the Capacitor shell, `navigator.geolocation` is dead on
// arrival: the WebView's location request needs the native app to hold
// ACCESS_FINE_LOCATION (Android) / NSLocationWhenInUseUsageDescription
// (iOS), which the shell historically never declared — so every punch
// saved without GPS. The @capacitor/geolocation plugin owns the native
// permission prompt and reads the OS location service directly, exactly
// like the camera plugin does for photos.
//
// In a regular phone browser we still use navigator.geolocation — same
// behaviour as before.
//
// Browser-only module: the dynamic import is the gatekeeper that keeps
// the plugin's shims out of server bundles and the web bundle alike.

import { isCapacitorNative } from './runtime';

export type GeoFix = {
  latitude: number;
  longitude: number;
  /** Metres. Smaller = tighter fix. */
  accuracy: number;
};

/**
 * 'denied' — the user (or OS) refused location permission; retrying
 * without user action is pointless.
 * 'unavailable' — no fix could be produced (GPS off, timeout, missing
 * manifest permission in an outdated native build). Retry may help.
 */
export type GeoFailure = 'denied' | 'unavailable';

export type GeoWatch = { stop: () => void };

const WATCH_OPTS = {
  // Jobsite-level precision; fresh readings only (no cached fix from an
  // hour ago at a different site); per-fix timeout so the watch can't
  // hang silently.
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 15_000,
};

/**
 * Start a continuous position watch. Fixes stream to `onFix` as the OS
 * refines them; failures go to `onFailure` (possibly repeatedly — the
 * caller decides whether an earlier good fix outweighs a later error).
 * Always resolves to a handle whose `stop()` is safe to call any time.
 */
export async function watchPosition(
  onFix: (fix: GeoFix) => void,
  onFailure: (reason: GeoFailure) => void,
): Promise<GeoWatch> {
  if (isCapacitorNative()) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');

      // Explicit permission request so a refusal maps cleanly to
      // 'denied' instead of surfacing as a watch error. On a shell
      // built without the manifest entries this THROWS — treat that as
      // 'unavailable' (an app update fixes it, not a settings toggle).
      const status = await Geolocation.requestPermissions();
      const granted =
        status.location === 'granted' ||
        // Coarse-only grant still yields a usable (if wide) fix.
        status.coarseLocation === 'granted';
      if (!granted) {
        onFailure('denied');
        return { stop: () => {} };
      }

      const id = await Geolocation.watchPosition(WATCH_OPTS, (pos, err) => {
        if (pos) {
          onFix({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          });
        } else if (err) {
          onFailure('unavailable');
        }
      });
      return {
        stop: () => {
          void Geolocation.clearWatch({ id });
        },
      };
    } catch {
      onFailure('unavailable');
      return { stop: () => {} };
    }
  }

  // Browser path — unchanged behaviour from the pre-bridge code.
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onFailure('unavailable');
    return { stop: () => {} };
  }
  const id = navigator.geolocation.watchPosition(
    (pos) =>
      onFix({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
    // PERMISSION_DENIED = 1; everything else is a transient fix failure.
    (err) => onFailure(err.code === 1 ? 'denied' : 'unavailable'),
    WATCH_OPTS,
  );
  return {
    stop: () => navigator.geolocation.clearWatch(id),
  };
}

/**
 * One-shot position read (used by the daily-report weather lookup).
 * Resolves null on any failure — callers treat "no location" as a soft
 * miss, never an error state worth blocking on.
 */
export async function getCurrentPosition(): Promise<GeoFix | null> {
  if (isCapacitorNative()) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const status = await Geolocation.requestPermissions();
      const granted =
        status.location === 'granted' || status.coarseLocation === 'granted';
      if (!granted) return null;
      const pos = await Geolocation.getCurrentPosition(WATCH_OPTS);
      return {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
    } catch {
      return null;
    }
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      () => resolve(null),
      WATCH_OPTS,
    );
  });
}
