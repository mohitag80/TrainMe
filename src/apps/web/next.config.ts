import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const config: NextConfig = {
  // Self-contained server bundle for the container image; tracing starts at the monorepo root.
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../../..', import.meta.url)),
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
