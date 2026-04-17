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

// Re-export the wire-format enum so users can switch on solver.status.
// We do not redeclare values to avoid drift from the proto.

export {
  CpSolverStatus,
  CpSolverStatusSchema,
} from '../proto/ortools/sat/cp_model_pb.js';

import { CpSolverStatus } from '../proto/ortools/sat/cp_model_pb.js';

export function statusName(status: CpSolverStatus): string {
  switch (status) {
    case CpSolverStatus.UNKNOWN:
      return 'UNKNOWN';
    case CpSolverStatus.MODEL_INVALID:
      return 'MODEL_INVALID';
    case CpSolverStatus.FEASIBLE:
      return 'FEASIBLE';
    case CpSolverStatus.INFEASIBLE:
      return 'INFEASIBLE';
    case CpSolverStatus.OPTIMAL:
      return 'OPTIMAL';
    default:
      return `UNKNOWN_STATUS_${String(status)}`;
  }
}
