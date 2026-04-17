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
import type { Domain } from './domain.js';
import { LinearExpr, type LinearAccumulator } from './linearExpr.js';

export class IntVar extends LinearExpr {
  readonly index: VarIndex;
  readonly name: string;
  readonly domain: Domain;

  constructor(index: VarIndex, name: string, domain: Domain) {
    super();
    this.index = index;
    this.name = name;
    this.domain = domain;
  }

  override accumulate(sink: LinearAccumulator, coeff: bigint | number): void {
    sink.addTerm(this.index as number, coeff);
  }

  toString(): string {
    return this.name || `var#${String(this.index)}`;
  }
}
