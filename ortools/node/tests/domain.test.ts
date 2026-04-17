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
import { Domain } from '../src/cp-sat/domain.js';
import { INT64_MAX, INT64_MIN } from '../src/cp-sat/numbers.js';

describe('Domain', () => {
  it('fromInterval canonicalises', () => {
    const d = Domain.fromInterval(3, 7);
    expect(d.flattenedIntervals()).toEqual([3n, 7n]);
    expect(d.min()).toBe(3n);
    expect(d.max()).toBe(7n);
    expect(d.size()).toBe(5);
  });

  it('fromValues merges adjacent values', () => {
    const d = Domain.fromValues([1, 2, 3, 6, 8, 7]);
    expect(d.flattenedIntervals()).toEqual([1n, 3n, 6n, 8n]);
  });

  it('fromIntervals merges overlapping', () => {
    const d = Domain.fromIntervals([[1, 5], [4, 8], [10, 12]]);
    expect(d.flattenedIntervals()).toEqual([1n, 8n, 10n, 12n]);
  });

  it('union / intersectionWith / negation', () => {
    const a = Domain.fromInterval(1, 5);
    const b = Domain.fromInterval(4, 10);
    expect(a.union(b).flattenedIntervals()).toEqual([1n, 10n]);
    expect(a.intersectionWith(b).flattenedIntervals()).toEqual([4n, 5n]);
    expect(a.negation().flattenedIntervals()).toEqual([-5n, -1n]);
  });

  it('additionWith is pointwise sum', () => {
    const a = Domain.fromInterval(1, 3);
    const b = Domain.fromInterval(10, 12);
    expect(a.additionWith(b).flattenedIntervals()).toEqual([11n, 15n]);
  });

  it('complement inverts w.r.t. int64', () => {
    const d = Domain.fromInterval(0, 10).complement();
    const flat = d.flattenedIntervals();
    expect(flat[0]).toBe(INT64_MIN);
    expect(flat[1]).toBe(-1n);
    expect(flat[2]).toBe(11n);
    expect(flat[3]).toBe(INT64_MAX);
  });

  it('contains', () => {
    const d = Domain.fromValues([1, 2, 3, 10, 11]);
    expect(d.contains(2)).toBe(true);
    expect(d.contains(4)).toBe(false);
    expect(d.contains(10n)).toBe(true);
    expect(d.contains(-1)).toBe(false);
    expect(d.contains(100)).toBe(false);
  });

  it('iterates a finite domain', () => {
    const d = Domain.fromValues([1, 3, 5]);
    expect([...d]).toEqual([1n, 3n, 5n]);
  });

  it('iteration throws on infinite domains', () => {
    expect(() => [...Domain.all()]).toThrow();
  });

  it('toJSON is string-encoded', () => {
    const json = Domain.fromIntervals([[-10, -1], [5, 5]]).toJSON();
    expect(json).toEqual({ intervals: [['-10', '-1'], ['5', '5']] });
  });

  it('equals ignores construction path', () => {
    expect(Domain.fromValues([1, 2, 3]).equals(Domain.fromInterval(1, 3))).toBe(true);
    expect(Domain.fromInterval(1, 3).equals(Domain.fromInterval(1, 4))).toBe(false);
  });
});
