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

// Re-exports the Protobuf-ES SatParameters plain message and a helper to
// construct one. Protobuf-ES v2 generates plain object types + a separate
// Schema descriptor, so users mutate fields directly:
//
//   const params = createSatParameters();
//   params.maxTimeInSeconds = 5;
//   params.numSearchWorkers = 8;

import { create } from '@bufbuild/protobuf';

import {
  SatParameters as SatParametersType,
  SatParametersSchema,
} from '../proto/ortools/sat/sat_parameters_pb.js';

export type SatParameters = SatParametersType;
export { SatParametersSchema };

export function createSatParameters(): SatParameters {
  return create(SatParametersSchema);
}
