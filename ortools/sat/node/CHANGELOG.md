# Changelog

All notable changes to @ortools-node/cp-sat are documented in this file.

## 9.15.0-node.0-rc.2 (2026-05-11)

### Changed

- Repackaged as a slim main package + six per-platform optional
  dependencies, mirroring the layout used by `esbuild`, `@swc/core`,
  and `sharp`. Installing `@ortools-node/cp-sat` now pulls only the
  ~1 MB JS layer plus the matching one of:
  - `@ortools-node/cp-sat-linux-x64` (~69 MB, glibc)
  - `@ortools-node/cp-sat-linux-arm64` (~63 MB, glibc)
  - `@ortools-node/cp-sat-linux-x64-musl` (~70 MB, musl/Alpine)
  - `@ortools-node/cp-sat-linux-arm64-musl` (~65 MB, musl/Alpine)
  - `@ortools-node/cp-sat-darwin-x64` (~89 MB)
  - `@ortools-node/cp-sat-darwin-arm64` (~91 MB)

  Previous releases shipped all four glibc/macOS prebuilds in a
  single ~310 MB tarball with no Alpine support. Public API is
  byte-for-byte unchanged; this is a transparent install-time size
  reduction plus first-class musl coverage.
- Removed the `node-gyp-build` runtime dependency. The native loader
  now `require.resolve()`s the matching platform package directly,
  with a fallback to the in-tree `prebuilds/<triplet>/` layout for
  build-from-source consumers and in-repo development.
- Each platform package declares `os` / `cpu` / (Linux-only) `libc`
  fields so npm 10+ installs only the matching one. Linux musl is
  detected at runtime via `process.report.getReport().header.glibcVersionRuntime`
  (the same probe `node-gyp-build` used internally), and the loader
  appends a `-musl` suffix to the platform-package name.
- The musl prebuilds bundle `libstdc++.so.6` and `libgcc_s.so.1`
  alongside the addon — the same self-containment strategy that the
  OR-Tools Python `musllinux` wheel achieves via `auditwheel repair`.
  Bare `node:20-alpine` consumers (and slimmed/distroless musl
  images) need no additional `apk add`.

## 9.15.0-node.0-rc.1 (2026-05-08)

### Fixed

- Native segfault at process teardown when `solver.solve()` was passed a
  `CpSolverSolutionCallback` ([#1]). The `SolutionBridge`'s
  `ThreadSafeFunction` could be drained by libuv after the bridge had
  already been destroyed, dangling pointers held by queued payloads. The
  bridge is now owned by its own TSFN finalizer, so it cannot be freed
  until any in-flight callbacks have been drained on the JS thread.

[#1]: https://github.com/tomquist/or-tools/pull/1

## 9.15.0-node.0-rc.0 (2026-05-08)

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
- Prebuilt binaries for linux-x64 (glibc), linux-arm64 (glibc),
  darwin-x64 (macos-15-intel), and darwin-arm64. The prebuild filename
  layout matches `node-gyp-build`'s parser:
  `prebuilds/<platform>-<arch>/node.napi[.<libc>].node`.
- Windows is intentionally not in the v1 prebuild matrix; see
  CONTRIBUTING.md for status.
- Symbol isolation: only `napi_register_module_v1` is externally visible
  (Linux version script + Windows `.def`).
- Tag-driven release workflow at `.github/workflows/node_release.yml`.
  Push a `cp-sat-vX.Y.Z` tag to build all prebuilds, attach the npm
  tarball to a GitHub release, and (after manual approval) `npm publish`
  with provenance.
