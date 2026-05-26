# Capacitor native shell — setup guide

This walks through building the iOS + Android shells that wrap the KrakenOps Pro web app for field employees. The shells are thin — they just load the production Vercel deployment inside a WebView and expose the native camera plugin so daily-report photos use the OS camera (better quality, faster, no permission-loop headaches).

You only need to do this once per machine, then `npm run cap:sync` keeps the native projects in sync after web-side updates.

---

## One-time prerequisites

### macOS (for iOS builds)

1. **Xcode** — install from the Mac App Store. Takes ~30 min the first time. Open it once and accept the licence + install command-line tools.
2. **CocoaPods** — `sudo gem install cocoapods` (or `brew install cocoapods` if you use Homebrew).
3. Optional: **Apple Developer account** ($99/yr) — only needed to install on a non-developer iPhone or distribute via TestFlight / App Store. Local-device testing on your own iPhone works with a free Apple ID.

### Windows or macOS (for Android builds)

1. **Android Studio** — https://developer.android.com/studio. ~3 GB download. During setup let it install the Android SDK + an emulator.
2. **JDK 17** — Android Studio bundles a compatible JDK; no separate install needed.
3. Optional: **Google Play Console account** ($25 one-time) — only for Play Store distribution.

---

## First-time native project generation

The `ios/` and `android/` folders are NOT committed to git — they're auto-generated. From the repo root:

```bash
# Add platforms — Capacitor scaffolds the native projects.
npx cap add ios       # macOS only
npx cap add android   # macOS + Windows

# Sync the web bridge into both platforms.
npm run cap:sync
```

This creates:

- `ios/App/` — an Xcode workspace (`App.xcworkspace`)
- `android/` — a Gradle project openable in Android Studio

These are real native projects. Don't delete them once generated; commit them locally if you want reproducible builds (we leave them ignored by default for now since the platforms only matter on your dev machine).

---

## Setting permission strings

The native shells need to declare camera usage so iOS/Android can show a permission prompt with a clear explanation.

### iOS — `ios/App/App/Info.plist`

Open the file in Xcode (right-click → Open As → Source Code) and add:

```xml
<key>NSCameraUsageDescription</key>
<string>KrakenOps Pro uses your camera to attach job-site progress photos to daily reports.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>KrakenOps Pro can pick existing photos from your library to attach to daily reports.</string>
```

### Android — `android/app/src/main/AndroidManifest.xml`

The Capacitor camera plugin auto-adds the `<uses-permission>` lines via its `AndroidManifest.xml` merger. If they don't show up after `cap sync`, add manually:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
```

---

## Running on a real phone

### iOS

```bash
npm run cap:open:ios     # opens Xcode
```

In Xcode:

1. Plug your iPhone in via USB.
2. Top bar → select your iPhone as the run target.
3. Click ▶︎ (or Cmd-R). First run, Xcode will ask you to trust the developer certificate; on your phone, go to **Settings → General → VPN & Device Management → trust your Apple ID**.

The app launches. It immediately loads the production URL (https://contractor-os.vercel.app — change in `capacitor.config.ts` if you wire a custom domain).

### Android

```bash
npm run cap:open:android     # opens Android Studio
```

In Android Studio:

1. Plug your Android phone in via USB and enable USB debugging (Settings → Developer options → USB debugging).
2. Top bar → select your phone as the run target.
3. Click ▶︎ (or Shift-F10).

---

## Updating the app

When you push web-side changes to Vercel, they're **instantly live** on every installed native shell — no rebuild needed. The native shell is just a WebView pointed at the production URL.

You only need to rebuild the native shells when:

- Capacitor itself updates (`npm install @capacitor/core@latest @capacitor/ios@latest ...`).
- A new Capacitor plugin is added (e.g. push notifications, geolocation).
- Permission strings change (Info.plist / AndroidManifest).
- The production URL changes in `capacitor.config.ts`.

After any of those:

```bash
npm run cap:sync
```

Then re-run from Xcode / Android Studio.

---

## Pointing at a different URL (local dev / staging)

For testing against a local dev server or a staging deployment, edit `capacitor.config.ts`:

```ts
server: {
  url: 'http://192.168.1.42:3000',  // your laptop's LAN IP + Next dev port
  cleartext: true,                  // required for plain HTTP
  allowNavigation: ['192.168.1.42'],
}
```

Then `npm run cap:sync` + re-run. The phone WebView will load your dev server, and saved changes hot-reload as usual.

**Don't ship `cleartext: true` to production.** Reset to the Vercel URL before building a release.

---

## App Store / Play Store later

When you're ready to distribute beyond local builds:

- **Apple Developer Program** — $99/yr — enables TestFlight + App Store submission.
- **Google Play Console** — $25 one-time — enables Play Store submission.

Submission process is its own multi-day effort (screenshots, review questionnaire, privacy policy). Out of scope for now.
