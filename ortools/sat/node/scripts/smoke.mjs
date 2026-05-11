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

// End-to-end smoke test: build a tiny CP-SAT model, solve it, assert the
// expected optimum. Used by both the PR packaging dry-run in
// .github/workflows/node_prebuild.yml and the release verification step
// in .github/workflows/node_release.yml. Intended to be `node`-run from a
// scratch directory that has just `npm install`'d the @ortools-node/cp-sat
// tarball plus the matching platform tarball.
//
// Not shipped in the published package; CI paths copy the file in.

import { CpModel, CpSolver, CpSolverStatus } from '@ortools-node/cp-sat';

const m = new CpModel();
const x = m.newIntVar(0n, 10n, 'x');
const y = m.newIntVar(0n, 10n, 'y');
m.addEquality(x.add(y), 7);
m.maximize(x);

const s = new CpSolver();
const status = await s.solve(m);
if (status !== CpSolverStatus.OPTIMAL) {
  console.error('expected OPTIMAL, got', status);
  process.exit(1);
}
const xv = s.value(x);
const yv = s.value(y);
if (xv + yv !== 7n) {
  console.error('expected x+y=7, got', xv, yv);
  process.exit(1);
}
console.log('smoke OK: x =', xv.toString(), 'y =', yv.toString());
