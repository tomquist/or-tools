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

// Cross-language equivalence: build the canonical CP-SAT example model in TS,
// then solve the same model proto via the C-API entry point and compare to
// the high-level CpSolver. Both paths must yield the same status and
// objective value, demonstrating that the TS modeling layer produces a
// CpModelProto byte-stream that's behaviorally identical to what Python /
// Java / Go would produce for the equivalent model.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromBinary, toBinary } from '@bufbuild/protobuf';

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

d('Cross-binding equivalence', () => {
  it('CpSolver and the C-API path agree on the canonical CP-SAT example', async () => {
    const {
      CpModel,
      CpSolver,
      CpSolverResponseSchema,
      SatParametersSchema,
      createSatParameters,
    } = await import('../src/index.js');
    const { native } = await import('../src/internal/native.js');

    const model = new CpModel();
    const x = model.newIntVar(0, 50, 'x');
    const y = model.newIntVar(0, 50, 'y');
    const z = model.newIntVar(0, 50, 'z');
    model.addLessOrEqual(x.mul(2).add(y.mul(7)).add(z.mul(3)), 50);
    model.addLessOrEqual(x.mul(3).sub(y.mul(5)).add(z.mul(7)), 45);
    model.addLessOrEqual(x.mul(5).add(y.mul(2)).sub(z.mul(6)), 37);
    model.maximize(x.mul(2).add(y.mul(2)).add(z.mul(3)));

    const params = createSatParameters();
    const paramsBytes = toBinary(SatParametersSchema, params);

    const cApiBytes = await native.cApi.solve(model.toBytes(), paramsBytes);
    const cApiResp = fromBinary(CpSolverResponseSchema, cApiBytes);

    const solver = new CpSolver();
    await solver.solve(model);

    expect(cApiResp.status).toBe(solver.status);
    expect(cApiResp.objectiveValue).toBe(solver.objectiveValue);
  });
});
