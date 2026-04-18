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

// SolutionContext is the immutable object handed to the user's
// onSolutionCallback(ctx). It exposes the same accessors as CpSolver but
// bound to a snapshot of the current in-flight response.

import type { CpSolverResponse } from '../proto/ortools/sat/cp_model_pb.js';
import type { LiteralT } from './boolVar.js';
import type { LinearExprT } from './linearExpr.js';

export interface SolutionContext {
  /** Value of `expr` in the current partial solution. */
  value(expr: LinearExprT): bigint;
  /** Boolean value of `literal` in the current partial solution. */
  booleanValue(literal: LiteralT): boolean;
  readonly objectiveValue: number;
  readonly bestObjectiveBound: number;
  readonly numBooleans: number;
  readonly numConflicts: number;
  readonly numBranches: number;
  readonly numIntegerPropagations: number;
  readonly numBinaryPropagations: number;
  readonly wallTime: number;
  readonly userTime: number;
  readonly deterministicTime: number;
  /** Full CpSolverResponse snapshot parsed from the addon's bytes. */
  readonly responseProto: CpSolverResponse;
  /** Stops the search asynchronously. */
  stopSearch(): void;
}
