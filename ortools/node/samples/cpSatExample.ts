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

// Port of ortools/sat/samples/cp_sat_example.py.

import { CpModel, CpSolver, CpSolverStatus } from '../src/index.js';

async function main(): Promise<void> {
  const model = new CpModel();

  const varUpperBound = Math.max(50, 45, 37);
  const x = model.newIntVar(0, varUpperBound, 'x');
  const y = model.newIntVar(0, varUpperBound, 'y');
  const z = model.newIntVar(0, varUpperBound, 'z');

  model.addLessOrEqual(x.mul(2).add(y.mul(7)).add(z.mul(3)), 50);
  model.addLessOrEqual(x.mul(3).sub(y.mul(5)).add(z.mul(7)), 45);
  model.addLessOrEqual(x.mul(5).add(y.mul(2)).sub(z.mul(6)), 37);
  model.maximize(x.mul(2).add(y.mul(2)).add(z.mul(3)));

  const solver = new CpSolver();
  const status = await solver.solve(model);

  if (status === CpSolverStatus.OPTIMAL || status === CpSolverStatus.FEASIBLE) {
     
    console.log(`Maximum of objective function: ${solver.objectiveValue}`);
     
    console.log(`x = ${solver.value(x)}`);
     
    console.log(`y = ${solver.value(y)}`);
     
    console.log(`z = ${solver.value(z)}`);
  } else {
    console.error(`No solution found. Status: ${solver.statusName()}`);
  }

   
  console.log('Statistics');
   
  console.log(`  status   : ${solver.statusName()}`);
   
  console.log(`  conflicts: ${solver.numConflicts}`);
   
  console.log(`  branches : ${solver.numBranches}`);
   
  console.log(`  wall time: ${solver.wallTime} s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
