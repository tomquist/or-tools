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

// This file exists solely to be type-checked in the parity test suite. It
// intentionally contains *expected* type errors: the test asserts that each
// `@ts-expect-error` site does indeed trip a TS diagnostic. That in turn
// proves that compile-time guards are in place for:
//   * Passing a generic IntVar (not a BoolVar / NotBoolVar) where a
//     LiteralT is required (D4).
//   * Passing a `boolean` to CpModel.add() (D15 — Python allows it).
//   * Passing `number.MAX_SAFE_INTEGER + 1` as `bigint | number` where
//     safe-int validation rejects it at runtime (there's no compile-time
//     check for this — left as a runtime expectation).

import { CpModel } from '../../src/cp-sat/cpModel.js';

const m = new CpModel();
const intVar = m.newIntVar(0, 10, 'x');
const boolVar = m.newBoolVar('b');

// @ts-expect-error — model.add() requires BoundedLinearExpression, not boolean.
m.add(true);

// @ts-expect-error — passing an IntVar where LiteralT is required.
m.addImplication(intVar, boolVar);

// @ts-expect-error — addBoolOr only accepts literals, not raw IntVar.
m.addBoolOr([intVar]);

// @ts-expect-error — addAssumption demands a literal.
m.addAssumption(intVar);

// @ts-expect-error — addAssumptions demands an iterable of literals.
m.addAssumptions([intVar]);

// @ts-expect-error — Constraint.onlyEnforceIf demands a literal.
m.addAllDifferent(intVar, boolVar).onlyEnforceIf(intVar);

// @ts-expect-error — addCircuit requires a Literal in the 3rd arc slot.
m.addCircuit([[0, 1, intVar]]);

// BoolVar is assignable where IntVar is expected (covariance).
// No error expected here; we keep it as a positive control.
const both: [typeof intVar, typeof boolVar] = [intVar, boolVar];
void both;
