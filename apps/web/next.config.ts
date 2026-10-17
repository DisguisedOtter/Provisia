import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@provisia/shared'],
  // Self-contained server for the container image (deploy/containerfiles).
  output: 'standalone',
  webpack: (config) => {
    // Workspace packages use NodeNext-style `./file.js` specifiers that point at `.ts` sources.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
