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

// Main solver class. One CpSolver instance per solve session (Python/Java
// convention: new CpSolver / call solve). `solve()` returns a Promise<CpSolverStatus>
// and populates a stashed response the accessors read from.

import { fromBinary, toBinary } from '@bufbuild/protobuf';

import type {
  CpSolverResponse,
} from '../proto/ortools/sat/cp_model_pb.js';
import {
  CpSolverResponseSchema,
  CpSolverStatus,
} from '../proto/ortools/sat/cp_model_pb.js';
import { native } from '../internal/native.js';
import type { NativeSolutionContext } from '../internal/native.d.js';
import { runWithContext } from '../internal/currentContext.js';
import type { CpModel } from './cpModel.js';
import type { LiteralT } from './boolVar.js';
import type {
  CpSolverSolutionCallback,
} from './solutionCallback.js';
import type { SolutionContext } from './solutionContext.js';
import {
  asLinearExpr,
  type LinearExprT,
  LinearExpr,
} from './linearExpr.js';
import {
  createSatParameters,
  SatParametersSchema,
  type SatParameters,
} from './parameters.js';
import { statusName } from './status.js';

export interface SolveOptions {
  callback?: CpSolverSolutionCallback;
  signal?: AbortSignal;
}

export class CpSolver {
  /** Mutable SatParameters. Users write fields directly. */
  parameters: SatParameters = createSatParameters();

  /** Optional log sink for solve-progress lines. */
  logCallback: ((line: string) => void) | undefined;

  /** Optional best-bound update sink. */
  bestBoundCallback: ((bound: number) => void) | undefined;

  private inflight = false;
  private lastNativeWrapper: InstanceType<typeof native.SolveWrapper> | undefined;
  private response_: CpSolverResponse | undefined;

  // ----- Callback management (Java parity) --------------------------------

  setLogCallback(fn: (line: string) => void): void {
    this.logCallback = fn;
  }
  clearLogCallback(): void {
    this.logCallback = undefined;
  }
  setBestBoundCallback(fn: (bound: number) => void): void {
    this.bestBoundCallback = fn;
  }
  clearBestBoundCallback(): void {
    this.bestBoundCallback = undefined;
  }

  // ----- solve ------------------------------------------------------------

  async solve(model: CpModel, opts: SolveOptions = {}): Promise<CpSolverStatus> {
    if (this.inflight) {
      throw new Error('CpSolver.solve: a previous solve is still in flight');
    }
    this.inflight = true;
    this.response_ = undefined;

    const wrapper = new native.SolveWrapper();
    this.lastNativeWrapper = wrapper;

    const paramsBytes = toBinary(SatParametersSchema, this.parameters);
    wrapper.setParametersBytes(paramsBytes);

    if (this.logCallback) wrapper.addLogCallback(this.logCallback);
    if (this.bestBoundCallback) wrapper.addBestBoundCallback(this.bestBoundCallback);

    const cb = opts.callback;
    if (cb) {
      const target = {
        onSolutionCallback: (nativeCtx: NativeSolutionContext) => {
          const ctx = buildContext(nativeCtx, model);
          runWithContext(ctx, () => cb.onSolutionCallback(ctx));
        },
      };
      wrapper.addSolutionCallback(target);
    }

    // AbortSignal wiring with a proper finally-cleanup (D7, N5).
    const onAbort = () => wrapper.stopSearch();
    let signalListenerAdded = false;
    if (opts.signal) {
      if (opts.signal.aborted) {
        wrapper.stopSearch();
      } else {
        opts.signal.addEventListener('abort', onAbort, { once: true });
        signalListenerAdded = true;
      }
    }

    try {
      const modelBytes = model.toBytes();
      const respBytes = await wrapper.solve(modelBytes);
      const response = fromBinary(CpSolverResponseSchema, respBytes);
      this.response_ = response;
      return response.status;
    } finally {
      if (signalListenerAdded) {
        opts.signal!.removeEventListener('abort', onAbort);
      }
      this.lastNativeWrapper = undefined;
      this.inflight = false;
    }
  }

  /** Stops the in-flight solve, if any. Safe to call from any sync context. */
  stopSearch(): void {
    this.lastNativeWrapper?.stopSearch();
  }

  // ----- Value accessors --------------------------------------------------

  value(expr: LinearExprT): bigint {
    const r = this.checkedResponse();
    return evaluateInt(r, asLinearExpr(expr));
  }

  floatValue(expr: LinearExprT): number {
    const r = this.checkedResponse();
    return evaluateFloat(r, asLinearExpr(expr));
  }

  booleanValue(literal: LiteralT): boolean {
    const r = this.checkedResponse();
    return evaluateLiteral(r, literal);
  }

  // ----- Accessors (union of Java + Python) -------------------------------

  get objectiveValue(): number {
    return this.checkedResponse().objectiveValue;
  }
  get bestObjectiveBound(): number {
    return this.checkedResponse().bestObjectiveBound;
  }
  get numBooleans(): number {
    return Number(this.checkedResponse().numBooleans);
  }
  get numConflicts(): number {
    return Number(this.checkedResponse().numConflicts);
  }
  get numBranches(): number {
    return Number(this.checkedResponse().numBranches);
  }
  get numBinaryPropagations(): number {
    return Number(this.checkedResponse().numBinaryPropagations);
  }
  get numIntegerPropagations(): number {
    return Number(this.checkedResponse().numIntegerPropagations);
  }
  get wallTime(): number {
    return this.checkedResponse().wallTime;
  }
  get userTime(): number {
    return this.checkedResponse().userTime;
  }
  get deterministicTime(): number {
    return this.checkedResponse().deterministicTime;
  }
  get status(): CpSolverStatus {
    return this.checkedResponse().status;
  }
  get solutionInfo(): string {
    return this.checkedResponse().solutionInfo;
  }
  get solveLog(): string {
    return this.checkedResponse().solveLog;
  }
  get response(): CpSolverResponse {
    return this.checkedResponse();
  }
  get responseProto(): CpSolverResponse {
    return this.checkedResponse();
  }

  statusName(status?: CpSolverStatus): string {
    return statusName(status ?? this.checkedResponse().status);
  }

  responseStats(): string {
    return native.CpSatHelper.solverResponseStats(
      toBinary(CpSolverResponseSchema, this.checkedResponse()),
    );
  }

  sufficientAssumptionsForInfeasibility(): readonly number[] {
    return this.checkedResponse().sufficientAssumptionsForInfeasibility;
  }

  private checkedResponse(): CpSolverResponse {
    if (this.response_ === undefined) {
      throw new Error('CpSolver: solve() has not been called yet');
    }
    return this.response_;
  }
}

// ---------------------------------------------------------------------------
// Evaluation helpers.
// ---------------------------------------------------------------------------

function readSolution(r: CpSolverResponse, index: number): bigint {
  if (index >= 0) {
    const v = r.solution[index];
    if (v === undefined) {
      throw new Error(`CpSolver.value: solution has no variable at index ${index}`);
    }
    return v;
  }
  const v = r.solution[-index - 1];
  if (v === undefined) {
    throw new Error(
      `CpSolver.value: solution has no variable at index ${-index - 1}`,
    );
  }
  return -v;
}

function evaluateInt(r: CpSolverResponse, expr: LinearExpr): bigint {
  const flat = expr.flatten();
  if (flat.isFloat) {
    throw new TypeError(
      'CpSolver.value(): expression is floating-point; use floatValue()',
    );
  }
  let total: bigint = flat.offset;
  for (let i = 0; i < flat.vars.length; i++) {
    total += flat.coeffs[i]! * readSolution(r, flat.vars[i]!);
  }
  return total;
}

function evaluateFloat(r: CpSolverResponse, expr: LinearExpr): number {
  // Walk the expression in float mode via a one-shot accumulator.
  let offset = 0;
  const sink = {
    markFloat(): void {},
    addTerm(varIndex: number, weight: bigint | number): void {
      offset += Number(weight) * Number(readSolution(r, varIndex));
    },
    addOffset(amount: bigint | number): void {
      offset += Number(amount);
    },
  };
  expr.accumulate(sink, 1);
  return offset;
}

function evaluateLiteral(r: CpSolverResponse, literal: LiteralT): boolean {
  const idx = literal.literalIndex;
  if (idx >= 0) {
    const v = r.solution[idx];
    if (v === undefined) throw new Error(`no solution for literal index ${idx}`);
    return v !== 0n;
  }
  const v = r.solution[-idx - 1];
  if (v === undefined) throw new Error(`no solution for literal index ${idx}`);
  return v === 0n;
}

// ---------------------------------------------------------------------------
// Context adapter: wrap the native context into a SolutionContext that
// understands LinearExprT and LiteralT.
// ---------------------------------------------------------------------------

function buildContext(
  nativeCtx: NativeSolutionContext,
  _model: CpModel,
): SolutionContext {
  const responseProto = fromBinary(CpSolverResponseSchema, nativeCtx.responseBytes);
  const ctx: SolutionContext = {
    value(expr) {
      return evaluateInt(responseProto, asLinearExpr(expr));
    },
    booleanValue(literal) {
      return evaluateLiteral(responseProto, literal);
    },
    objectiveValue: nativeCtx.objectiveValue,
    bestObjectiveBound: nativeCtx.bestObjectiveBound,
    numBooleans: nativeCtx.numBooleans,
    numConflicts: nativeCtx.numConflicts,
    numBranches: nativeCtx.numBranches,
    numIntegerPropagations: nativeCtx.numIntegerPropagations,
    numBinaryPropagations: nativeCtx.numBinaryPropagations,
    wallTime: nativeCtx.wallTime,
    userTime: nativeCtx.userTime,
    deterministicTime: nativeCtx.deterministicTime,
    responseProto,
    stopSearch() {
      nativeCtx.stopSearch();
    },
  };
  Object.freeze(ctx);
  return ctx;
}
