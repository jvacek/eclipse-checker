import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { externalAssets } from './vite-external.ts';

export default defineConfig({
  plugins: [react(), externalAssets()],
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
