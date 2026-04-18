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

import { describe, expect, it } from 'vitest';
import { BoolVar } from '../src/cp-sat/boolVar.js';
import { CpModel } from '../src/cp-sat/cpModel.js';
import { Domain } from '../src/cp-sat/domain.js';

describe('CpModel — variable creation', () => {
  it('newIntVar appends a variable', () => {
    const m = new CpModel();
    const x = m.newIntVar(0, 10, 'x');
    expect(m.proto.variables.length).toBe(1);
    expect(m.proto.variables[0]!.name).toBe('x');
    expect(x.name).toBe('x');
    expect(x.domain.flattenedIntervals()).toEqual([0n, 10n]);
  });

  it('newBoolVar returns a BoolVar', () => {
    const m = new CpModel();
    const b = m.newBoolVar('b');
    expect(b).toBeInstanceOf(BoolVar);
    expect(b.literalIndex).toBe(b.index as number);
    expect(b.not().literalIndex).toBe(-(b.index as number) - 1);
  });

  it('newConstant reuses the same index', () => {
    const m = new CpModel();
    const c1 = m.newConstant(42);
    const c2 = m.newConstant(42);
    expect(c1.index).toBe(c2.index);
  });

  it('newIntVarFromDomain accepts multi-interval domains', () => {
    const m = new CpModel();
    const dom = Domain.fromIntervals([[1, 3], [7, 9]]);
    const x = m.newIntVarFromDomain(dom, 'x');
    expect(m.proto.variables[0]!.domain).toEqual([1n, 3n, 7n, 9n]);
    expect(x.domain.flattenedIntervals()).toEqual([1n, 3n, 7n, 9n]);
  });
});

describe('CpModel — rebuild from bytes (D16)', () => {
  it('round-trips through toBytes / fromBytes', () => {
    const m = new CpModel();
    const x = m.newIntVar(0, 10, 'x');
    const y = m.newIntVar(0, 10, 'y');
    const b = m.newBoolVar('b');
    m.addEquality(x.add(y), 7).onlyEnforceIf(b);
    m.maximize(x.mul(2).add(y));

    const bytes = m.toBytes();
    const r = CpModel.fromBytes(bytes);
    expect(r.toBytes()).toEqual(bytes);

    const x2 = r.getIntVarFromProtoIndex(x.index as number);
    expect(x2.name).toBe('x');
    const b2 = r.getBoolVarFromProtoIndex(b.index as number);
    expect(b2.literalIndex).toBe(b.literalIndex);
  });

  it('getBoolVarFromProtoIndex rejects non-boolean variable', () => {
    const m = new CpModel();
    const x = m.newIntVar(0, 10, 'x');
    expect(() => m.getBoolVarFromProtoIndex(x.index as number)).toThrow(TypeError);
  });
});

describe('CpModel — three-style constraint equivalence', () => {
  it('addEquality via fluent / alias / direct emit identical proto bytes', () => {
    function build(mode: 'fluent' | 'alias' | 'direct'): Uint8Array {
      const m = new CpModel();
      const x = m.newIntVar(0, 10, 'x');
      const y = m.newIntVar(0, 10, 'y');
      if (mode === 'fluent') m.add(x.add(y).equalTo(7));
      else if (mode === 'alias') m.add(x.add(y).eq(7));
      else m.addEquality(x.add(y), 7);
      return m.toBytes();
    }
    const a = build('fluent');
    const b = build('alias');
    const c = build('direct');
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });

  it('addLessOrEqual equivalence', () => {
    function build(mode: 'fluent' | 'direct'): Uint8Array {
      const m = new CpModel();
      const x = m.newIntVar(0, 10, 'x');
      if (mode === 'fluent') m.add(x.lessOrEqual(5));
      else m.addLessOrEqual(x, 5);
      return m.toBytes();
    }
    expect(build('fluent')).toEqual(build('direct'));
  });
});

describe('CpModel — boolean constraints', () => {
  it('addBoolOr supports both variadic and iterable', () => {
    const m1 = new CpModel();
    const a1 = m1.newBoolVar('a');
    const b1 = m1.newBoolVar('b');
    m1.addBoolOr(a1, b1);
    const m2 = new CpModel();
    const a2 = m2.newBoolVar('a');
    const b2 = m2.newBoolVar('b');
    m2.addBoolOr([a2, b2]);
    expect(m1.toBytes()).toEqual(m2.toBytes());
  });
});

describe('CpModel — objective detection', () => {
  it('integer objective populates objective field', () => {
    const m = new CpModel();
    const x = m.newIntVar(0, 10, 'x');
    m.maximize(x.mul(3));
    expect(m.proto.objective).toBeDefined();
    expect(m.proto.floatingPointObjective).toBeUndefined();
  });

  it('float objective populates floating_point_objective', () => {
    const m = new CpModel();
    const x = m.newIntVar(0, 10, 'x');
    m.minimizeFloat(x.mul(0.5));
    expect(m.proto.floatingPointObjective).toBeDefined();
    expect(m.proto.objective).toBeUndefined();
  });
});

describe('CpModel.add rejects non-BoundedLinearExpression (D15)', () => {
  it('rejects raw booleans', () => {
    const m = new CpModel();
    // @ts-expect-error — boolean is rejected at compile time.
    expect(() => m.add(true)).toThrow(TypeError);
  });
});
