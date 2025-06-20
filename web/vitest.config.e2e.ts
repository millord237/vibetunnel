import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // NO SETUP FILES - we want raw, unmocked environment
    include: ['src/test/e2e/**/*.test.ts'],
    testTimeout: 60000, // E2E tests need more time
    hookTimeout: 30000, // Cleanup hooks need time too
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});