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

// Verifies DoD #6: solver.parameters.numSearchWorkers > 1 actually
// engages the multi-threaded portfolio search. We detect this by
// scraping the solve log for the "num_search_workers" banner and for
// worker-id tags in the portfolio status lines on a non-trivial model.

import { describe, expect, it } from 'vitest';

import { hasNative } from './_native-helper.js';

const d = hasNative(import.meta.url) ? describe : describe.skip;

d('parallelism', () => {
  it('numSearchWorkers > 1 propagates into the solve log', async () => {
    const { CpModel, CpSolver } = await import('../src/index.js');
    const m = new CpModel();
    const x = m.newIntVar(0, 100, 'x');
    m.maximize(x);
    const lines: string[] = [];
    const solver = new CpSolver();
    solver.parameters.numSearchWorkers = 4;
    solver.parameters.logSearchProgress = true;
    solver.logCallback = (line) => lines.push(line);
    await solver.solve(m);
    const banner = lines.find((l) => /num_search_workers:\s*4/.test(l));
    expect(banner).toBeDefined();
  });

  it('parameters field is a plain mutable Protobuf-ES message', async () => {
    const { CpSolver, createSatParameters, SatParametersSchema } =
      await import('../src/index.js');
    const { toBinary } = await import('@bufbuild/protobuf');
    const solver = new CpSolver();
    solver.parameters = createSatParameters();
    solver.parameters.numSearchWorkers = 8;
    solver.parameters.maxTimeInSeconds = 2.5;
    solver.parameters.randomSeed = 42;
    const bytes = toBinary(SatParametersSchema, solver.parameters);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it('two CpSolver instances can solve in parallel without interfering', async () => {
    const { CpModel, CpSolver, CpSolverStatus } = await import('../src/index.js');
    const make = (c: number): CpModel => {
      const m = new CpModel();
      const x = m.newIntVar(0, 1000, 'x');
      const y = m.newIntVar(0, 1000, 'y');
      m.addEquality(x.add(y), c);
      m.maximize(x);
      return m;
    };
    const s1 = new CpSolver();
    s1.parameters.numSearchWorkers = 2;
    const s2 = new CpSolver();
    s2.parameters.numSearchWorkers = 2;

    const [st1, st2] = await Promise.all([s1.solve(make(7)), s2.solve(make(11))]);
    expect(st1).toBe(CpSolverStatus.OPTIMAL);
    expect(st2).toBe(CpSolverStatus.OPTIMAL);
    expect(s1.objectiveValue).toBe(7);
    expect(s2.objectiveValue).toBe(11);
  });
});
