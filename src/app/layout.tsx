import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KrakenOps Pro',
  description: 'Job profitability for roofing and general contractors.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
