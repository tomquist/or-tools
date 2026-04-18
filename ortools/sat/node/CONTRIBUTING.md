# Contributing to @google-ortools/cp-sat

The Node.js binding lives under
[`ortools/sat/node`](.) inside the OR-Tools fork. The directory layout
mirrors the convention used by every other CP-SAT language wrapper:

| Language | Path                       |
| -------- | -------------------------- |
| Python   | `ortools/sat/python/`      |
| Java     | `ortools/sat/java/`        |
| C#       | `ortools/sat/csharp/`      |
| Go       | `ortools/sat/go/`          |
| Node.js  | `ortools/sat/node/` ← here |

Future OR-Tools components (routing, linear-solver, glop, graph) will get
their own sibling packages at `ortools/<component>/node/`.

## Sparse-checkout for Node-only contributors

The OR-Tools repository is large (~700 MB full clone) because it carries
C++, Python, Java, .NET sources side-by-side. If you only intend to work
on the Node.js binding, a sparse checkout brings the working tree down to
~30 MB:

```bash
git clone --filter=blob:none --no-checkout https://github.com/tomquist/or-tools.git
cd or-tools
git sparse-checkout init --cone
git sparse-checkout set ortools/sat/node ortools/sat ortools/util cmake CMakeLists.txt LICENSE Version.txt
git checkout
cd ortools/sat/node
```

You still need the `ortools/sat/` directory because the addon links
against the C++ sources in there.

## Development setup

Requires:

- Node.js 20+
- CMake 3.24+
- A C++17 compiler (GCC 10+, Clang 12+, MSVC 19.28+)
- `make` or `ninja`

```bash
cd ortools/sat/node
npm install          # installs devDeps: cmake-js, node-addon-api, etc.
npm run build:proto  # regenerate Protobuf-ES code from .proto files
npm run build:ts     # compile TS -> dist/
```

## Building the native addon

### Via the in-tree CMake project (recommended)

From the repository root:

```bash
cmake -S . -B build -DBUILD_CXX=ON -DBUILD_DEPS=ON -DBUILD_NODE=ON \
      -DBUILD_SAMPLES=OFF -DBUILD_EXAMPLES=OFF -DBUILD_TESTING=OFF \
      -DUSE_SCIP=OFF -DUSE_HIGHS=OFF -DUSE_COINOR=OFF
cmake --build build --target ortools_cpsat_node -j$(nproc)
```

The resulting `.node` binary lands in
`ortools/sat/node/prebuilds/<dir>/<file>`, where `<dir>` and `<file>`
follow `node-gyp-build`'s naming convention:

| Platform        | Directory       | Filename                |
| --------------- | --------------- | ----------------------- |
| linux-x64 glibc | `linux-x64`     | `node.napi.glibc.node`  |
| linux-arm64     | `linux-arm64`   | `node.napi.glibc.node`  |
| darwin-x64      | `darwin-x64`    | `node.napi.node`        |
| darwin-arm64    | `darwin-arm64`  | `node.napi.node`        |
| win32-x64       | `win32-x64`     | `node.napi.node`        |

### Via cmake-js (convenient for npm workflows)

```bash
cd ortools/sat/node
npx cmake-js compile --CDBUILD_CXX=ON --CDBUILD_DEPS=ON --CDBUILD_NODE=ON
node scripts/prebuild.mjs    # copies the .node into prebuilds/<dir>/
```

## Running tests

```bash
cd ortools/sat/node
npm test                     # pure-TS tests + native tests (skipped if no .node)
```

## Platform matrix

Prebuilt binaries ship for:

- `linux-x64` (glibc, Ubuntu 22.04 baseline)
- `linux-arm64` (glibc)
- `darwin-x64` (macOS 10.15 deployment target)
- `darwin-arm64`
- `win32-x64` (MSVC v143)

Alpine / musl, Bun, and Deno are not officially supported in v1. See
[README.md](./README.md#status) for the roadmap.

## Electron

```bash
npx cmake-js compile --runtime=electron --runtime-version=$(electron --version)
```

The `win_delay_load_hook.cc` ensures the addon resolves against whatever
host process is loading it, so no further config is needed on Windows.

## Releasing

Tag the fork with `cp-sat-vX.Y.Z` to trigger
[`.github/workflows/node_release.yml`](../../../.github/workflows/node_release.yml).
The workflow runs the prebuild matrix, aggregates the binaries, runs
`npm pack`, and (on manual approval) publishes to npm with provenance.

## Troubleshooting

### `no prebuilt binary for …`

Either your platform is not in the prebuild matrix or `node-gyp-build`
cannot find a match (usually libc mismatch on Alpine). Build from source
using the commands above.

### Symbols clash with grpc-node / tensorflow-node

The addon already hides all symbols except `napi_register_module_v1` via a
version script on Linux and a `.def` file on Windows. If you still see
conflicts, open an issue with the stack trace.

## Code style

- ESM-only, Node 20+.
- `npm run lint` (eslint) and `npx tsc --noEmit` must pass.
- Preserve Python/Java naming parity — if the method exists in
  `ortools/sat/python/cp_model.py`, it should exist here too. The
  reflection-based `tests/parity.test.ts` will flag missing methods.
