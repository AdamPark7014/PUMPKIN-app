import type { NextConfig } from 'next';
import path from 'node:path';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4000/api/v1';
let apiHostname = '127.0.0.1';
try {
  apiHostname = new URL(apiUrl).hostname;
} catch {
  /* keep default */
}

const nextConfig: NextConfig = {
  transpilePackages: ['@boletera/ui', '@boletera/venue-3d', '@boletera/venue-engine'],
  sassOptions: {
    includePaths: [
      path.join(__dirname, 'styles'),
      path.join(__dirname, '../../packages/ui/src/styles'),
    ],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: '**.amazonaws.com' },
      { protocol: 'https', hostname: '**.cloudfront.net' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'http', hostname: apiHostname },
      { protocol: 'https', hostname: apiHostname },
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'http', hostname: '127.0.0.1' },
    ],
  },
  experimental: {
    optimizePackageImports: ['@boletera/ui'],
  },
};

export default nextConfig;
