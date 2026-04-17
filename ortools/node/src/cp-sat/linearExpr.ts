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

// Linear-expression algebra. Mirrors the Python / Java / C# bindings: build a
// tree of LinearExpr nodes through fluent / static helpers, then flatten to
// `{vars, coeffs, offset}` for embedding into LinearExpressionProto or
// LinearConstraintProto.

import { BoundedLinearExpression } from './boundedLinearExpression.js';
import { Domain } from './domain.js';
import {
  asInt64,
  fitsInSafeNumber,
  INT64_MAX,
  INT64_MIN,
  type IntegralT,
} from './numbers.js';

/** Anything that can be coerced into a LinearExpr. */
export type LinearExprT = LinearExpr | bigint | number;

/** Sparse flattened representation of a linear expression. */
export interface FlatLinearExpr {
  vars: number[];
  coeffs: bigint[];
  offset: bigint;
  /** True iff the expression contained any non-integer floating coefficient. */
  isFloat: boolean;
}

/** Flat representation including a float component. */
export interface FlatFloatExpr {
  vars: number[];
  coeffs: number[];
  offset: number;
}

// ----------------------------------------------------------------------------
// Accumulator used by the flattening virtual methods.
// ----------------------------------------------------------------------------

export interface LinearAccumulator {
  /** Adds `weight` to the coefficient of variable `varIndex`. */
  addTerm(varIndex: number, weight: bigint | number): void;
  /** Adds `amount` to the constant offset. */
  addOffset(amount: bigint | number): void;
  /** Hint that we've seen a non-integer contribution. */
  markFloat(): void;
}

export abstract class LinearExpr {
  /**
   * Accumulates `coeff * self` into `sink`. Subclasses override this for
   * efficient flattening. Values may be `bigint` or `number`; the sink is
   * responsible for promoting to float when necessary.
   */
  abstract accumulate(sink: LinearAccumulator, coeff: bigint | number): void;

  /** Flattens `self` into `{vars, coeffs, offset}`. */
  flatten(): FlatLinearExpr {
    return buildFlat(this);
  }

  // ---- Static helpers (parity with Python / Java) --------------------------

  static sum(exprs: Iterable<LinearExprT>): LinearExpr {
    return new SumArray([...exprs]);
  }

  static weightedSum(
    exprs: Iterable<LinearExprT>,
    coeffs: Iterable<IntegralT | number>,
  ): LinearExpr {
    return new WeightedSum([...exprs], [...coeffs]);
  }

  static term(expr: LinearExprT, coeff: IntegralT | number): LinearExpr {
    return new Affine(expr, coeff, 0n);
  }

  static affine(
    expr: LinearExprT,
    coeff: IntegralT | number,
    offset: IntegralT | number,
  ): LinearExpr {
    return new Affine(expr, coeff, offset);
  }

  static constant(value: IntegralT | number): LinearExpr {
    return new Constant(value);
  }

  // ---- Fluent algebra ------------------------------------------------------

  add(other: LinearExprT): LinearExpr {
    return new SumArray([this, other]);
  }
  sub(other: LinearExprT): LinearExpr {
    return new SumArray([this, LinearExpr.term(other, -1)]);
  }
  mul(coeff: IntegralT | number): LinearExpr {
    return new Affine(this, coeff, 0n);
  }
  neg(): LinearExpr {
    return new Affine(this, -1n, 0n);
  }

  // ---- Comparison constructors --------------------------------------------
  // Canonical names + short aliases (D2 / D12).

  equalTo(rhs: LinearExprT): BoundedLinearExpression {
    return BoundedLinearExpression.equality(this, rhs);
  }
  notEqualTo(rhs: LinearExprT): BoundedLinearExpression {
    return BoundedLinearExpression.different(this, rhs);
  }
  lessOrEqual(rhs: LinearExprT): BoundedLinearExpression {
    return BoundedLinearExpression.lessOrEqual(this, rhs);
  }
  lessThan(rhs: LinearExprT): BoundedLinearExpression {
    return BoundedLinearExpression.lessThan(this, rhs);
  }
  greaterOrEqual(rhs: LinearExprT): BoundedLinearExpression {
    return BoundedLinearExpression.greaterOrEqual(this, rhs);
  }
  greaterThan(rhs: LinearExprT): BoundedLinearExpression {
    return BoundedLinearExpression.greaterThan(this, rhs);
  }

  // Aliases (parity with Python's operator-derived names).
  eq(rhs: LinearExprT): BoundedLinearExpression {
    return this.equalTo(rhs);
  }
  ne(rhs: LinearExprT): BoundedLinearExpression {
    return this.notEqualTo(rhs);
  }
  le(rhs: LinearExprT): BoundedLinearExpression {
    return this.lessOrEqual(rhs);
  }
  lt(rhs: LinearExprT): BoundedLinearExpression {
    return this.lessThan(rhs);
  }
  ge(rhs: LinearExprT): BoundedLinearExpression {
    return this.greaterOrEqual(rhs);
  }
  gt(rhs: LinearExprT): BoundedLinearExpression {
    return this.greaterThan(rhs);
  }

  // ---- Convenience: in-domain ---------------------------------------------

  inDomain(domain: Domain): BoundedLinearExpression {
    return BoundedLinearExpression.inDomain(this, domain);
  }
}

export function asLinearExpr(value: LinearExprT): LinearExpr {
  if (value instanceof LinearExpr) return value;
  return new Constant(value);
}

// ----------------------------------------------------------------------------
// Concrete nodes
// ----------------------------------------------------------------------------

export class Constant extends LinearExpr {
  readonly value: bigint | number;

  constructor(value: IntegralT | number) {
    super();
    this.value =
      typeof value === 'number' && !Number.isInteger(value) ? value : asInt64(value);
  }

  override accumulate(sink: LinearAccumulator, coeff: bigint | number): void {
    sink.addOffset(mul(coeff, this.value));
  }
}

export class Affine extends LinearExpr {
  readonly inner: LinearExpr;
  readonly coeff: bigint | number;
  readonly offset: bigint | number;

  constructor(
    inner: LinearExprT,
    coeff: IntegralT | number,
    offset: IntegralT | number,
  ) {
    super();
    this.inner = asLinearExpr(inner);
    this.coeff =
      typeof coeff === 'number' && !Number.isInteger(coeff) ? coeff : asInt64(coeff);
    this.offset =
      typeof offset === 'number' && !Number.isInteger(offset)
        ? offset
        : asInt64(offset);
  }

  override accumulate(sink: LinearAccumulator, coeff: bigint | number): void {
    sink.addOffset(mul(coeff, this.offset));
    this.inner.accumulate(sink, mul(coeff, this.coeff));
  }
}

export class SumArray extends LinearExpr {
  readonly terms: readonly LinearExpr[];

  constructor(terms: Iterable<LinearExprT>) {
    super();
    this.terms = [...terms].map(asLinearExpr);
  }

  override accumulate(sink: LinearAccumulator, coeff: bigint | number): void {
    for (const t of this.terms) t.accumulate(sink, coeff);
  }
}

export class WeightedSum extends LinearExpr {
  readonly terms: readonly LinearExpr[];
  readonly weights: readonly (bigint | number)[];

  constructor(
    terms: Iterable<LinearExprT>,
    weights: Iterable<IntegralT | number>,
  ) {
    super();
    this.terms = [...terms].map(asLinearExpr);
    this.weights = [...weights].map((w) =>
      typeof w === 'number' && !Number.isInteger(w) ? w : asInt64(w),
    );
    if (this.terms.length !== this.weights.length) {
      throw new Error(
        `LinearExpr.weightedSum: ${this.terms.length} terms but ${this.weights.length} weights`,
      );
    }
  }

  override accumulate(sink: LinearAccumulator, coeff: bigint | number): void {
    for (let i = 0; i < this.terms.length; i++) {
      this.terms[i]!.accumulate(sink, mul(coeff, this.weights[i]!));
    }
  }
}

// ----------------------------------------------------------------------------
// Arithmetic helpers
// ----------------------------------------------------------------------------

export function mul(a: bigint | number, b: bigint | number): bigint | number {
  if (typeof a === 'bigint' && typeof b === 'bigint') return a * b;
  return Number(a) * Number(b);
}

// ----------------------------------------------------------------------------
// Flatten
// ----------------------------------------------------------------------------

function buildFlat(root: LinearExpr): FlatLinearExpr {
  const coeffMap = new Map<number, bigint>();
  const floatCoeffMap = new Map<number, number>();
  let offset: bigint = 0n;
  let floatOffset = 0;
  let isFloat = false;

  const sink: LinearAccumulator = {
    markFloat() {
      if (!isFloat) {
        isFloat = true;
        // Migrate.
        for (const [k, v] of coeffMap) floatCoeffMap.set(k, Number(v));
        coeffMap.clear();
        floatOffset += Number(offset);
        offset = 0n;
      }
    },
    addTerm(varIndex, weight) {
      if (typeof weight === 'number' && !Number.isInteger(weight)) this.markFloat();
      if (isFloat) {
        const prev = floatCoeffMap.get(varIndex) ?? 0;
        const next = prev + Number(weight);
        if (next === 0) floatCoeffMap.delete(varIndex);
        else floatCoeffMap.set(varIndex, next);
        return;
      }
      const prev = coeffMap.get(varIndex) ?? 0n;
      const next = prev + (weight as bigint);
      if (next === 0n) coeffMap.delete(varIndex);
      else coeffMap.set(varIndex, next);
    },
    addOffset(amount) {
      if (typeof amount === 'number' && !Number.isInteger(amount)) this.markFloat();
      if (isFloat) floatOffset += Number(amount);
      else offset += amount as bigint;
    },
  };

  root.accumulate(sink, 1n);

  if (isFloat) {
    return {
      vars: [...floatCoeffMap.keys()],
      coeffs: [...floatCoeffMap.values()].map((n) => {
        // Coefficients are stored as numbers in the float path; the caller
        // who needs float objective coefficients should use flattenFloat().
        // For the integer view we just return a bigint-compatible form for
        // audit, but callers must check isFloat.
        return BigInt(Math.trunc(n));
      }),
      offset: 0n,
      isFloat: true,
    };
  }
  return {
    vars: [...coeffMap.keys()],
    coeffs: [...coeffMap.values()],
    offset,
    isFloat: false,
  };
}

/** Returns a FlatFloatExpr for objectives that contain floating coefficients. */
export function flattenFloat(root: LinearExpr): FlatFloatExpr {
  const coeffMap = new Map<number, number>();
  let offset = 0;

  const sink: LinearAccumulator = {
    markFloat() {
      // no-op; we're already float.
    },
    addTerm(varIndex, weight) {
      const w = Number(weight);
      const prev = coeffMap.get(varIndex) ?? 0;
      const next = prev + w;
      if (next === 0) coeffMap.delete(varIndex);
      else coeffMap.set(varIndex, next);
    },
    addOffset(amount) {
      offset += Number(amount);
    },
  };

  root.accumulate(sink, 1);
  return { vars: [...coeffMap.keys()], coeffs: [...coeffMap.values()], offset };
}

/** True iff every coeff/offset fits int64 and there's no float. */
export function isIntegerFlat(flat: FlatLinearExpr): boolean {
  if (flat.isFloat) return false;
  if (flat.offset < INT64_MIN || flat.offset > INT64_MAX) return false;
  for (const c of flat.coeffs) {
    if (c < INT64_MIN || c > INT64_MAX) return false;
  }
  return true;
}

/** True iff every numeric value is representable as a JS number. */
export function isFlatSafe(flat: FlatLinearExpr): boolean {
  if (!fitsInSafeNumber(flat.offset)) return false;
  for (const c of flat.coeffs) if (!fitsInSafeNumber(c)) return false;
  return true;
}
