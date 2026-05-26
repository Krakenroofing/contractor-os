import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor configuration for the KrakenOps Pro field-app native shell
// (Phase M5). The native shell is a thin wrapper around the production
// Vercel deployment — `server.url` makes the WebView load the live site
// rather than a bundled static export.
//
// Why URL-based:
//   - Server actions + dynamic routes (the entire app) keep working.
//     A static export would forfeit them.
//   - Every Vercel deploy is instantly live on every phone — no
//     app-store re-submission for feature work or bug fixes.
//   - The native shell only needs to be re-released when Capacitor
//     itself updates, native permissions change, or we add a new
//     plugin.
//
// Trade-off accepted: the app needs internet to open. For an internal
// field-crew tool that's expected (Bahamas roofing crews have cell
// signal at every job we've ever taken).
//
// Update `server.url` to the production URL before each native build.
// For local QA you can point it at your dev tunnel — see
// SETUP-CAPACITOR.md.
//
// IMPORTANT: `webDir` must point to a directory that exists at build
// time, even when we're using `server.url`. Capacitor copies its
// runtime bridge into webDir during `cap sync`; the directory itself
// is otherwise unused. `public/` is committed to git and always
// present, so it's the safe pick.

const config: CapacitorConfig = {
  appId: 'com.krakenroofing.krakenops',
  appName: 'KrakenOps Pro',
  webDir: 'public',
  server: {
    // Production URL. Update this when the deployment domain changes.
    // The current Vercel domain — replace if you wire a custom domain.
    url: 'https://contractor-os.vercel.app',
    // cleartext=false enforces HTTPS-only loads (no plain HTTP), which
    // matches Vercel's posture and avoids App Store / Play Store
    // warnings about mixed content.
    cleartext: false,
    // Allow the WebView to forward navigations / requests to the same
    // host. Without this, Android's WebView intercepts links and tries
    // to open them in the system browser, breaking client navigation.
    allowNavigation: ['contractor-os.vercel.app', '*.vercel.app'],
  },
  plugins: {
    // Camera permission strings — surface to the worker the FIRST time
    // they tap "Add photo" so iOS / Android's permission dialog has a
    // legible explanation instead of a default OS string. Required by
    // App Store + Play Store review.
    Camera: {
      // iOS NSCameraUsageDescription
      // Capacitor doesn't read this directly — it has to live in
      // ios/App/App/Info.plist under NSCameraUsageDescription. The
      // SETUP-CAPACITOR.md walkthrough sets it up; this entry is just
      // a reminder of what the prompt should say.
      // (Kept here as a single source of truth.)
      // Sample: "KrakenOps Pro uses your camera to attach job-site
      // progress photos to daily reports."
    },
  },
  ios: {
    // Allows the native shell to access the configured HTTPS origin
    // without ATS exceptions (we never use plain HTTP).
    contentInset: 'always',
  },
  android: {
    // Don't let the WebView's URL bar appear — this is supposed to
    // feel like an app, not a browser.
    allowMixedContent: false,
  },
};

export default config;
