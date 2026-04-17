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

// Port of ortools/sat/samples/assignment_sat.py.

import {
  CpModel,
  CpSolver,
  CpSolverStatus,
  LinearExpr,
  type BoolVar,
} from '../src/index.js';

async function main(): Promise<void> {
  const costs: number[][] = [
    [90, 80, 75, 70],
    [35, 85, 55, 65],
    [125, 95, 90, 95],
    [45, 110, 95, 115],
    [50, 100, 90, 100],
  ];
  const numWorkers = costs.length;
  const numTasks = costs[0]!.length;

  const model = new CpModel();

  const x: BoolVar[][] = [];
  for (let w = 0; w < numWorkers; w++) {
    const row: BoolVar[] = [];
    for (let t = 0; t < numTasks; t++) {
      row.push(model.newBoolVar(`x[${w},${t}]`));
    }
    x.push(row);
  }

  // Each worker is assigned to at most one task.
  for (let w = 0; w < numWorkers; w++) {
    model.addAtMostOne(x[w]!);
  }

  // Each task is assigned to exactly one worker.
  for (let t = 0; t < numTasks; t++) {
    const literals = x.map((row) => row[t]!);
    model.addExactlyOne(literals);
  }

  // Objective: minimize total cost.
  const terms = [];
  const weights = [];
  for (let w = 0; w < numWorkers; w++) {
    for (let t = 0; t < numTasks; t++) {
      terms.push(x[w]![t]!);
      weights.push(costs[w]![t]!);
    }
  }
  model.minimize(LinearExpr.weightedSum(terms, weights));

  const solver = new CpSolver();
  const status = await solver.solve(model);

  if (status === CpSolverStatus.OPTIMAL || status === CpSolverStatus.FEASIBLE) {
     
    console.log(`Total cost = ${solver.objectiveValue}`);
    for (let w = 0; w < numWorkers; w++) {
      for (let t = 0; t < numTasks; t++) {
        if (solver.booleanValue(x[w]![t]!)) {
           
          console.log(
            `Worker ${w} assigned to task ${t} with cost ${costs[w]![t]}`,
          );
        }
      }
    }
  } else {
    console.error(`No solution found. Status: ${solver.statusName()}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
