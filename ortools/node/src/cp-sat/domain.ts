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

// Mirror of operations_research::Domain. Stored as a sorted, disjoint flat
// array [lo0, hi0, lo1, hi1, ...] with lo_i <= hi_i and hi_i + 1 < lo_{i+1}.

import { asInt64, INT64_MAX, INT64_MIN } from './numbers.js';

export type IntegralT = bigint | number;

export class Domain {
  /** Internal flat-intervals representation. Always canonicalised. */
  private readonly intervals: readonly bigint[];

  /** Internal constructor; use the static factories. */
  private constructor(intervals: readonly bigint[]) {
    this.intervals = intervals;
  }

  /** A single interval [lb, ub]. */
  static fromInterval(lb: IntegralT, ub: IntegralT): Domain {
    const lo = asInt64(lb);
    const hi = asInt64(ub);
    if (lo > hi) return Domain.empty();
    return new Domain([lo, hi]);
  }

  /** A single value [v, v]. */
  static fromValue(value: IntegralT): Domain {
    const v = asInt64(value);
    return new Domain([v, v]);
  }

  /** Union of {v0, v1, ...}. */
  static fromValues(values: Iterable<IntegralT>): Domain {
    const sorted = [...values].map(asInt64).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (sorted.length === 0) return Domain.empty();
    const flat: bigint[] = [];
    let lo = sorted[0]!;
    let hi = sorted[0]!;
    for (let i = 1; i < sorted.length; i++) {
      const v = sorted[i]!;
      if (v === hi || v === hi + 1n) {
        hi = v;
      } else {
        flat.push(lo, hi);
        lo = v;
        hi = v;
      }
    }
    flat.push(lo, hi);
    return new Domain(flat);
  }

  /** Build from `[lo0, hi0, lo1, hi1, ...]` flat form. Canonicalised. */
  static fromFlatIntervals(flat: Iterable<IntegralT>): Domain {
    const arr = [...flat].map(asInt64);
    if (arr.length % 2 !== 0) {
      throw new Error('Domain.fromFlatIntervals: array length must be even');
    }
    return Domain.fromIntervals(toPairs(arr));
  }

  /** Build from `[[lo0, hi0], [lo1, hi1], ...]`. Canonicalised. */
  static fromIntervals(intervals: Iterable<readonly [IntegralT, IntegralT]>): Domain {
    const pairs = [...intervals].map(
      ([lo, hi]) => [asInt64(lo), asInt64(hi)] as [bigint, bigint],
    );
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const out: bigint[] = [];
    for (const [lo, hi] of pairs) {
      if (lo > hi) continue;
      if (out.length === 0) {
        out.push(lo, hi);
        continue;
      }
      const lastHi = out[out.length - 1]!;
      const lastLo = out[out.length - 2]!;
      if (lo <= lastHi + 1n) {
        // Merge.
        if (hi > lastHi) out[out.length - 1] = hi;
        // lo cannot be smaller because we sorted.
        out[out.length - 2] = lastLo;
      } else {
        out.push(lo, hi);
      }
    }
    return new Domain(out);
  }

  /** [INT64_MIN, INT64_MAX]. */
  static all(): Domain {
    return new Domain([INT64_MIN, INT64_MAX]);
  }

  /** Alias for `all()`, mirroring Python's Domain.all_values(). */
  static allValues(): Domain {
    return Domain.all();
  }

  /** Empty domain. */
  static empty(): Domain {
    return new Domain([]);
  }

  isEmpty(): boolean {
    return this.intervals.length === 0;
  }

  /** Smallest value, or throws if empty. */
  min(): bigint {
    if (this.intervals.length === 0) throw new Error('Domain.min(): empty domain');
    return this.intervals[0]!;
  }

  /** Largest value, or throws if empty. */
  max(): bigint {
    if (this.intervals.length === 0) throw new Error('Domain.max(): empty domain');
    return this.intervals[this.intervals.length - 1]!;
  }

  /** Number of contained values, possibly Infinity for unbounded domains. */
  size(): number | bigint {
    let total = 0n;
    for (let i = 0; i < this.intervals.length; i += 2) {
      total += this.intervals[i + 1]! - this.intervals[i]! + 1n;
    }
    if (total <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(total);
    return total;
  }

  /** True iff value lies inside the domain. */
  contains(value: IntegralT): boolean {
    const v = asInt64(value);
    for (let i = 0; i < this.intervals.length; i += 2) {
      if (v >= this.intervals[i]! && v <= this.intervals[i + 1]!) return true;
      if (v < this.intervals[i]!) return false;
    }
    return false;
  }

  /** Return the canonical flat form. */
  flattenedIntervals(): bigint[] {
    return [...this.intervals];
  }

  /** Returns intervals as `[lo, hi]` pairs. */
  pairs(): Array<[bigint, bigint]> {
    return toPairs(this.intervals as bigint[]);
  }

  /** Yields each contained value in ascending order. Throws if infinite. */
  *[Symbol.iterator](): IterableIterator<bigint> {
    for (let i = 0; i < this.intervals.length; i += 2) {
      const lo = this.intervals[i]!;
      const hi = this.intervals[i + 1]!;
      if (lo === INT64_MIN || hi === INT64_MAX) {
        throw new Error(
          `Domain is unbounded; refusing to iterate (lo=${lo}, hi=${hi})`,
        );
      }
      for (let v = lo; v <= hi; v++) yield v;
    }
  }

  /** Set union. */
  union(other: Domain): Domain {
    const out: Array<[bigint, bigint]> = [];
    for (const p of this.pairs()) out.push(p);
    for (const p of other.pairs()) out.push(p);
    return Domain.fromIntervals(out);
  }

  /** Set intersection. */
  intersectionWith(other: Domain): Domain {
    const out: Array<[bigint, bigint]> = [];
    let i = 0;
    let j = 0;
    const a = this.intervals;
    const b = other.intervals;
    while (i < a.length && j < b.length) {
      const aLo = a[i]!;
      const aHi = a[i + 1]!;
      const bLo = b[j]!;
      const bHi = b[j + 1]!;
      const lo = aLo > bLo ? aLo : bLo;
      const hi = aHi < bHi ? aHi : bHi;
      if (lo <= hi) out.push([lo, hi]);
      if (aHi < bHi) i += 2;
      else j += 2;
    }
    return Domain.fromIntervals(out);
  }

  /** Set complement w.r.t. [INT64_MIN, INT64_MAX]. */
  complement(): Domain {
    return Domain.all().intersectionWith(this.invertedHoles());
  }

  private invertedHoles(): Domain {
    const out: Array<[bigint, bigint]> = [];
    let cursor = INT64_MIN;
    for (let i = 0; i < this.intervals.length; i += 2) {
      const lo = this.intervals[i]!;
      const hi = this.intervals[i + 1]!;
      if (cursor < lo) out.push([cursor, lo - 1n]);
      cursor = hi === INT64_MAX ? INT64_MAX : hi + 1n;
      if (cursor === INT64_MAX) break;
    }
    if (cursor <= INT64_MAX && (this.intervals.length === 0 ||
        this.intervals[this.intervals.length - 1]! !== INT64_MAX)) {
      out.push([cursor, INT64_MAX]);
    }
    return Domain.fromIntervals(out);
  }

  /** Negate every contained value. */
  negation(): Domain {
    const out: Array<[bigint, bigint]> = [];
    for (let i = this.intervals.length - 2; i >= 0; i -= 2) {
      const lo = this.intervals[i]!;
      const hi = this.intervals[i + 1]!;
      out.push([-hi, -lo]);
    }
    return Domain.fromIntervals(out);
  }

  /** Pointwise sum {a + b : a in this, b in other}. */
  additionWith(other: Domain): Domain {
    if (this.isEmpty() || other.isEmpty()) return Domain.empty();
    const out: Array<[bigint, bigint]> = [];
    for (let i = 0; i < this.intervals.length; i += 2) {
      for (let j = 0; j < other.intervals.length; j += 2) {
        out.push([
          this.intervals[i]! + other.intervals[j]!,
          this.intervals[i + 1]! + other.intervals[j + 1]!,
        ]);
      }
    }
    return Domain.fromIntervals(out);
  }

  toString(): string {
    if (this.isEmpty()) return '[]';
    const parts: string[] = [];
    for (const [lo, hi] of this.pairs()) {
      if (lo === hi) parts.push(`{${lo}}`);
      else parts.push(`[${lo},${hi}]`);
    }
    return parts.join(' U ');
  }

  toJSON(): { intervals: Array<[string, string]> } {
    return {
      intervals: this.pairs().map(
        ([lo, hi]) => [lo.toString(), hi.toString()] as [string, string],
      ),
    };
  }

  equals(other: Domain): boolean {
    if (this.intervals.length !== other.intervals.length) return false;
    for (let i = 0; i < this.intervals.length; i++) {
      if (this.intervals[i] !== other.intervals[i]) return false;
    }
    return true;
  }
}

function toPairs(flat: readonly bigint[]): Array<[bigint, bigint]> {
  const out: Array<[bigint, bigint]> = [];
  for (let i = 0; i < flat.length; i += 2) {
    out.push([flat[i]!, flat[i + 1]!]);
  }
  return out;
}
