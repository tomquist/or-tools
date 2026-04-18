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

// Branded numeric indices. Zero runtime cost; prevents passing a constraint
// index where a variable index is expected.

declare const _VarIndexBrand: unique symbol;
declare const _ConstraintIndexBrand: unique symbol;
declare const _IntervalIndexBrand: unique symbol;

export type VarIndex = number & { readonly [_VarIndexBrand]: true };
export type ConstraintIndex = number & {
  readonly [_ConstraintIndexBrand]: true;
};
export type IntervalIndex = number & {
  readonly [_IntervalIndexBrand]: true;
};
