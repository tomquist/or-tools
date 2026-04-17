# Changelog

All notable changes to @google-ortools/cp-sat are documented in this file.

## 9.15.0-node.0

Initial release. Tracks upstream OR-Tools 9.15.

### Added

- CP-SAT solver surface for Node.js / TypeScript via a native Node-API
  addon over `ortools/sat/swig_helper.h`.
- Full parity with the Python (`cp_model.py`) and Java
  (`com.google.ortools.sat.*`) bindings' CP-SAT modeling API, except for
  pandas-style indexed variable constructors (not idiomatic in TS).
- TypeScript-native features:
  - Branded `VarIndex` / `ConstraintIndex` / `IntervalIndex` types.
  - `bigint`-based numeric input with safe-range validation.
  - Three-style comparison constraints
    (`x.eq(y)` / `x.equalTo(y)` / `model.addEquality(x, y)`) that all
    produce byte-identical `ConstraintProto`s.
  - Python auto-detect + explicit `minimizeFloat` / `maximizeFloat` for
    floating-point objectives.
  - `onSolutionCallback(ctx)` with immutable `SolutionContext` plus
    Python-parity `this.value()` shorthand backed by an
    `AsyncLocalStorage`-style active context.
  - `AbortSignal` support (resolves with partial response, never
    rejects).
- Prebuilt binaries for linux-x64-glibc, linux-arm64-glibc, darwin-x64,
  darwin-arm64, and win32-x64.
- Symbol isolation: only `napi_register_module_v1` is externally visible
  (Linux version script + Windows `.def`).
