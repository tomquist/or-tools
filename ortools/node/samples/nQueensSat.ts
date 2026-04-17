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

// Port of ortools/sat/samples/nqueens_sat.py. Finds the number of solutions
// to the N-Queens problem via enumeration.

import {
  CpModel,
  CpSolver,
  CpSolverSolutionCallback,
  LinearExpr,
  type IntVar,
} from '../src/index.js';

class NQueenPrinter extends CpSolverSolutionCallback {
  count = 0;
  constructor(private readonly queens: readonly IntVar[]) {
    super();
  }
  override onSolutionCallback(): void {
    this.count++;
  }
}

async function main(): Promise<void> {
  const n = 8;
  const model = new CpModel();
  const queens: IntVar[] = [];
  for (let i = 0; i < n; i++) queens.push(model.newIntVar(0, n - 1, `Q${i}`));

  // Rows all distinct.
  model.addAllDifferent(queens);
  // Anti-diagonals all distinct.
  const antiDiag = queens.map((q, i) => LinearExpr.affine(q, 1, i));
  model.addAllDifferent(antiDiag);
  // Diagonals all distinct.
  const diag = queens.map((q, i) => LinearExpr.affine(q, 1, -i));
  model.addAllDifferent(diag);

  const solver = new CpSolver();
  solver.parameters.enumerateAllSolutions = true;
  const cb = new NQueenPrinter(queens);
  await solver.solve(model, { callback: cb });

   
  console.log(`Solutions found: ${cb.count}`);
   
  console.log(`Wall time: ${solver.wallTime} s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
