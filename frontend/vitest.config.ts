import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@store': path.resolve(__dirname, './src/store'),
      '@types': path.resolve(__dirname, './src/types'),
    },
  },
  test: {
    // Use jsdom for React component tests
    environment: 'jsdom',
    // Provide global test APIs like expect/vi/describe
    globals: true,
    // Load setup for jest-dom matchers and other globals
    setupFiles: ['src/tests/setupTests.ts'],
    // Match deprecated 'basic' reporter output style
    reporters: [
      [
        'default',
        {
          summary: false,
        },
      ],
    ],
    // Reduce worker parallelism to minimize memory pressure
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
