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

// CpModelProto reference encoding helpers. A "literal" reference is a signed
// int32 where >= 0 means "the variable at that index" and < 0 means "the
// negation of the variable at index -i - 1". This convention is shared with
// every other binding (Python, Java, C#, Go).

import type { ConstraintIndex, IntervalIndex, VarIndex } from '../cp-sat/brand.js';

export function negated(index: number): number {
  return -index - 1;
}

export function isPositiveIndex(index: number): boolean {
  return index >= 0;
}

export function asVarIndex(n: number): VarIndex {
  return n as VarIndex;
}

export function asConstraintIndex(n: number): ConstraintIndex {
  return n as ConstraintIndex;
}

export function asIntervalIndex(n: number): IntervalIndex {
  return n as IntervalIndex;
}
