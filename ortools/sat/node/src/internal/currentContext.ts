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

// Per-callback context store. Used by CpSolverSolutionCallback's instance
// shorthand methods (this.value(...), this.booleanValue(...), etc.) to find
// the active SolutionContext that was passed to onSolutionCallback.

import type { SolutionContext } from '../cp-sat/solutionContext.js';

let current: SolutionContext | undefined;

export function runWithContext<T>(ctx: SolutionContext, fn: () => T): T {
  const previous = current;
  current = ctx;
  try {
    return fn();
  } finally {
    current = previous;
  }
}

export function currentContext(): SolutionContext {
  if (current === undefined) {
    throw new Error(
      'CpSolverSolutionCallback shorthand called outside of an active onSolutionCallback. ' +
        'Use the SolutionContext argument explicitly when reading values asynchronously.',
    );
  }
  return current;
}
