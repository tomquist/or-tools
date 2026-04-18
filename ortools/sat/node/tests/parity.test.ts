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

// Parity audit against the Python and Java CP-SAT bindings. Asserts that
// every public method we committed to exposing (per the review matrix)
// really does exist on the corresponding TS class. Also verifies that the
// three constraint-construction styles (D12) produce byte-identical protos.

import { describe, expect, it } from 'vitest';
import { CpModel } from '../src/cp-sat/cpModel.js';
import { CpSolver } from '../src/cp-sat/cpSolver.js';
import { CpSolverSolutionCallback } from '../src/cp-sat/solutionCallback.js';

/** Methods ported from Python `cp_model.CpModel` + Java `CpModel`. */
const CP_MODEL_METHODS = [
  // Variables
  'newIntVar',
  'newIntVarFromDomain',
  'newBoolVar',
  'newConstant',
  'trueLiteral',
  'falseLiteral',
  'getBoolVarFromProtoIndex',
  'getIntVarFromProtoIndex',
  'getIntervalVarFromProtoIndex',
  // Intervals
  'newIntervalVar',
  'newOptionalIntervalVar',
  'newFixedSizeIntervalVar',
  'newOptionalFixedSizeIntervalVar',
  'newFixedInterval',
  'newOptionalFixedInterval',
  // Linear constraints
  'add',
  'addLinearConstraint',
  'addLinearExpressionInDomain',
  'addEquality',
  'addDifferent',
  'addLessOrEqual',
  'addLessThan',
  'addGreaterOrEqual',
  'addGreaterThan',
  // Integer / general
  'addAllDifferent',
  'addElement',
  'addAllowedAssignments',
  'addForbiddenAssignments',
  'addAutomaton',
  'addInverse',
  'addReservoirConstraint',
  'addReservoirConstraintWithActive',
  'addMapDomain',
  'addImplication',
  // Boolean
  'addBoolOr',
  'addBoolAnd',
  'addAtMostOne',
  'addExactlyOne',
  'addAtLeastOne',
  'addBoolXor',
  // Arithmetic
  'addMinEquality',
  'addMaxEquality',
  'addDivisionEquality',
  'addModuloEquality',
  'addMultiplicationEquality',
  'addAbsEquality',
  // Scheduling
  'addNoOverlap',
  'addNoOverlap2D',
  'addCumulative',
  // Routing
  'addCircuit',
  'addMultipleCircuit',
  // Objective
  'minimize',
  'maximize',
  'minimizeFloat',
  'maximizeFloat',
  'hasObjective',
  'clearObjective',
  // Hints / assumptions / strategies
  'addDecisionStrategy',
  'addHint',
  'clearHints',
  'addAssumption',
  'addAssumptions',
  'clearAssumptions',
  // Utility
  'negated',
  'isPositive',
  'removeAllNames',
  'modelStats',
  'validate',
  'exportToFile',
  'clone',
  'toBytes',
] as const;

const CP_MODEL_STATIC_METHODS = ['fromBytes'] as const;

/** Methods / getters ported from Python `CpSolver` + Java `CpSolver`. */
const CP_SOLVER_METHODS = [
  'solve',
  'stopSearch',
  'value',
  'floatValue',
  'booleanValue',
  'statusName',
  'responseStats',
  'sufficientAssumptionsForInfeasibility',
  'setLogCallback',
  'clearLogCallback',
  'setBestBoundCallback',
  'clearBestBoundCallback',
] as const;

const CP_SOLVER_GETTERS = [
  'objectiveValue',
  'bestObjectiveBound',
  'numBooleans',
  'numConflicts',
  'numBranches',
  'numBinaryPropagations',
  'numIntegerPropagations',
  'wallTime',
  'userTime',
  'deterministicTime',
  'status',
  'solutionInfo',
  'solveLog',
  'response',
  'responseProto',
] as const;

const CB_MEMBERS = [
  'onSolutionCallback',
  'value',
  'booleanValue',
  'stopSearch',
] as const;
const CB_GETTERS = [
  'objectiveValue',
  'bestObjectiveBound',
  'numBooleans',
  'numConflicts',
  'numBranches',
  'numIntegerPropagations',
  'numBinaryPropagations',
  'wallTime',
  'userTime',
  'deterministicTime',
  'responseProto',
] as const;

describe('API parity matrix', () => {
  const model = new CpModel();
  const solver = new CpSolver();

  for (const m of CP_MODEL_METHODS) {
    it(`CpModel has method ${m}`, () => {
      expect(typeof (model as unknown as Record<string, unknown>)[m]).toBe(
        'function',
      );
    });
  }

  for (const m of CP_MODEL_STATIC_METHODS) {
    it(`CpModel.${m} is a static method`, () => {
      expect(
        typeof (CpModel as unknown as Record<string, unknown>)[m],
      ).toBe('function');
    });
  }

  for (const m of CP_SOLVER_METHODS) {
    it(`CpSolver has method ${m}`, () => {
      expect(typeof (solver as unknown as Record<string, unknown>)[m]).toBe(
        'function',
      );
    });
  }

  for (const g of CP_SOLVER_GETTERS) {
    it(`CpSolver has getter ${g}`, () => {
      // Getters require accessing them for `typeof` — we can check they're
      // defined on the prototype chain instead.
      const proto = Object.getPrototypeOf(solver) as object;
      expect(
        Object.getOwnPropertyDescriptor(proto, g) !== undefined ||
          g in solver,
      ).toBe(true);
    });
  }

  class DummyCb extends CpSolverSolutionCallback {
    override onSolutionCallback(): void {
      /* noop */
    }
  }
  const cb = new DummyCb();
  for (const m of CB_MEMBERS) {
    it(`CpSolverSolutionCallback has ${m}`, () => {
      expect(typeof (cb as unknown as Record<string, unknown>)[m]).toBe(
        'function',
      );
    });
  }
  for (const g of CB_GETTERS) {
    it(`CpSolverSolutionCallback has getter ${g}`, () => {
      const proto = Object.getPrototypeOf(cb) as object;
      // The getter is defined on the abstract base, walk up.
      const base = Object.getPrototypeOf(proto) as object;
      expect(Object.getOwnPropertyDescriptor(base, g)).toBeDefined();
    });
  }
});

describe('Three-style constraint equivalence (D12)', () => {
  function build(emit: (m: CpModel) => void): Uint8Array {
    const m = new CpModel();
    m.newIntVar(0, 10, 'x'); // placeholder to stabilise ordering
    emit(m);
    return m.toBytes();
  }

  it('addEquality via all three styles', () => {
    const fluent = build((m) => {
      const x = m.newIntVar(0, 10, 'y');
      m.add(x.equalTo(5));
    });
    const alias = build((m) => {
      const x = m.newIntVar(0, 10, 'y');
      m.add(x.eq(5));
    });
    const direct = build((m) => {
      const x = m.newIntVar(0, 10, 'y');
      m.addEquality(x, 5);
    });
    expect(fluent).toEqual(alias);
    expect(fluent).toEqual(direct);
  });

  it('addLessOrEqual via all three styles', () => {
    const fluent = build((m) => {
      const x = m.newIntVar(0, 10, 'y');
      m.add(x.lessOrEqual(5));
    });
    const alias = build((m) => {
      const x = m.newIntVar(0, 10, 'y');
      m.add(x.le(5));
    });
    const direct = build((m) => {
      const x = m.newIntVar(0, 10, 'y');
      m.addLessOrEqual(x, 5);
    });
    expect(fluent).toEqual(alias);
    expect(fluent).toEqual(direct);
  });

  it('addGreaterThan via all three styles', () => {
    const fluent = build((m) => {
      const x = m.newIntVar(0, 10, 'y');
      m.add(x.greaterThan(5));
    });
    const alias = build((m) => {
      const x = m.newIntVar(0, 10, 'y');
      m.add(x.gt(5));
    });
    const direct = build((m) => {
      const x = m.newIntVar(0, 10, 'y');
      m.addGreaterThan(x, 5);
    });
    expect(fluent).toEqual(alias);
    expect(fluent).toEqual(direct);
  });
});
