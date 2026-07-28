import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@boletera/ui', '@boletera/venue-engine'],
};

export default nextConfig;
