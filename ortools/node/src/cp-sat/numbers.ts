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

// Numeric coercion / validation helpers.

export const INT64_MAX: bigint = 9223372036854775807n;
export const INT64_MIN: bigint = -9223372036854775808n;
export const INT32_MAX = 2147483647;
export const INT32_MIN = -2147483648;

const SAFE_MIN_BIGINT: bigint = BigInt(Number.MIN_SAFE_INTEGER);
const SAFE_MAX_BIGINT: bigint = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Coerces a `bigint | number` to a `bigint`, validating that:
 *   - `number` is finite, an integer, and within Number.MIN/MAX_SAFE_INTEGER.
 *   - `bigint` is within INT64_MIN..INT64_MAX.
 *
 * Throws `RangeError` otherwise.
 */
export function asInt64(value: bigint | number): bigint {
  if (typeof value === 'bigint') {
    if (value < INT64_MIN || value > INT64_MAX) {
      throw new RangeError(
        `value ${value} is outside the int64 range [${INT64_MIN}, ${INT64_MAX}]`,
      );
    }
    return value;
  }
  if (!Number.isFinite(value)) {
    throw new RangeError(`value ${String(value)} is not a finite number`);
  }
  if (!Number.isInteger(value)) {
    throw new RangeError(`value ${value} is not an integer; pass a bigint instead`);
  }
  if (value < Number.MIN_SAFE_INTEGER || value > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(
      `value ${value} is outside Number.MAX_SAFE_INTEGER; pass a bigint instead`,
    );
  }
  return BigInt(value);
}

/** Like asInt64 but returns a `number` clamped to int32 range. */
export function asInt32(value: bigint | number): number {
  const v = asInt64(value);
  if (v < BigInt(INT32_MIN) || v > BigInt(INT32_MAX)) {
    throw new RangeError(
      `value ${v} is outside the int32 range [${INT32_MIN}, ${INT32_MAX}]`,
    );
  }
  return Number(v);
}

/**
 * Returns the `bigint` value when known to be safe, or the `number` form
 * when serializing `LinearConstraintProto.domain` entries that may be
 * Long.MIN/MAX. The proto field is repeated int64 (encoded as bigint by
 * Protobuf-ES), so callers should pass bigint anyway.
 */
export function bigintCoercion(value: bigint | number): bigint {
  if (typeof value === 'bigint') return value;
  return asInt64(value);
}

/** True if `n` represents a value within the safe-integer range. */
export function fitsInSafeNumber(n: bigint): boolean {
  return n >= SAFE_MIN_BIGINT && n <= SAFE_MAX_BIGINT;
}
