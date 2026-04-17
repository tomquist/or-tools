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
import {
  asInt64,
  INT32_MAX,
  INT32_MIN,
  INT64_MAX,
  INT64_MIN,
} from '../src/cp-sat/numbers.js';

describe('asInt64', () => {
  it('accepts safe integers as numbers', () => {
    expect(asInt64(0)).toBe(0n);
    expect(asInt64(42)).toBe(42n);
    expect(asInt64(-17)).toBe(-17n);
    expect(asInt64(Number.MAX_SAFE_INTEGER)).toBe(BigInt(Number.MAX_SAFE_INTEGER));
    expect(asInt64(Number.MIN_SAFE_INTEGER)).toBe(BigInt(Number.MIN_SAFE_INTEGER));
  });

  it('accepts bigints within int64', () => {
    expect(asInt64(0n)).toBe(0n);
    expect(asInt64(INT64_MAX)).toBe(INT64_MAX);
    expect(asInt64(INT64_MIN)).toBe(INT64_MIN);
  });

  it('rejects non-integer numbers', () => {
    expect(() => asInt64(1.5)).toThrow(RangeError);
    expect(() => asInt64(NaN)).toThrow(RangeError);
    expect(() => asInt64(Infinity)).toThrow(RangeError);
    expect(() => asInt64(-Infinity)).toThrow(RangeError);
  });

  it('rejects numbers outside Number.MAX_SAFE_INTEGER', () => {
    expect(() => asInt64(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => asInt64(Number.MIN_SAFE_INTEGER - 1)).toThrow(RangeError);
  });

  it('rejects bigints outside int64', () => {
    expect(() => asInt64(INT64_MAX + 1n)).toThrow(RangeError);
    expect(() => asInt64(INT64_MIN - 1n)).toThrow(RangeError);
  });

  it('exposes int32 constants', () => {
    expect(INT32_MAX).toBe(2147483647);
    expect(INT32_MIN).toBe(-2147483648);
  });
});
