import { sentryVitePlugin } from '@sentry/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { externalAssets } from './vite-external.ts';

import pkg from './package.json' with { type: 'json' };

const appVersion = process.env.VITE_APP_VERSION ?? pkg.version;

export default defineConfig({
  plugins: [
    react(),
    externalAssets(),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: {
        name: appVersion,
      },
      sourcemaps: {
        assets: ['dist/**'],
      },
    }),
  ],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
  },
  build: {
    sourcemap: 'hidden',
  },
  server: {
    host: true,
    allowedHosts: true,
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    globals: true,
    setupFiles: ['tests/setup.ts'],
  },
});
