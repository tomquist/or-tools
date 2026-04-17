# Contributing to @google-ortools/cp-sat

## Development setup

Requires:

- Node.js 20+
- CMake 3.24+
- A C++17 compiler (GCC 10+, Clang 12+, MSVC 19.28+)
- `make` or `ninja`

```bash
cd ortools/node
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
`ortools/node/prebuilds/<triplet>/node.napi.node`, where `<triplet>` is one
of `linux-x64-glibc`, `linux-arm64-glibc`, `darwin-x64`, `darwin-arm64`, or
`win32-x64`.

### Via cmake-js (convenient for npm workflows)

```bash
cd ortools/node
npx cmake-js compile --CDBUILD_CXX=ON --CDBUILD_DEPS=ON --CDBUILD_NODE=ON
node scripts/prebuild.mjs    # copies the .node into prebuilds/<triplet>/
```

## Running tests

```bash
cd ortools/node
npm test                     # pure-TS tests + native tests (skipped if no .node)
```

## Platform matrix

Prebuilt binaries ship for:

- `linux-x64-glibc` (Ubuntu 22.04 baseline)
- `linux-arm64-glibc`
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
  `ortools/sat/python/cp_model.py`, it should exist here too.
