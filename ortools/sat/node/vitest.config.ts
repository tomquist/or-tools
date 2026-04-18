import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      'tests/fixtures/**',
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
    // The N-API addon spawns C++ solver threads and uses TSFNs that outlive
    // a single worker run. Using forks instead of worker_threads ensures a
    // fresh process per test file so TSFN teardown is deterministic.
    pool: 'forks',
  },
});
