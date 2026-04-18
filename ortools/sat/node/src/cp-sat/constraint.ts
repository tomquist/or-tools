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
import type { ConstraintIndex } from './brand.js';
import type { LiteralT } from './boolVar.js';

export class Constraint {
  readonly index: ConstraintIndex;
  /** Direct access to the underlying proto. Mutating it after add is OK. */
  readonly proto: ConstraintProto;

  constructor(index: ConstraintIndex, proto: ConstraintProto) {
    this.index = index;
    this.proto = proto;
  }

  withName(name: string): this {
    this.proto.name = name;
    return this;
  }

  get name(): string {
    return this.proto.name;
  }

  onlyEnforceIf(literal: LiteralT): this;
  onlyEnforceIf(literals: Iterable<LiteralT>): this;
  onlyEnforceIf(arg: LiteralT | Iterable<LiteralT>): this {
    if (isLiteral(arg)) {
      this.proto.enforcementLiteral.push(arg.literalIndex);
    } else {
      for (const l of arg) this.proto.enforcementLiteral.push(l.literalIndex);
    }
    return this;
  }
}

function isLiteral(x: LiteralT | Iterable<LiteralT>): x is LiteralT {
  return typeof (x as LiteralT).literalIndex === 'number';
}
