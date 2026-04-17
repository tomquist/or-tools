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

// A bounded linear expression -- the output of LinearExpr.equalTo/le/ge/...
// -- is passed to CpModel.add(). Private brand prevents accidental confusion
// with booleans (D15).

import { Domain } from './domain.js';
import { asLinearExpr, type LinearExpr, type LinearExprT, SumArray } from './linearExpr.js';
import { asInt64, INT64_MAX, INT64_MIN, type IntegralT } from './numbers.js';

const brand = Symbol('BoundedLinearExpression');

export class BoundedLinearExpression {
  private readonly [brand] = true;

  readonly expr: LinearExpr;
  readonly domain: Domain;

  private constructor(expr: LinearExpr, domain: Domain) {
    this.expr = expr;
    this.domain = domain;
  }

  static inDomain(expr: LinearExprT, domain: Domain): BoundedLinearExpression {
    return new BoundedLinearExpression(asLinearExpr(expr), domain);
  }

  static range(
    expr: LinearExprT,
    lb: IntegralT,
    ub: IntegralT,
  ): BoundedLinearExpression {
    return new BoundedLinearExpression(
      asLinearExpr(expr),
      Domain.fromInterval(asInt64(lb), asInt64(ub)),
    );
  }

  static equality(left: LinearExprT, right: LinearExprT): BoundedLinearExpression {
    const [expr, rhs] = normalize(left, right);
    return new BoundedLinearExpression(expr, Domain.fromValue(rhs));
  }

  static different(
    left: LinearExprT,
    right: LinearExprT,
  ): BoundedLinearExpression {
    const [expr, rhs] = normalize(left, right);
    return new BoundedLinearExpression(
      expr,
      Domain.fromFlatIntervals([INT64_MIN, rhs - 1n, rhs + 1n, INT64_MAX]),
    );
  }

  static lessOrEqual(
    left: LinearExprT,
    right: LinearExprT,
  ): BoundedLinearExpression {
    const [expr, rhs] = normalize(left, right);
    return new BoundedLinearExpression(expr, Domain.fromInterval(INT64_MIN, rhs));
  }

  static lessThan(
    left: LinearExprT,
    right: LinearExprT,
  ): BoundedLinearExpression {
    const [expr, rhs] = normalize(left, right);
    return new BoundedLinearExpression(expr, Domain.fromInterval(INT64_MIN, rhs - 1n));
  }

  static greaterOrEqual(
    left: LinearExprT,
    right: LinearExprT,
  ): BoundedLinearExpression {
    const [expr, rhs] = normalize(left, right);
    return new BoundedLinearExpression(expr, Domain.fromInterval(rhs, INT64_MAX));
  }

  static greaterThan(
    left: LinearExprT,
    right: LinearExprT,
  ): BoundedLinearExpression {
    const [expr, rhs] = normalize(left, right);
    return new BoundedLinearExpression(expr, Domain.fromInterval(rhs + 1n, INT64_MAX));
  }
}

/**
 * If right is a constant, returns (left, rhs). Otherwise returns
 * (left - right, 0). Matches C#'s AddEquality / AddLessOrEqual etc.
 */
function normalize(
  left: LinearExprT,
  right: LinearExprT,
): [LinearExpr, bigint] {
  if (typeof right === 'bigint' || typeof right === 'number') {
    return [asLinearExpr(left), asInt64(right)];
  }
  // Both sides are expressions -> difference <= 0 / == 0 / >= 0.
  const diff = new SumArray([left, asLinearExpr(right).neg()]);
  return [diff, 0n];
}
