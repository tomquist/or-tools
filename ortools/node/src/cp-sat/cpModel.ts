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

// Primary modeling surface. Builds a Protobuf-ES CpModelProto directly and
// exposes the full Python + Java API (D12, D13, D16, D17).

import { clone, create, fromBinary, toBinary } from '@bufbuild/protobuf';

import type {
  AutomatonConstraintProto,
  ConstraintProto,
  CpModelProto,
  DecisionStrategyProto_DomainReductionStrategy,
  DecisionStrategyProto_VariableSelectionStrategy,
  ElementConstraintProto,
  IntegerVariableProto,
  LinearArgumentProto,
  LinearExpressionProto,
  ReservoirConstraintProto,
} from '../proto/ortools/sat/cp_model_pb.js';
import {
  AllDifferentConstraintProtoSchema,
  AutomatonConstraintProtoSchema,
  BoolArgumentProtoSchema,
  CircuitConstraintProtoSchema,
  ConstraintProtoSchema,
  CpModelProtoSchema,
  CpObjectiveProtoSchema,
  CumulativeConstraintProtoSchema,
  DecisionStrategyProtoSchema,
  ElementConstraintProtoSchema,
  FloatObjectiveProtoSchema,
  IntegerVariableProtoSchema,
  IntervalConstraintProtoSchema,
  InverseConstraintProtoSchema,
  LinearArgumentProtoSchema,
  LinearConstraintProtoSchema,
  LinearExpressionProtoSchema,
  NoOverlap2DConstraintProtoSchema,
  NoOverlapConstraintProtoSchema,
  PartialVariableAssignmentSchema,
  ReservoirConstraintProtoSchema,
  RoutesConstraintProtoSchema,
  TableConstraintProtoSchema,
} from '../proto/ortools/sat/cp_model_pb.js';
import { native } from '../internal/native.js';
import {
  asConstraintIndex,
  asIntervalIndex,
  asVarIndex,
  negated,
} from '../internal/varIndex.js';
import { BoolVar, type Literal, type LiteralT, NotBoolVar } from './boolVar.js';
import { BoundedLinearExpression } from './boundedLinearExpression.js';
import type {
  ConstraintIndex,
  IntervalIndex,
  VarIndex,
} from './brand.js';
import { Constraint } from './constraint.js';
import { Domain } from './domain.js';
import { IntVar } from './intVar.js';
import { IntervalVar } from './intervalVar.js';
import {
  asLinearExpr,
  flattenFloat,
  isIntegerFlat,
  LinearExpr,
  type LinearExprT,
} from './linearExpr.js';
import { asInt64, INT64_MAX, INT64_MIN, type IntegralT } from './numbers.js';

// ---------------------------------------------------------------------------
// Helpers for building LinearExpressionProto / LinearArgumentProto
// ---------------------------------------------------------------------------

function makeLinearExpressionProto(
  expr: LinearExprT,
  negate = false,
): LinearExpressionProto {
  const flat = asLinearExpr(expr).flatten();
  if (flat.isFloat) {
    throw new TypeError(
      'cannot use floating-point expression here; CP-SAT proto requires integer coefficients',
    );
  }
  const mult = negate ? -1n : 1n;
  return create(LinearExpressionProtoSchema, {
    vars: [...flat.vars],
    coeffs: flat.coeffs.map((c) => c * mult),
    offset: flat.offset * mult,
  });
}

function makeLinearArgumentProto(
  target: LinearExprT,
  exprs: Iterable<LinearExprT>,
): LinearArgumentProto {
  return create(LinearArgumentProtoSchema, {
    target: makeLinearExpressionProto(target),
    exprs: [...exprs].map((e) => makeLinearExpressionProto(e)),
  });
}

// ---------------------------------------------------------------------------
// Iterable-or-variadic overload collapse.
// ---------------------------------------------------------------------------

function collapseVariadic<T>(args: readonly (T | Iterable<T>)[]): T[] {
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && Symbol.iterator in args[0]) {
    return [...(args[0] as Iterable<T>)];
  }
  return args as T[];
}

// ---------------------------------------------------------------------------
// CpModel
// ---------------------------------------------------------------------------

export class CpModel {
  /** Underlying plain Protobuf-ES message. */
  readonly proto: CpModelProto;

  /** Cache: integer value → variable index, so newConstant is idempotent. */
  private readonly constantMap = new Map<bigint, number>();

  constructor(proto?: CpModelProto) {
    this.proto = proto ?? create(CpModelProtoSchema);
  }

  // ----- Naming ------------------------------------------------------------

  get name(): string {
    return this.proto.name;
  }

  set name(value: string) {
    this.proto.name = value;
  }

  // ----- Variables ---------------------------------------------------------

  newIntVar(lb: IntegralT, ub: IntegralT, name: string): IntVar {
    return this.newIntVarFromDomain(Domain.fromInterval(lb, ub), name);
  }

  newIntVarFromDomain(domain: Domain, name: string): IntVar {
    const v = create(IntegerVariableProtoSchema, {
      name,
      domain: domain.flattenedIntervals(),
    });
    const index = asVarIndex(this.proto.variables.length);
    this.proto.variables.push(v);
    return new IntVar(index, name, domain);
  }

  newBoolVar(name: string): BoolVar {
    const v = create(IntegerVariableProtoSchema, {
      name,
      domain: [0n, 1n],
    });
    const index = asVarIndex(this.proto.variables.length);
    this.proto.variables.push(v);
    return new BoolVar(index, name);
  }

  newConstant(value: IntegralT): IntVar {
    const v = asInt64(value);
    const cached = this.constantMap.get(v);
    if (cached !== undefined) {
      return new IntVar(
        asVarIndex(cached),
        this.proto.variables[cached]!.name,
        Domain.fromValue(v),
      );
    }
    const name = '';
    const proto = create(IntegerVariableProtoSchema, {
      name,
      domain: [v, v],
    });
    const index = this.proto.variables.length;
    this.proto.variables.push(proto);
    this.constantMap.set(v, index);
    return new IntVar(asVarIndex(index), name, Domain.fromValue(v));
  }

  trueLiteral(): Literal {
    const cached = this.constantMap.get(1n);
    if (cached !== undefined) {
      return new BoolVar(asVarIndex(cached), this.proto.variables[cached]!.name);
    }
    const proto = create(IntegerVariableProtoSchema, {
      name: '',
      domain: [1n, 1n],
    });
    const index = this.proto.variables.length;
    this.proto.variables.push(proto);
    this.constantMap.set(1n, index);
    return new BoolVar(asVarIndex(index), '');
  }

  falseLiteral(): Literal {
    const cached = this.constantMap.get(0n);
    if (cached !== undefined) {
      return new BoolVar(asVarIndex(cached), this.proto.variables[cached]!.name);
    }
    const proto = create(IntegerVariableProtoSchema, {
      name: '',
      domain: [0n, 0n],
    });
    const index = this.proto.variables.length;
    this.proto.variables.push(proto);
    this.constantMap.set(0n, index);
    return new BoolVar(asVarIndex(index), '');
  }

  getBoolVarFromProtoIndex(index: number): BoolVar {
    if (index < 0 || index >= this.proto.variables.length) {
      throw new RangeError(`getBoolVarFromProtoIndex: out-of-range index ${index}`);
    }
    const v = this.proto.variables[index]!;
    if (!isBooleanProto(v)) {
      throw new TypeError(
        `getBoolVarFromProtoIndex: index ${index} is not a boolean variable`,
      );
    }
    return new BoolVar(asVarIndex(index), v.name);
  }

  getIntVarFromProtoIndex(index: number): IntVar {
    if (index < 0 || index >= this.proto.variables.length) {
      throw new RangeError(`getIntVarFromProtoIndex: out-of-range index ${index}`);
    }
    const v = this.proto.variables[index]!;
    return new IntVar(
      asVarIndex(index),
      v.name,
      Domain.fromFlatIntervals(v.domain),
    );
  }

  getIntervalVarFromProtoIndex(index: number): IntervalVar {
    if (index < 0 || index >= this.proto.constraints.length) {
      throw new RangeError(
        `getIntervalVarFromProtoIndex: out-of-range constraint index ${index}`,
      );
    }
    const c = this.proto.constraints[index]!;
    if (c.constraint.case !== 'interval') {
      throw new TypeError(
        `getIntervalVarFromProtoIndex: constraint ${index} is not an interval`,
      );
    }
    return new IntervalVar(asIntervalIndex(index), c);
  }

  // ----- Linear constraints (D2 / D12) ------------------------------------

  add(ct: BoundedLinearExpression): Constraint {
    if (!(ct instanceof BoundedLinearExpression)) {
      throw new TypeError(
        'CpModel.add(...) requires a BoundedLinearExpression built from LinearExpr.equalTo/le/ge/... Use addBoolOr([]) / addBoolOr([trueLiteral()]) for tautologies.',
      );
    }
    return this.addLinearExpressionInDomain(ct.expr, ct.domain);
  }

  addLinearConstraint(
    expr: LinearExprT,
    lb: IntegralT,
    ub: IntegralT,
  ): Constraint {
    return this.addLinearExpressionInDomain(expr, Domain.fromInterval(lb, ub));
  }

  addLinearExpressionInDomain(expr: LinearExprT, domain: Domain): Constraint {
    const le = asLinearExpr(expr);
    const flat = le.flatten();
    if (flat.isFloat) {
      throw new TypeError(
        'cannot add a floating-point linear expression; scale to integers first',
      );
    }
    const offset = flat.offset;
    const shifted = domain.flattenedIntervals().map((b) => {
      if (b === INT64_MIN || b === INT64_MAX) return b;
      return b - offset;
    });
    const proto = create(LinearConstraintProtoSchema, {
      vars: [...flat.vars],
      coeffs: [...flat.coeffs],
      domain: shifted,
    });
    return this.addConstraint({ case: 'linear', value: proto });
  }

  // Direct Java-style comparisons.

  addEquality(
    left: LinearExprT,
    rightOrValue: LinearExprT | IntegralT,
  ): Constraint {
    return this.add(BoundedLinearExpression.equality(left, rightOrValue as LinearExprT));
  }
  addDifferent(
    left: LinearExprT,
    rightOrValue: LinearExprT | IntegralT,
  ): Constraint {
    return this.add(
      BoundedLinearExpression.different(left, rightOrValue as LinearExprT),
    );
  }
  addLessOrEqual(
    left: LinearExprT,
    rightOrValue: LinearExprT | IntegralT,
  ): Constraint {
    return this.add(
      BoundedLinearExpression.lessOrEqual(left, rightOrValue as LinearExprT),
    );
  }
  addLessThan(
    left: LinearExprT,
    rightOrValue: LinearExprT | IntegralT,
  ): Constraint {
    return this.add(
      BoundedLinearExpression.lessThan(left, rightOrValue as LinearExprT),
    );
  }
  addGreaterOrEqual(
    left: LinearExprT,
    rightOrValue: LinearExprT | IntegralT,
  ): Constraint {
    return this.add(
      BoundedLinearExpression.greaterOrEqual(left, rightOrValue as LinearExprT),
    );
  }
  addGreaterThan(
    left: LinearExprT,
    rightOrValue: LinearExprT | IntegralT,
  ): Constraint {
    return this.add(
      BoundedLinearExpression.greaterThan(left, rightOrValue as LinearExprT),
    );
  }

  // ----- Boolean constraints ----------------------------------------------

  addBoolOr(literals: Iterable<LiteralT>): Constraint;
  addBoolOr(...literals: LiteralT[]): Constraint;
  addBoolOr(...args: (LiteralT | Iterable<LiteralT>)[]): Constraint {
    const lits = collapseVariadic<LiteralT>(args);
    return this.addBoolArgument('boolOr', lits);
  }

  addAtLeastOne(literals: Iterable<LiteralT>): Constraint;
  addAtLeastOne(...literals: LiteralT[]): Constraint;
  addAtLeastOne(...args: (LiteralT | Iterable<LiteralT>)[]): Constraint {
    const lits = collapseVariadic<LiteralT>(args);
    return this.addBoolArgument('boolOr', lits);
  }

  addBoolAnd(literals: Iterable<LiteralT>): Constraint;
  addBoolAnd(...literals: LiteralT[]): Constraint;
  addBoolAnd(...args: (LiteralT | Iterable<LiteralT>)[]): Constraint {
    const lits = collapseVariadic<LiteralT>(args);
    return this.addBoolArgument('boolAnd', lits);
  }

  addAtMostOne(literals: Iterable<LiteralT>): Constraint;
  addAtMostOne(...literals: LiteralT[]): Constraint;
  addAtMostOne(...args: (LiteralT | Iterable<LiteralT>)[]): Constraint {
    const lits = collapseVariadic<LiteralT>(args);
    return this.addBoolArgument('atMostOne', lits);
  }

  addExactlyOne(literals: Iterable<LiteralT>): Constraint;
  addExactlyOne(...literals: LiteralT[]): Constraint;
  addExactlyOne(...args: (LiteralT | Iterable<LiteralT>)[]): Constraint {
    const lits = collapseVariadic<LiteralT>(args);
    return this.addBoolArgument('exactlyOne', lits);
  }

  addBoolXor(literals: Iterable<LiteralT>): Constraint;
  addBoolXor(...literals: LiteralT[]): Constraint;
  addBoolXor(...args: (LiteralT | Iterable<LiteralT>)[]): Constraint {
    const lits = collapseVariadic<LiteralT>(args);
    return this.addBoolArgument('boolXor', lits);
  }

  addImplication(a: LiteralT, b: LiteralT): Constraint {
    return this.addBoolAnd([b]).onlyEnforceIf(a);
  }

  private addBoolArgument(
    kind: 'boolOr' | 'boolAnd' | 'atMostOne' | 'exactlyOne' | 'boolXor',
    literals: readonly LiteralT[],
  ): Constraint {
    const proto = create(BoolArgumentProtoSchema, {
      literals: literals.map((l) => l.literalIndex),
    });
    return this.addConstraint({ case: kind, value: proto });
  }

  // ----- Integer / general constraints ------------------------------------

  addAllDifferent(expressions: Iterable<LinearExprT>): Constraint;
  addAllDifferent(...expressions: LinearExprT[]): Constraint;
  addAllDifferent(...args: (LinearExprT | Iterable<LinearExprT>)[]): Constraint {
    const exprs = collapseVariadic<LinearExprT>(args);
    const proto = create(AllDifferentConstraintProtoSchema, {
      exprs: exprs.map((e) => makeLinearExpressionProto(e)),
    });
    return this.addConstraint({ case: 'allDiff', value: proto });
  }

  addElement(
    index: LinearExprT,
    expressionsOrValues: Iterable<LinearExprT | IntegralT>,
    target: LinearExprT,
  ): Constraint {
    const entries = [...expressionsOrValues];
    const exprs: LinearExpressionProto[] = entries.map((e) => {
      if (typeof e === 'bigint' || typeof e === 'number') {
        return create(LinearExpressionProtoSchema, { offset: asInt64(e) });
      }
      return makeLinearExpressionProto(e);
    });
    if (exprs.length === 0) {
      throw new Error('addElement expects a non-empty expressions array');
    }
    const proto: ElementConstraintProto = create(ElementConstraintProtoSchema, {
      linearIndex: makeLinearExpressionProto(index),
      linearTarget: makeLinearExpressionProto(target),
      exprs,
    });
    return this.addConstraint({ case: 'element', value: proto });
  }

  addCircuit(arcs: Iterable<readonly [number, number, LiteralT]>): Constraint {
    const list = [...arcs];
    if (list.length === 0) {
      throw new Error('addCircuit expects a non-empty array of arcs');
    }
    const proto = create(CircuitConstraintProtoSchema, {
      tails: list.map(([t]) => t),
      heads: list.map(([, h]) => h),
      literals: list.map(([, , l]) => l.literalIndex),
    });
    return this.addConstraint({ case: 'circuit', value: proto });
  }

  addMultipleCircuit(arcs: Iterable<readonly [number, number, LiteralT]>): Constraint {
    const list = [...arcs];
    if (list.length === 0) {
      throw new Error('addMultipleCircuit expects a non-empty array of arcs');
    }
    const proto = create(RoutesConstraintProtoSchema, {
      tails: list.map(([t]) => t),
      heads: list.map(([, h]) => h),
      literals: list.map(([, , l]) => l.literalIndex),
    });
    return this.addConstraint({ case: 'routes', value: proto });
  }

  addAllowedAssignments(
    expressions: Iterable<LinearExprT>,
    tuples: Iterable<Iterable<IntegralT>>,
  ): Constraint {
    return this.addTable(expressions, tuples, false);
  }

  addForbiddenAssignments(
    expressions: Iterable<LinearExprT>,
    tuples: Iterable<Iterable<IntegralT>>,
  ): Constraint {
    return this.addTable(expressions, tuples, true);
  }

  private addTable(
    expressions: Iterable<LinearExprT>,
    tuples: Iterable<Iterable<IntegralT>>,
    negated: boolean,
  ): Constraint {
    const exprsList = [...expressions];
    if (exprsList.length === 0) {
      throw new Error(
        `${negated ? 'addForbiddenAssignments' : 'addAllowedAssignments'} expects a non-empty expressions array`,
      );
    }
    const flatValues: bigint[] = [];
    for (const tuple of tuples) {
      const arr = [...tuple];
      if (arr.length !== exprsList.length) {
        throw new Error(
          `addAllowedAssignments tuple length ${arr.length} != expressions length ${exprsList.length}`,
        );
      }
      for (const v of arr) flatValues.push(asInt64(v));
    }
    const proto = create(TableConstraintProtoSchema, {
      exprs: exprsList.map((e) => makeLinearExpressionProto(e)),
      values: flatValues,
      negated,
    });
    return this.addConstraint({ case: 'table', value: proto });
  }

  addAutomaton(
    transitionExpressions: Iterable<LinearExprT>,
    startingState: IntegralT,
    finalStates: Iterable<IntegralT>,
    transitionTriples: Iterable<readonly [IntegralT, IntegralT, IntegralT]>,
  ): Constraint {
    const exprs = [...transitionExpressions];
    if (exprs.length === 0) {
      throw new Error('addAutomaton expects non-empty transition_expressions');
    }
    const finals = [...finalStates].map(asInt64);
    if (finals.length === 0) {
      throw new Error('addAutomaton expects some final_states');
    }
    const triples = [...transitionTriples];
    if (triples.length === 0) {
      throw new Error('addAutomaton expects some transition_triples');
    }
    const transitionTail: bigint[] = [];
    const transitionHead: bigint[] = [];
    const transitionLabel: bigint[] = [];
    for (const [t, label, h] of triples) {
      transitionTail.push(asInt64(t));
      transitionLabel.push(asInt64(label));
      transitionHead.push(asInt64(h));
    }
    const proto: AutomatonConstraintProto = create(AutomatonConstraintProtoSchema, {
      exprs: exprs.map((e) => makeLinearExpressionProto(e)),
      startingState: asInt64(startingState),
      finalStates: finals,
      transitionTail,
      transitionHead,
      transitionLabel,
    });
    return this.addConstraint({ case: 'automaton', value: proto });
  }

  addInverse(
    variables: Iterable<IntVar>,
    inverseVariables: Iterable<IntVar>,
  ): Constraint {
    const direct = [...variables];
    const inv = [...inverseVariables];
    if (direct.length === 0 || inv.length === 0) {
      throw new Error('addInverse: arrays must be non-empty');
    }
    if (direct.length !== inv.length) {
      throw new Error('addInverse: arrays must have the same length');
    }
    const proto = create(InverseConstraintProtoSchema, {
      fDirect: direct.map((v) => v.index as number),
      fInverse: inv.map((v) => v.index as number),
    });
    return this.addConstraint({ case: 'inverse', value: proto });
  }

  addReservoirConstraint(
    times: Iterable<LinearExprT>,
    levelChanges: Iterable<LinearExprT>,
    minLevel: IntegralT,
    maxLevel: IntegralT,
  ): Constraint {
    return this.reservoir(times, levelChanges, [], minLevel, maxLevel);
  }

  addReservoirConstraintWithActive(
    times: Iterable<LinearExprT>,
    levelChanges: Iterable<LinearExprT>,
    actives: Iterable<LiteralT>,
    minLevel: IntegralT,
    maxLevel: IntegralT,
  ): Constraint {
    return this.reservoir(times, levelChanges, actives, minLevel, maxLevel);
  }

  private reservoir(
    times: Iterable<LinearExprT>,
    levelChanges: Iterable<LinearExprT>,
    actives: Iterable<LiteralT>,
    minLevel: IntegralT,
    maxLevel: IntegralT,
  ): Constraint {
    const minL = asInt64(minLevel);
    const maxL = asInt64(maxLevel);
    if (maxL < minL) {
      throw new Error('Reservoir constraint requires max_level >= min_level');
    }
    if (maxL < 0n) {
      throw new Error('Reservoir constraint requires max_level >= 0');
    }
    if (minL > 0n) {
      throw new Error('Reservoir constraint requires min_level <= 0');
    }
    const timesList = [...times];
    if (timesList.length === 0) {
      throw new Error('Reservoir constraint requires a non-empty times array');
    }
    const proto: ReservoirConstraintProto = create(ReservoirConstraintProtoSchema, {
      minLevel: minL,
      maxLevel: maxL,
      timeExprs: timesList.map((e) => makeLinearExpressionProto(e)),
      levelChanges: [...levelChanges].map((e) => makeLinearExpressionProto(e)),
      activeLiterals: [...actives].map((l) => l.literalIndex),
    });
    return this.addConstraint({ case: 'reservoir', value: proto });
  }

  /** `var == i + offset <=> bool_var_array[i] == true`, using only_enforce_if. */
  addMapDomain(
    var_: IntVar,
    booleans: Iterable<LiteralT>,
    offset: IntegralT = 0,
  ): void {
    let i = 0n;
    const off = asInt64(offset);
    for (const b of booleans) {
      const v = i + off;
      this.addEquality(var_, v).onlyEnforceIf(b);
      this.addDifferent(var_, v).onlyEnforceIf(b.not());
      i++;
    }
  }

  // ----- min/max/div/mod/prod/abs -----------------------------------------

  addMinEquality(
    target: LinearExprT,
    expressions: Iterable<LinearExprT>,
  ): Constraint;
  addMinEquality(target: LinearExprT, ...expressions: LinearExprT[]): Constraint;
  addMinEquality(
    target: LinearExprT,
    ...args: (LinearExprT | Iterable<LinearExprT>)[]
  ): Constraint {
    const exprs = collapseVariadic<LinearExprT>(args);
    // min(exprs) via lin_max(-exprs) with negated target.
    const proto = create(LinearArgumentProtoSchema, {
      target: makeLinearExpressionProto(target, /*negate=*/ true),
      exprs: exprs.map((e) => makeLinearExpressionProto(e, /*negate=*/ true)),
    });
    return this.addConstraint({ case: 'linMax', value: proto });
  }

  addMaxEquality(
    target: LinearExprT,
    expressions: Iterable<LinearExprT>,
  ): Constraint;
  addMaxEquality(target: LinearExprT, ...expressions: LinearExprT[]): Constraint;
  addMaxEquality(
    target: LinearExprT,
    ...args: (LinearExprT | Iterable<LinearExprT>)[]
  ): Constraint {
    const exprs = collapseVariadic<LinearExprT>(args);
    const proto = makeLinearArgumentProto(target, exprs);
    return this.addConstraint({ case: 'linMax', value: proto });
  }

  addDivisionEquality(
    target: LinearExprT,
    num: LinearExprT,
    denom: LinearExprT,
  ): Constraint {
    const proto = makeLinearArgumentProto(target, [num, denom]);
    return this.addConstraint({ case: 'intDiv', value: proto });
  }

  addModuloEquality(
    target: LinearExprT,
    expr: LinearExprT,
    mod: LinearExprT,
  ): Constraint {
    const proto = makeLinearArgumentProto(target, [expr, mod]);
    return this.addConstraint({ case: 'intMod', value: proto });
  }

  addMultiplicationEquality(
    target: LinearExprT,
    expressions: Iterable<LinearExprT>,
  ): Constraint;
  addMultiplicationEquality(
    target: LinearExprT,
    ...expressions: LinearExprT[]
  ): Constraint;
  addMultiplicationEquality(
    target: LinearExprT,
    ...args: (LinearExprT | Iterable<LinearExprT>)[]
  ): Constraint {
    const exprs = collapseVariadic<LinearExprT>(args);
    const proto = makeLinearArgumentProto(target, exprs);
    return this.addConstraint({ case: 'intProd', value: proto });
  }

  addAbsEquality(target: LinearExprT, expr: LinearExprT): Constraint {
    // abs(expr) = lin_max(expr, -expr).
    const proto = create(LinearArgumentProtoSchema, {
      target: makeLinearExpressionProto(target),
      exprs: [
        makeLinearExpressionProto(expr),
        makeLinearExpressionProto(expr, true),
      ],
    });
    return this.addConstraint({ case: 'linMax', value: proto });
  }

  // ----- Intervals --------------------------------------------------------

  newIntervalVar(
    start: LinearExprT,
    size: LinearExprT,
    end: LinearExprT,
    name: string,
  ): IntervalVar {
    return this.buildIntervalVar(name, start, size, end, []);
  }

  newOptionalIntervalVar(
    start: LinearExprT,
    size: LinearExprT,
    end: LinearExprT,
    isPresent: LiteralT,
    name: string,
  ): IntervalVar {
    return this.buildIntervalVar(name, start, size, end, [isPresent.literalIndex]);
  }

  newFixedSizeIntervalVar(
    start: LinearExprT,
    size: IntegralT,
    name: string,
  ): IntervalVar {
    const sizeConst = asInt64(size);
    const end = asLinearExpr(start).add(sizeConst);
    return this.buildIntervalVar(name, start, sizeConst, end, []);
  }

  newOptionalFixedSizeIntervalVar(
    start: LinearExprT,
    size: IntegralT,
    isPresent: LiteralT,
    name: string,
  ): IntervalVar {
    const sizeConst = asInt64(size);
    const end = asLinearExpr(start).add(sizeConst);
    return this.buildIntervalVar(
      name,
      start,
      sizeConst,
      end,
      [isPresent.literalIndex],
    );
  }

  newFixedInterval(
    start: IntegralT,
    size: IntegralT,
    name: string,
  ): IntervalVar {
    const s = asInt64(start);
    const sz = asInt64(size);
    return this.buildIntervalVar(name, s, sz, s + sz, []);
  }

  newOptionalFixedInterval(
    start: IntegralT,
    size: IntegralT,
    isPresent: LiteralT,
    name: string,
  ): IntervalVar {
    const s = asInt64(start);
    const sz = asInt64(size);
    return this.buildIntervalVar(
      name,
      s,
      sz,
      s + sz,
      [isPresent.literalIndex],
    );
  }

  private buildIntervalVar(
    name: string,
    start: LinearExprT,
    size: LinearExprT,
    end: LinearExprT,
    enforcement: readonly number[],
  ): IntervalVar {
    const intervalProto = create(IntervalConstraintProtoSchema, {
      start: makeLinearExpressionProto(start),
      size: makeLinearExpressionProto(size),
      end: makeLinearExpressionProto(end),
    });
    const ctProto = create(ConstraintProtoSchema, {
      name,
      enforcementLiteral: [...enforcement],
      constraint: { case: 'interval', value: intervalProto },
    });
    const index = this.proto.constraints.length;
    this.proto.constraints.push(ctProto);
    return new IntervalVar(asIntervalIndex(index), ctProto);
  }

  addNoOverlap(intervals: Iterable<IntervalVar>): Constraint {
    const proto = create(NoOverlapConstraintProtoSchema, {
      intervals: [...intervals].map((iv) => iv.index as number),
    });
    return this.addConstraint({ case: 'noOverlap', value: proto });
  }

  addNoOverlap2D(
    xIntervals: Iterable<IntervalVar>,
    yIntervals: Iterable<IntervalVar>,
  ): Constraint {
    const xs = [...xIntervals];
    const ys = [...yIntervals];
    if (xs.length !== ys.length) {
      throw new Error('addNoOverlap2D: x_intervals and y_intervals length mismatch');
    }
    const proto = create(NoOverlap2DConstraintProtoSchema, {
      xIntervals: xs.map((iv) => iv.index as number),
      yIntervals: ys.map((iv) => iv.index as number),
    });
    return this.addConstraint({ case: 'noOverlap2d', value: proto });
  }

  addCumulative(
    intervals: Iterable<IntervalVar>,
    demands: Iterable<LinearExprT>,
    capacity: LinearExprT,
  ): Constraint {
    const proto = create(CumulativeConstraintProtoSchema, {
      capacity: makeLinearExpressionProto(capacity),
      intervals: [...intervals].map((iv) => iv.index as number),
      demands: [...demands].map((e) => makeLinearExpressionProto(e)),
    });
    return this.addConstraint({ case: 'cumulative', value: proto });
  }

  // ----- Objective (D13) --------------------------------------------------

  minimize(expr: LinearExprT): void {
    this.setObjective(expr, /*maximize=*/ false, /*forceFloat=*/ false);
  }
  maximize(expr: LinearExprT): void {
    this.setObjective(expr, /*maximize=*/ true, /*forceFloat=*/ false);
  }
  minimizeFloat(expr: LinearExprT): void {
    this.setObjective(expr, /*maximize=*/ false, /*forceFloat=*/ true);
  }
  maximizeFloat(expr: LinearExprT): void {
    this.setObjective(expr, /*maximize=*/ true, /*forceFloat=*/ true);
  }

  hasObjective(): boolean {
    return this.proto.objective !== undefined ||
      this.proto.floatingPointObjective !== undefined;
  }

  clearObjective(): void {
    delete (this.proto as { objective?: unknown }).objective;
    delete (this.proto as { floatingPointObjective?: unknown }).floatingPointObjective;
  }

  private setObjective(
    expr: LinearExprT,
    maximize: boolean,
    forceFloat: boolean,
  ): void {
    this.clearObjective();
    const le = asLinearExpr(expr);
    const flat = le.flatten();

    if (forceFloat || flat.isFloat) {
      const ff = flattenFloat(le);
      this.proto.floatingPointObjective = create(FloatObjectiveProtoSchema, {
        vars: ff.vars,
        coeffs: ff.coeffs,
        offset: ff.offset,
        maximize,
      });
      return;
    }
    if (!isIntegerFlat(flat)) {
      throw new TypeError('objective expression overflows int64');
    }
    // Integer objective -- mirror Python: for maximize we negate coefficients
    // and offset, and set scaling_factor = -1 so the reported value comes
    // back with the right sign.
    const mult = maximize ? -1n : 1n;
    this.proto.objective = create(CpObjectiveProtoSchema, {
      vars: [...flat.vars],
      coeffs: flat.coeffs.map((c) => c * mult),
      offset: Number(flat.offset) * (maximize ? -1 : 1),
      scalingFactor: maximize ? -1 : 0,
    });
  }

  // ----- Decision strategy ------------------------------------------------

  addDecisionStrategy(
    variables: Iterable<LinearExprT>,
    varStrategy: DecisionStrategyProto_VariableSelectionStrategy,
    domainStrategy: DecisionStrategyProto_DomainReductionStrategy,
  ): void {
    const ds = create(DecisionStrategyProtoSchema, {
      exprs: [...variables].map((v) => makeLinearExpressionProto(v)),
      variableSelectionStrategy: varStrategy,
      domainReductionStrategy: domainStrategy,
    });
    this.proto.searchStrategy.push(ds);
  }

  // ----- Hints ------------------------------------------------------------

  addHint(var_: IntVar, value: IntegralT): void;
  addHint(literal: LiteralT, value: boolean): void;
  addHint(
    target: IntVar | LiteralT,
    value: IntegralT | boolean,
  ): void {
    const hint =
      this.proto.solutionHint ?? create(PartialVariableAssignmentSchema);
    this.proto.solutionHint = hint;
    if (typeof value === 'boolean') {
      const literal = target as LiteralT;
      const idx = literal.literalIndex;
      if (idx >= 0) {
        hint.vars.push(idx);
        hint.values.push(value ? 1n : 0n);
      } else {
        hint.vars.push(negated(idx));
        hint.values.push(value ? 0n : 1n);
      }
    } else {
      const iv = target as IntVar;
      hint.vars.push(iv.index as number);
      hint.values.push(asInt64(value));
    }
  }

  clearHints(): void {
    delete (this.proto as { solutionHint?: unknown }).solutionHint;
  }

  // ----- Assumptions ------------------------------------------------------

  addAssumption(literal: LiteralT): void {
    this.proto.assumptions.push(literal.literalIndex);
  }

  addAssumptions(literals: Iterable<LiteralT>): void {
    for (const l of literals) this.addAssumption(l);
  }

  clearAssumptions(): void {
    this.proto.assumptions = [];
  }

  // ----- Utility / misc ----------------------------------------------------

  negated(index: number): number {
    return negated(index);
  }

  isPositive(literal: LiteralT): boolean {
    return literal.literalIndex >= 0;
  }

  removeAllNames(): void {
    this.proto.name = '';
    for (const v of this.proto.variables) v.name = '';
    for (const c of this.proto.constraints) c.name = '';
  }

  modelStats(): string {
    return native.CpSatHelper.modelStats(this.toBytes());
  }

  validate(): string {
    return native.CpSatHelper.validateModel(this.toBytes());
  }

  exportToFile(path: string): boolean {
    return native.CpSatHelper.writeModelToFile(this.toBytes(), path);
  }

  clone(): CpModel {
    const copy = clone(CpModelProtoSchema, this.proto);
    const out = new CpModel(copy);
    for (const [v, idx] of this.constantMap) out.constantMap.set(v, idx);
    return out;
  }

  toBytes(): Uint8Array {
    return toBinary(CpModelProtoSchema, this.proto);
  }

  static fromBytes(bytes: Uint8Array): CpModel {
    const proto = fromBinary(CpModelProtoSchema, bytes);
    const model = new CpModel(proto);
    // Rebuild constant map by scanning variables with singleton domains and
    // empty names. Mirrors Python's rebuild_constant_map.
    for (let i = 0; i < model.proto.variables.length; i++) {
      const v = model.proto.variables[i]!;
      if (
        v.name === '' &&
        v.domain.length === 2 &&
        v.domain[0] === v.domain[1]
      ) {
        model.constantMap.set(v.domain[0]!, i);
      }
    }
    return model;
  }

  // ----- Internal --------------------------------------------------------

  private addConstraint(body: ConstraintProto['constraint']): Constraint {
    const ct = create(ConstraintProtoSchema, {
      constraint: body,
    });
    const index = this.proto.constraints.length;
    this.proto.constraints.push(ct);
    return new Constraint(asConstraintIndex(index), ct);
  }
}

function isBooleanProto(v: IntegerVariableProto): boolean {
  return (
    v.domain.length === 2 && v.domain[0] === 0n && v.domain[1] === 1n
  );
}

// Exports to help other modules reference the Var index brand types.
export type { ConstraintIndex, IntervalIndex, VarIndex };
