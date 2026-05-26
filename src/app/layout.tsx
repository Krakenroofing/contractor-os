import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KrakenOps Pro',
  description: 'Job profitability for roofing and general contractors.',
};

// Mobile viewport tuning for the field app.
//
//   width=device-width      — fill the screen, don't render at 980px
//                             scaled-down (the iOS default).
//   initialScale=1          — start at 100% zoom.
//   viewportFit=cover       — render UNDER the iPhone notch / home bar so
//                             our safe-area-inset padding (used in
//                             FieldBottomNav) can do its job.
//   userScalable not blocked — accessibility: never disable pinch-zoom.
//
// maximumScale defaults to ~5x which is fine; we just don't lock it down.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
