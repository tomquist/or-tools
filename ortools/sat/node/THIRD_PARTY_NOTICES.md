# Third-party software in @ortools-node/cp-sat

The prebuilt native addon and the runtime shared libraries we bundle
alongside it (`prebuilds/<triplet>/*`) statically and dynamically link the
following projects:

## Google OR-Tools

- License: Apache License 2.0
- Source: https://github.com/google/or-tools
- The `node.napi*.node` binary contains the CP-SAT solver code from
  OR-Tools. The companion `libortools.so.*` / `libortools.*.dylib` /
  `ortools.dll` shipped under `prebuilds/<triplet>/` is the OR-Tools
  shared library this addon depends on.

## Abseil (absl)

- License: Apache License 2.0
- Source: https://github.com/abseil/abseil-cpp
- Shipped as `libabsl_*.so.*` / `libabsl_*.*.dylib` / `abseil_dll.dll`
  under `prebuilds/<triplet>/`.

## Protocol Buffers

- License: BSD 3-Clause
- Source: https://github.com/protocolbuffers/protobuf
- Shipped as `libprotobuf.so.*` / `libprotobuf.*.dylib` / `protobuf.dll`
  under `prebuilds/<triplet>/`.

## RE2

- License: BSD 3-Clause
- Source: https://github.com/google/re2

## Eigen

- License: MPL 2.0 (most), with some sources under BSD-3 / LGPL.
- Source: https://gitlab.com/libeigen/eigen
- Header-only and statically inlined where used.

## ZLIB

- License: zlib License
- Source: https://github.com/madler/zlib

The full Apache-2.0 license text is reproduced in `LICENSE` (the same
license as this package).

For the BSD-3 / MPL-2.0 license texts, see the upstream projects'
`LICENSE` files at the source URLs above.
