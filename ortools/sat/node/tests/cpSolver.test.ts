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
    // Mirror the reference binding's own callback test
    // (ortools/sat/python/cp_model_test.py::test_search_for_all_solutions):
    // a constrained two-variable model, x + y == 6 with x,y in [0,5]. This
    // forces the solver to actually enumerate during search (5 solutions),
    // which reliably invokes the callback. A single free variable is instead
    // resolved in presolve/root and does NOT reliably emit per-solution
    // callbacks, which was the real cause of the macOS CI flake.
    const x = m.newIntVar(0, 5, 'x');
    const y = m.newIntVar(0, 5, 'y');
    m.add(x.add(y).equalTo(6));
    const seenValues: bigint[] = [];
    class CB extends CpSolverSolutionCallback {
      override onSolutionCallback(): void {
        // this.value(...) reads the thread-local active context.
        seenValues.push(this.value(x));
      }
    }
    const solver = new CpSolver();
    solver.parameters.enumerateAllSolutions = true;
    await solver.solve(m, { callback: new CB() });
    // Exactly the five feasible x values (x + y == 6, y in [0,5] => x in [1,5]).
    expect(seenValues.length).toBe(5);
    for (const v of seenValues) {
      expect(v >= 1n && v <= 5n).toBe(true);
    }
  });

  it('delivers every enumerated solution before solve() resolves', async () => {
    const {
      CpModel,
      CpSolver,
      CpSolverSolutionCallback,
    } = await import('../src/index.js');
    // Same reliable enumeration model as above (x + y == 6 => 5 solutions).
    const m = new CpModel();
    const x = m.newIntVar(0, 5, 'x');
    const y = m.newIntVar(0, 5, 'y');
    m.add(x.add(y).equalTo(6));
    const seen: bigint[] = [];
    class CB extends CpSolverSolutionCallback {
      override onSolutionCallback(ctx: SolutionContext): void {
        seen.push(ctx.value(x));
      }
    }
    const solver = new CpSolver();
    solver.parameters.enumerateAllSolutions = true;
    await solver.solve(m, { callback: new CB() });
    // Regression guard for the solution-dispatch drain: every solution found
    // during the solve must be delivered to the callback *before* the promise
    // resolves. Without drain-before-resolve a fast solve could resolve while
    // callbacks were still queued on the JS thread, dropping the tail (and
    // sometimes the whole batch). All five must be present here, matching the
    // synchronous all-callbacks-before-return contract of the Python/Java
    // bindings.
    const sorted = [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(sorted).toEqual([1n, 2n, 3n, 4n, 5n]);
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

  it('bestBoundCallback receives the objective bound', async () => {
    const { CpModel, CpSolver, CpSolverStatus } = await import('../src/index.js');
    // Mirror the reference binding's best-bound test
    // (ortools/sat/python/cp_model_test.py::test_best_bound_callback): a small
    // boolean model with a float objective, num_workers=1 and
    // linearization_level=2 so the LP relaxation produces a bound the callback
    // reports. The optimal bound is 2.6.
    const m = new CpModel();
    const x0 = m.newBoolVar('x0');
    const x1 = m.newBoolVar('x1');
    const x2 = m.newBoolVar('x2');
    const x3 = m.newBoolVar('x3');
    m.addBoolOr([x0, x1, x2, x3]);
    m.minimizeFloat(
      x0.mul(3).add(x1.mul(2)).add(x2.mul(4)).add(x3.mul(5)).add(0.6),
    );
    let lastBound = 0;
    let calls = 0;
    const solver = new CpSolver();
    solver.parameters.numWorkers = 1;
    solver.parameters.linearizationLevel = 2;
    solver.bestBoundCallback = (b) => {
      lastBound = b;
      calls++;
    };
    const status = await solver.solve(m);
    expect(status).toBe(CpSolverStatus.OPTIMAL);
    expect(calls).toBeGreaterThan(0);
    expect(lastBound).toBeCloseTo(2.6, 6);
  });
});
