import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // Server actions default to 1 MB body size — the receipt uploader
    // allows 25 MB per file and supports multi-receipt PDFs that can
    // easily exceed that. Lift the cap to 50 MB so the bulk-upload
    // flow actually works end-to-end.
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
