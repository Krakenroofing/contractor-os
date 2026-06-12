// Native camera bridge for the field-app photo upload.
//
// The @capacitor/camera plugin returns either a base64 string or a
// file URI depending on `resultType`. We force base64 (DataUrl) so the
// returned blob round-trips cleanly through a fetch() → Blob → File
// chain, ready to be appended to FormData and posted to the same
// server action the browser file picker uses.
//
// Why base64 instead of a file URI: the URI lives in the iOS/Android
// app sandbox; the WebView can read it via the bridge but the resulting
// blob still requires conversion. base64 is one less hop and keeps the
// upload codepath identical to the browser flow.
//
// This module is browser-only — server components must never import it
// (the dynamic import below is the gatekeeper). Bundling protection
// also relies on `'use client'` directives in the calling components.

import { isCapacitorNative } from './runtime';

export type NativePhotoResult = {
  file: File;
  /** Original MIME — image/jpeg in practice on both platforms. */
  mimeType: string;
};

/** Where the native picker should pull the photo from. */
export type NativePhotoSource = 'camera' | 'photos';

/**
 * Open the native camera OR photo library and return the chosen photo as a
 * File ready to attach to FormData. Returns null when:
 *   - Not running in a Capacitor shell (caller should use <input file>)
 *   - The user cancels the capture
 *   - The plugin import fails (defensive — shouldn't happen at runtime)
 *
 * Throws on actual capture errors so the caller can surface them.
 *
 * @param source 'camera' shoots a new photo; 'photos' opens the gallery.
 */
export async function captureNativePhoto(
  source: NativePhotoSource = 'camera',
): Promise<NativePhotoResult | null> {
  if (!isCapacitorNative()) return null;

  // Dynamic import keeps @capacitor/camera out of the browser bundle.
  // Webpack would otherwise include the plugin's Cordova-style shims
  // in every web page, bloating /field/* by ~30KB even for users on
  // their phone browser.
  const { Camera, CameraResultType, CameraSource } = await import(
    '@capacitor/camera'
  );

  let photo;
  try {
    photo = await Camera.getPhoto({
      // DataUrl gives us "data:image/jpeg;base64,..." which is the
      // easiest path to a File blob; see fetch() conversion below.
      resultType: CameraResultType.DataUrl,
      // 80% JPEG quality is a good middle ground — visibly identical
      // to 100% for site photos, ~3x smaller files, faster uploads on
      // spotty cell signal.
      quality: 80,
      // Camera shoots a new photo; Photos opens the device gallery so
      // workers can attach pictures they already took.
      source:
        source === 'photos' ? CameraSource.Photos : CameraSource.Camera,
      // Don't let the user edit / crop in the native UI — the field
      // crew shouldn't be punching down photos before sending.
      allowEditing: false,
      // Sensible upper bound. Phone cameras shoot 4032x3024 by default
      // (~12MP); resizing here matches the 10MB server limit comfortably.
      width: 2048,
      saveToGallery: false,
    });
  } catch (err: unknown) {
    // The plugin throws when the user cancels. Treat cancel as a
    // null return rather than an error; surface other failures.
    const message =
      err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (message.includes('cancel')) return null;
    throw err;
  }

  if (!photo.dataUrl) return null;

  // Convert "data:image/jpeg;base64,..." → Blob → File by decoding the
  // base64 payload directly. (This used to fetch() the data URL, but
  // fetching data: URLs is inconsistently supported inside iOS/Android
  // WebViews — a silent point of failure on the exact devices the field
  // crew uses.) The native plugin doesn't expose a file name, so we
  // synthesize one with a timestamp so the server-side storage uploader
  // has something sensible to log.
  const comma = photo.dataUrl.indexOf(',');
  if (comma < 0) return null;
  const header = photo.dataUrl.slice(0, comma);
  const mime = /^data:([^;]+)/.exec(header)?.[1] ?? 'image/jpeg';
  const binary = atob(photo.dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const ext =
    mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const name = `field-${Date.now()}.${ext}`;
  const file = new File([blob], name, { type: mime });
  return { file, mimeType: mime };
}
