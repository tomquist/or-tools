# @google-ortools/cp-sat

Google [OR-Tools](https://developers.google.com/optimization) CP-SAT solver
bindings for Node.js and TypeScript. Built on the same C++ solver used by
the official Python, Java, C#, and Go bindings, this package exposes a
modeling surface modeled on those bindings but adapted to TypeScript
conventions (fluent algebra, explicit ESM, `bigint` for int64 values).

## Status

| Component            | Status    |
| -------------------- | --------- |
| CP-SAT               | ✅ v1     |
| Routing (CP)         | ⏳ future |
| Linear solver / Glop | ⏳ future |
| Graph algorithms     | ⏳ future |

## Install

```
npm install @google-ortools/cp-sat
```

Requires Node.js 20+ (NAPI 9). Prebuilt binaries are shipped for
`linux-x64` (glibc), `linux-arm64` (glibc), `darwin-x64`, `darwin-arm64`,
and `win32-x64`. Alpine (musl) must build from source — see
[`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Quick start

```ts
import { CpModel, CpSolver, CpSolverStatus } from '@google-ortools/cp-sat';

const model = new CpModel();
const x = model.newIntVar(0n, 10n, 'x');
const y = model.newIntVar(0n, 10n, 'y');
const z = model.newBoolVar('z');

model.add(x.add(y).equalTo(7));
model.add(x.sub(y).onlyEnforceIf(z).greaterOrEqual(2));
model.maximize(x.mul(2).add(y));

const solver = new CpSolver();
solver.parameters.maxTimeInSeconds = 5;
solver.parameters.numSearchWorkers = 8;

const status = await solver.solve(model);
if (status === CpSolverStatus.OPTIMAL || status === CpSolverStatus.FEASIBLE) {
  console.log(solver.value(x), solver.value(y), solver.booleanValue(z));
}
```

## Modeling

The modeling API mirrors the Python binding's `cp_model.CpModel`. See
[`ortools/sat/python/cp_model.py`](https://github.com/google/or-tools/blob/stable/ortools/sat/python/cp_model.py)
for canonical reference documentation; method naming follows
`snake_case → camelCase`.

Three styles for comparison constraints:

```ts
// Fluent (Python operator equivalent).
model.add(x.add(y).equalTo(7));

// Short alias.
model.add(x.add(y).eq(7));

// Direct (Java parity).
model.addEquality(x.add(y), 7);
```

All three produce byte-identical `ConstraintProto`s.

### Numeric types

All bounds, coefficients, constants, and values that map to int64 accept
`bigint | number`. `number` inputs are validated at the boundary — values
outside `Number.MIN/MAX_SAFE_INTEGER` throw `RangeError`. Use `bigint` for
magnitudes ≥ 2^53.

`solver.value(...)` returns `bigint`. `solver.floatValue(...)` returns
`number` for expressions with float coefficients.

### Solution callbacks

```ts
import {
  CpSolver,
  CpSolverSolutionCallback,
  type SolutionContext,
} from '@google-ortools/cp-sat';

class Printer extends CpSolverSolutionCallback {
  onSolutionCallback(ctx: SolutionContext): void {
    // Both work — ctx.* is explicit and always safe, this.* reads the
    // thread-local active context.
    console.log(ctx.value(x), this.objectiveValue);
  }
}

const solver = new CpSolver();
await solver.solve(model, { callback: new Printer() });
```

### Cancellation

```ts
const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 1000);

const status = await solver.solve(model, { signal: ctrl.signal });
// Aborting does not reject — the solver returns whatever it has so far.
// Inspect `status` (often FEASIBLE or UNKNOWN).
```

You can also call `solver.stopSearch()` synchronously from another context.

### Logging

```ts
solver.parameters.logSearchProgress = true;
solver.logCallback = (line) => console.log(line);
```

### Parallelism

CP-SAT runs a multi-threaded portfolio search. Configure via
`solver.parameters.numSearchWorkers` (default 8). Running multiple
`CpSolver` instances in parallel works, but be aware the total thread
count is `numSearchWorkers × concurrentSolves`.

## Build from source

If no prebuilt binary matches your platform:

```
cd ortools/sat/node
npx cmake-js compile --CDBUILD_CXX=ON --CDBUILD_DEPS=ON --CDBUILD_NODE=ON
node scripts/prebuild.mjs    # or: npm run prebuild:native
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for more.

## License

Apache 2.0 — same as OR-Tools.
