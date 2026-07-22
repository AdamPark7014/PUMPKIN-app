import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@boletera/ui', '@boletera/venue-3d', '@boletera/venue-engine'],
  sassOptions: {
    includePaths: ['../../packages/ui/src/styles'],
  },
};

export default nextConfig;
