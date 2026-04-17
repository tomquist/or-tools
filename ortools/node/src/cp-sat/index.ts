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

// Public surface for @google-ortools/cp-sat.

export {
  BoolVar,
  NotBoolVar,
  type Literal,
  type LiteralT,
} from './boolVar.js';
export { BoundedLinearExpression } from './boundedLinearExpression.js';
export type {
  ConstraintIndex,
  IntervalIndex,
  VarIndex,
} from './brand.js';
export { Constraint } from './constraint.js';
export { CpModel } from './cpModel.js';
export { CpSolver, type SolveOptions } from './cpSolver.js';
export { Domain } from './domain.js';
export { IntVar } from './intVar.js';
export { IntervalVar } from './intervalVar.js';
export {
  Affine,
  Constant,
  LinearExpr,
  type LinearExprT,
  SumArray,
  WeightedSum,
} from './linearExpr.js';
export {
  INT32_MAX,
  INT32_MIN,
  INT64_MAX,
  INT64_MIN,
  type IntegralT,
} from './numbers.js';
export {
  createSatParameters,
  type SatParameters,
  SatParametersSchema,
} from './parameters.js';
export { CpSolverSolutionCallback } from './solutionCallback.js';
export type { SolutionContext } from './solutionContext.js';
export { CpSolverStatus, CpSolverStatusSchema, statusName } from './status.js';

// Useful re-exports from the generated protobuf layer.
export type {
  CpModelProto,
  CpSolverResponse,
  ConstraintProto,
  DecisionStrategyProto_DomainReductionStrategy,
  DecisionStrategyProto_VariableSelectionStrategy,
  IntegerVariableProto,
  LinearExpressionProto,
} from '../proto/ortools/sat/cp_model_pb.js';
export {
  CpModelProtoSchema,
  CpSolverResponseSchema,
  DecisionStrategyProto_DomainReductionStrategy as DomainReductionStrategy,
  DecisionStrategyProto_VariableSelectionStrategy as VariableSelectionStrategy,
} from '../proto/ortools/sat/cp_model_pb.js';
