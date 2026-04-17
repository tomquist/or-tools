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

// Hand-written type declarations for the N-API addon. The runtime shape lives
// in src/cpp/binding.cc / solve_wrapper.cc / cp_sat_helper.cc / c_api_binding.cc.

/**
 * Frozen object passed to the user's onSolutionCallback. Reading fields after
 * onSolutionCallback returns is safe (the underlying response snapshot is
 * pinned by the closure) but the values reflect the snapshot at the time of
 * the callback.
 */
export interface NativeSolutionContext {
  /** Returns the integer value of `varIndex` (negative encoded as -i-1). */
  readonly value: (varIndex: number) => bigint;
  /** Returns the boolean value of `varIndex`. */
  readonly booleanValue: (varIndex: number) => boolean;
  readonly objectiveValue: number;
  readonly bestObjectiveBound: number;
  readonly numBooleans: number;
  readonly numConflicts: number;
  readonly numBranches: number;
  readonly numIntegerPropagations: number;
  readonly numBinaryPropagations: number;
  readonly wallTime: number;
  readonly userTime: number;
  readonly deterministicTime: number;
  /** The full serialized CpSolverResponse. */
  readonly responseBytes: Uint8Array;
  /** Stops the search asynchronously. */
  readonly stopSearch: () => void;
}

export interface NativeSolutionCallbackTarget {
  onSolutionCallback(ctx: NativeSolutionContext): void;
}

/** Single-use solve session. */
export interface NativeSolveWrapper {
  setParametersBytes(bytes: Uint8Array): void;
  setStringParameters(text: string): void;
  addLogCallback(fn: (line: string) => void): void;
  addBestBoundCallback(fn: (bound: number) => void): void;
  addSolutionCallback(target: NativeSolutionCallbackTarget): void;
  clearSolutionCallback(target: NativeSolutionCallbackTarget): void;
  /**
   * Solve the model. `modelBytes` is a serialized CpModelProto. The returned
   * promise resolves with the serialized CpSolverResponse and never rejects
   * unless `modelBytes` is malformed.
   */
  solve(modelBytes: Uint8Array): Promise<Uint8Array>;
  stopSearch(): void;
}

export interface NativeSolveWrapperConstructor {
  new (): NativeSolveWrapper;
}

export interface NativeCpSatHelper {
  modelStats(modelBytes: Uint8Array): string;
  solverResponseStats(responseBytes: Uint8Array): string;
  /** Returns the empty string when the model is valid. */
  validateModel(modelBytes: Uint8Array): string;
  /** Flat [lo0, hi0, lo1, hi1, ...] form (each entry is a bigint). */
  variableDomain(variableProtoBytes: Uint8Array): bigint[];
  writeModelToFile(modelBytes: Uint8Array, path: string): boolean;
}

export interface NativeCApi {
  solve(modelBytes: Uint8Array, paramsBytes: Uint8Array): Promise<Uint8Array>;
}

export interface NativeModule {
  SolveWrapper: NativeSolveWrapperConstructor;
  CpSatHelper: NativeCpSatHelper;
  cApi: NativeCApi;
}
