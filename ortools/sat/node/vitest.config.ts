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
    // process per test file so TSFN teardown is deterministic. We set
    // singleFork: true so all test files share one fork — running them in
    // parallel forks each loads its own copy of the .node and on
    // memory-constrained CI runners the resulting native-thread fan-out
    // can OOM individual workers, which vitest reports as "Worker exited
    // unexpectedly". Single-fork serializes them, costing a few seconds of
    // wall time but giving deterministic green runs.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
