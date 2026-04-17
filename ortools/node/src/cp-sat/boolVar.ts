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

import type { VarIndex } from './brand.js';
import { Domain } from './domain.js';
import { IntVar } from './intVar.js';
import { LinearExpr, mul, type LinearAccumulator } from './linearExpr.js';

/** A Literal is either a BoolVar or its negation. */
export interface Literal {
  /**
   * Proto-level signed literal: >= 0 = variable index, < 0 = negation
   * encoded as (-index - 1).
   */
  readonly literalIndex: number;
  readonly name: string;
  not(): Literal;
}

export class BoolVar extends IntVar implements Literal {
  constructor(index: VarIndex, name: string) {
    super(index, name, Domain.fromInterval(0, 1));
  }

  get literalIndex(): number {
    return this.index as number;
  }

  not(): Literal {
    return new NotBoolVar(this);
  }
}

export class NotBoolVar extends LinearExpr implements Literal {
  readonly negatedOf: BoolVar;

  constructor(bool: BoolVar) {
    super();
    this.negatedOf = bool;
  }

  get literalIndex(): number {
    return -(this.negatedOf.index as number) - 1;
  }

  get name(): string {
    return `not(${this.negatedOf.name})`;
  }

  /** not(b) == 1 - b. */
  override accumulate(sink: LinearAccumulator, coeff: bigint | number): void {
    sink.addOffset(coeff);
    sink.addTerm(this.negatedOf.index as number, mul(coeff, -1n));
  }

  not(): Literal {
    return this.negatedOf;
  }

  toString(): string {
    return this.name;
  }
}

/** Type union for `model.add*` methods that take a literal. */
export type LiteralT = Literal;
