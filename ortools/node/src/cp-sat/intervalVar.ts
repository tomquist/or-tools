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

import type { ConstraintProto } from '../proto/ortools/sat/cp_model_pb.js';
import type { IntervalIndex } from './brand.js';

export class IntervalVar {
  readonly index: IntervalIndex;
  readonly proto: ConstraintProto;

  constructor(index: IntervalIndex, proto: ConstraintProto) {
    this.index = index;
    this.proto = proto;
  }

  get name(): string {
    return this.proto.name;
  }
}
