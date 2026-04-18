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

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readdirSync } from 'node:fs';

function hasNative(): boolean {
  const dir =
    process.platform === 'win32'
      ? 'win32-x64'
      : process.platform === 'darwin'
        ? `darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
        : `linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;
  const prebuilds = join(import.meta.dirname, '..', 'prebuilds', dir);
  try {
    return readdirSync(prebuilds).some((f) => f.endsWith('.node'));
  } catch {
    return existsSync(join(prebuilds, 'node.napi.node'));
  }
}

const skip = !hasNative();
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
    m.maximize(x);

    let seen = 0;
    let lastValue = 0n;
    class CB extends CpSolverSolutionCallback {
      override onSolutionCallback(): void {
        seen++;
        lastValue = this.value(x);
      }
    }
    const solver = new CpSolver();
    await solver.solve(m, { callback: new CB() });
    expect(seen).toBeGreaterThan(0);
    expect(lastValue).toBe(3n);
  });

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
});
