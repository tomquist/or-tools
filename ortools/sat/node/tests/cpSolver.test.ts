// Copyright 2010-2025 Google LLC
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Tests that exercise the native addon. These require the prebuilt .node
// library to exist under prebuilds/<triplet>/. If missing, the test file
// is skipped so developers without a build can still run the pure-TS tests.

import { describe, expect, it } from 'vitest';

import { hasNative } from './_native-helper.js';
// Type-only import: does not trigger loading of the native addon.
import type { SolutionContext } from '../src/index.js';

const skip = !hasNative(import.meta.url);
const d = skip ? describe.skip : describe;

d('CpSolver — native', () => {
  it('solves a trivial feasibility model', async () => {
    const { CpModel, CpSolver, CpSolverStatus } = await import('../src/index.js');
    const m = new CpModel();
    const x = m.newIntVar(1, 1, 'x');
    const solver = new CpSolver();
    const status = await solver.solve(m);
    expect(status).toBe(CpSolverStatus.OPTIMAL);
    expect(solver.value(x)).toBe(1n);
  });

  it('solves x + y == 7 with maximization', async () => {
    const { CpModel, CpSolver, CpSolverStatus } = await import('../src/index.js');
    const m = new CpModel();
    const x = m.newIntVar(0, 10, 'x');
    const y = m.newIntVar(0, 10, 'y');
    m.addEquality(x.add(y), 7);
    m.maximize(x);
    const solver = new CpSolver();
    const status = await solver.solve(m);
    expect(status).toBe(CpSolverStatus.OPTIMAL);
    expect(solver.value(x) + solver.value(y)).toBe(7n);
    expect(solver.objectiveValue).toBe(7);
  });

  it('reports INFEASIBLE on contradictions', async () => {
    const { CpModel, CpSolver, CpSolverStatus } = await import('../src/index.js');
    const m = new CpModel();
    const x = m.newBoolVar('x');
    m.addBoolOr([x]);
    m.addBoolOr([x.not()]);
    m.addEquality(x, 1);
    m.addEquality(x, 0);
    const solver = new CpSolver();
    const status = await solver.solve(m);
    expect(status).toBe(CpSolverStatus.INFEASIBLE);
  });

  it('rejects concurrent solves on the same CpSolver', async () => {
    const { CpModel, CpSolver } = await import('../src/index.js');
    const m = new CpModel();
    m.newIntVar(0, 1_000_000, 'x');
    const solver = new CpSolver();
    solver.parameters.maxTimeInSeconds = 30;
    const p = solver.solve(m);
    await expect(solver.solve(m)).rejects.toThrow(/in flight/);
    await p;
  });

  it('invokes solution callback with immutable ctx', async () => {
    const {
      CpModel,
      CpSolver,
      CpSolverSolutionCallback,
    } = await import('../src/index.js');
    const m = new CpModel();
    const x = m.newIntVar(0, 3, 'x');
    // We use enumerate_all_solutions instead of maximize(x): on a
    // 1-variable model CP-SAT can root-propagate the optimum without
    // emitting any intermediate solution (observed on faster macOS x64
    // runners), leaving the callback uninvoked and racing the
    // `seen > 0` assertion. Enumerate guarantees the callback fires
    // for every feasible value, which is what we actually want to
    // exercise here: that the callback is invoked and that
    // `this.value()` works inside it.
    const seenValues: bigint[] = [];
    class CB extends CpSolverSolutionCallback {
      override onSolutionCallback(): void {
        seenValues.push(this.value(x));
      }
    }
    const solver = new CpSolver();
    // enumerate_all_solutions requires single-threaded search:
    // CP-SAT's worker portfolio doesn't reliably surface intermediate
    // solutions to the callback when parallelism is on, which made
    // this test flaky on the macos-15-intel runner. Pinning workers
    // to 1 makes enumeration deterministic.
    solver.parameters.enumerateAllSolutions = true;
    solver.parameters.numSearchWorkers = 1;
    await solver.solve(m, { callback: new CB() });
    expect(seenValues.length).toBeGreaterThan(0);
    for (const v of seenValues) {
      expect(v >= 0n && v <= 3n).toBe(true);
    }
  });

  // Regression: looping solve() with a (possibly empty) solution callback used
  // to segfault ~30-50% of the time at process teardown because the
  // SolutionBridge's TSFN was Unref'd and could outlive the bridge object,
  // dangling pointers held by queued payloads. The bridge is now owned by its
  // TSFN finalizer; this test would crash the worker if that contract
  // regressed.
  it(
    'survives many solves with a solution callback (lifetime regression)',
    async () => {
      const {
        CpModel,
        CpSolver,
        CpSolverSolutionCallback,
        CpSolverStatus,
      } = await import('../src/index.js');
      const feasible = new Set([
        CpSolverStatus.OPTIMAL,
        CpSolverStatus.FEASIBLE,
      ]);
      class Printer extends CpSolverSolutionCallback {
        override onSolutionCallback(ctx: SolutionContext): void {
          // Touch the context whenever it fires so a use-after-free in the
          // bridge/TSFN teardown path would surface here. We do NOT assert on
          // how often it fires: CP-SAT may solve the optimum in presolve
          // without emitting a solution callback, and the async TSFN dispatch
          // can drop trailing callbacks on a fast solve. Neither affects the
          // teardown crash-safety this test guards.
          void ctx.objectiveValue;
        }
      }
      // The rc.1 teardown segfault reproduced ~30-50% of the time; loop enough
      // iterations that a regression is very likely to trip at least once.
      // The oracle is deterministic — every solve must be feasible and return
      // the correct minimizer — and a torn-down bridge would crash the worker
      // rather than fail an assertion. Each iteration attaches a callback so
      // the bridge is created and released on all 25 cycles.
      const iterations = 25;
      let completed = 0;
      for (let i = 0; i < iterations; i++) {
        const m = new CpModel();
        const s = m.newIntVar(0, 8, 's');
        m.newIntervalVar(s, 2, m.newIntVar(2, 8, 'e'), 'iv');
        m.minimize(s);
        const solver = new CpSolver();
        solver.parameters.numWorkers = 1;
        const status = await solver.solve(m, { callback: new Printer() });
        expect(feasible.has(status)).toBe(true);
        expect(solver.value(s)).toBe(0n);
        completed++;
      }
      expect(completed).toBe(iterations);
    },
    60_000,
  );

  it('stopSearch cancels a long solve within DoD budget (<500ms post-stop)', async () => {
    const { CpModel, CpSolver } = await import('../src/index.js');
    const m = new CpModel();
    // Intentionally loose model so the solver spins.
    const vars = [];
    for (let i = 0; i < 20; i++) {
      vars.push(m.newIntVar(0, 1_000_000, `x${i}`));
    }
    m.addAllDifferent(vars);
    m.maximize(vars[0]!);
    const solver = new CpSolver();
    solver.parameters.maxTimeInSeconds = 30;
    const pending = solver.solve(m);
    // Give the solver time to actually start, then measure from the moment
    // stopSearch() fires to the moment the promise resolves.
    await new Promise((r) => setTimeout(r, 50));
    const stopAt = Date.now();
    solver.stopSearch();
    await pending;
    const dt = Date.now() - stopAt;
    expect(dt).toBeLessThan(500);
  });

  it('AbortSignal resolves with partial response (D7)', async () => {
    const { CpModel, CpSolver } = await import('../src/index.js');
    const m = new CpModel();
    const vars = [];
    for (let i = 0; i < 20; i++) {
      vars.push(m.newIntVar(0, 1_000_000, `x${i}`));
    }
    m.addAllDifferent(vars);
    m.maximize(vars[0]!);
    const solver = new CpSolver();
    solver.parameters.maxTimeInSeconds = 30;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    // Should resolve, not reject.
    await expect(
      solver.solve(m, { signal: controller.signal }),
    ).resolves.toBeDefined();
  });

  it('logCallback receives log lines', async () => {
    const { CpModel, CpSolver } = await import('../src/index.js');
    const m = new CpModel();
    const x = m.newIntVar(0, 100, 'x');
    m.maximize(x);
    const lines: string[] = [];
    const solver = new CpSolver();
    solver.parameters.logSearchProgress = true;
    solver.logCallback = (line) => lines.push(line);
    await solver.solve(m);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('bestBoundCallback receives finite bound updates during optimization', async () => {
    const { CpModel, CpSolver, CpSolverStatus, LinearExpr } = await import(
      '../src/index.js'
    );
    const m = new CpModel();
    const xs = [];
    for (let i = 0; i < 15; i++) xs.push(m.newIntVar(0, 100, `x${i}`));
    const total = LinearExpr.sum(xs);
    m.addLessOrEqual(total, 500);
    m.maximize(total);
    const bounds: number[] = [];
    const solver = new CpSolver();
    solver.parameters.numSearchWorkers = 1;
    solver.parameters.maxTimeInSeconds = 10;
    solver.bestBoundCallback = (b) => bounds.push(b);
    const status = await solver.solve(m);
    expect(status).toBe(CpSolverStatus.OPTIMAL);
    expect(bounds.length).toBeGreaterThan(0);
    for (const b of bounds) expect(Number.isFinite(b)).toBe(true);
  });
});
