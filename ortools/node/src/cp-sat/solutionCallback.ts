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

// User-facing solution callback. Mirrors Python / Java:
//   class MyCallback extends CpSolverSolutionCallback {
//     onSolutionCallback(ctx) {
//       console.log(this.value(x), this.objectiveValue);
//     }
//   }
//
// The onSolutionCallback receives an explicit SolutionContext for safety, and
// the shorthand `this.value(...)` / `this.booleanValue(...)` / getters read
// from the currently-active context pushed by the dispatcher (D3).

import type { CpSolverResponse } from '../proto/ortools/sat/cp_model_pb.js';
import { currentContext } from '../internal/currentContext.js';
import type { LiteralT } from './boolVar.js';
import type { LinearExprT } from './linearExpr.js';
import type { SolutionContext } from './solutionContext.js';

export abstract class CpSolverSolutionCallback {
  abstract onSolutionCallback(ctx: SolutionContext): void;

  value(expr: LinearExprT): bigint {
    return currentContext().value(expr);
  }
  booleanValue(literal: LiteralT): boolean {
    return currentContext().booleanValue(literal);
  }
  stopSearch(): void {
    currentContext().stopSearch();
  }
  get objectiveValue(): number {
    return currentContext().objectiveValue;
  }
  get bestObjectiveBound(): number {
    return currentContext().bestObjectiveBound;
  }
  get numBooleans(): number {
    return currentContext().numBooleans;
  }
  get numConflicts(): number {
    return currentContext().numConflicts;
  }
  get numBranches(): number {
    return currentContext().numBranches;
  }
  get numIntegerPropagations(): number {
    return currentContext().numIntegerPropagations;
  }
  get numBinaryPropagations(): number {
    return currentContext().numBinaryPropagations;
  }
  get wallTime(): number {
    return currentContext().wallTime;
  }
  get userTime(): number {
    return currentContext().userTime;
  }
  get deterministicTime(): number {
    return currentContext().deterministicTime;
  }
  get responseProto(): CpSolverResponse {
    return currentContext().responseProto;
  }
}
