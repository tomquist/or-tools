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
import { CpModel } from '../src/cp-sat/cpModel.js';
import { LinearExpr } from '../src/cp-sat/linearExpr.js';

describe('LinearExpr', () => {
  it('fluent add/sub/mul flattens correctly', () => {
    const m = new CpModel();
    const x = m.newIntVar(0, 10, 'x');
    const y = m.newIntVar(0, 10, 'y');
    const e = x.mul(2).add(y.mul(3)).sub(5);
    const flat = e.flatten();
    expect(flat.isFloat).toBe(false);
    expect(flat.offset).toBe(-5n);
    // Map back for stable assertion.
    const map = new Map<number, bigint>();
    for (let i = 0; i < flat.vars.length; i++) map.set(flat.vars[i]!, flat.coeffs[i]!);
    expect(map.get(x.index as number)).toBe(2n);
    expect(map.get(y.index as number)).toBe(3n);
  });

  it('LinearExpr.sum and weightedSum', () => {
    const m = new CpModel();
    const x = m.newIntVar(0, 10, 'x');
    const y = m.newIntVar(0, 10, 'y');
    const s = LinearExpr.sum([x, y]).flatten();
    expect(s.offset).toBe(0n);
    expect(s.coeffs.reduce((a, b) => a + b, 0n)).toBe(2n);

    const w = LinearExpr.weightedSum([x, y], [3, 7]).flatten();
    const wmap = new Map<number, bigint>();
    for (let i = 0; i < w.vars.length; i++) wmap.set(w.vars[i]!, w.coeffs[i]!);
    expect(wmap.get(x.index as number)).toBe(3n);
    expect(wmap.get(y.index as number)).toBe(7n);
  });

  it('NotBoolVar flattens to (1 - b)', () => {
    const m = new CpModel();
    const b = m.newBoolVar('b');
    const e = b.not().flatten();
    expect(e.offset).toBe(1n);
    expect(e.vars).toEqual([b.index as number]);
    expect(e.coeffs).toEqual([-1n]);
  });

  it('comparison methods produce the same BoundedLinearExpression', () => {
    const m = new CpModel();
    const x = m.newIntVar(0, 10, 'x');
    const a = x.equalTo(5);
    const b = x.eq(5);
    expect(a.expr.flatten().vars).toEqual(b.expr.flatten().vars);
    expect(a.domain.flattenedIntervals()).toEqual(b.domain.flattenedIntervals());
  });

  it('fluent operator-derived constraint matches direct addEquality', () => {
    const m1 = new CpModel();
    const x1 = m1.newIntVar(0, 10, 'x');
    const y1 = m1.newIntVar(0, 10, 'y');
    m1.add(x1.add(y1).equalTo(7));

    const m2 = new CpModel();
    const x2 = m2.newIntVar(0, 10, 'x');
    const y2 = m2.newIntVar(0, 10, 'y');
    m2.addEquality(x2.add(y2), 7);

    // Alias route
    const m3 = new CpModel();
    const x3 = m3.newIntVar(0, 10, 'x');
    const y3 = m3.newIntVar(0, 10, 'y');
    m3.add(x3.add(y3).eq(7));

    const c1 = m1.proto.constraints[0]!.constraint;
    const c2 = m2.proto.constraints[0]!.constraint;
    const c3 = m3.proto.constraints[0]!.constraint;
    expect(c1.case).toBe('linear');
    expect(c2.case).toBe('linear');
    expect(c3.case).toBe('linear');
    expect(JSON.stringify(c1, bigstr)).toBe(JSON.stringify(c2, bigstr));
    expect(JSON.stringify(c1, bigstr)).toBe(JSON.stringify(c3, bigstr));
  });
});

function bigstr(_k: string, v: unknown): unknown {
  return typeof v === 'bigint' ? v.toString() : v;
}
