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

import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type * as NativeTypes from './native.d.js';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

// `packageRoot` is two levels up from src/internal/ at runtime
// (dist/internal/ in the published layout, src/internal/ in dev). The
// in-tree dev fallback below resolves a sibling `prebuilds/<triplet>/`
// directory off this root.
const packageRoot = resolve(here, '..', '..');

interface PlatformId {
  /** npm package id of the per-platform optional dependency. */
  readonly pkg: string;
  /** in-tree directory name used by cmake/cmake-js + node-gyp-build conventions. */
  readonly triplet: string;
}

let cachedIsMusl: boolean | undefined;

/**
 * Detect a musl-libc Linux runtime. We use the `glibcVersionRuntime`
 * field of `process.report.getReport()` — present on glibc, absent on
 * musl. This is the same probe `node-gyp-build` uses internally, and
 * works across Alpine, distroless musl, Void Linux musl, etc. Cached
 * because `getReport()` allocates a non-trivial amount of metadata.
 */
function isMusl(): boolean {
  if (cachedIsMusl !== undefined) return cachedIsMusl;
  if (process.platform !== 'linux') {
    cachedIsMusl = false;
    return cachedIsMusl;
  }
  try {
    const report = process.report?.getReport?.() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    cachedIsMusl = !report?.header?.glibcVersionRuntime;
  } catch {
    // process.report unavailable (very old Node) — assume glibc, which
    // is the safer default on a non-musl host.
    cachedIsMusl = false;
  }
  return cachedIsMusl;
}

function detectPlatform(): PlatformId {
  const { platform, arch } = process;
  // Normalize x32/ia32/etc. to x64; the prebuilds we ship are x64 + arm64.
  // Unsupported arches still get a pkg/triplet name so the error message
  // points at exactly what's missing.
  const a = arch === 'arm64' ? 'arm64' : 'x64';
  // Linux musl gets a `-musl` suffix on both the package name and the
  // in-tree triplet directory; glibc Linux and non-Linux platforms have
  // no suffix.
  const suffix = platform === 'linux' && isMusl() ? '-musl' : '';
  return {
    pkg: `@ortools-node/cp-sat-${platform}-${a}${suffix}`,
    triplet: `${platform}-${a}${suffix}`,
  };
}

let cached: NativeTypes.NativeModule | undefined;

function tryLoadFromPlatformPackage(pkg: string): NativeTypes.NativeModule | null {
  // The per-platform packages set `"main": "./cp-sat.node"`, so a plain
  // `require(pkg)` returns the loaded native addon directly. We swallow
  // MODULE_NOT_FOUND (the optional dep wasn't installed for this OS/arch)
  // and rethrow any other error — a corrupted .node should not be hidden.
  try {
    return require(pkg) as NativeTypes.NativeModule;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
      return null;
    }
    throw err;
  }
}

function tryLoadFromDevFallback(triplet: string): NativeTypes.NativeModule | null {
  // Build-from-source path: cmake/node.cmake and scripts/prebuild.mjs both
  // emit to <packageRoot>/prebuilds/<triplet>/, matching the historical
  // node-gyp-build layout (e.g. node.napi.glibc.node, node.napi.node, or
  // a renamed cp-sat.node). We accept any single .node file in that dir.
  const dir = join(packageRoot, 'prebuilds', triplet);
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir).filter((f) => f.endsWith('.node'));
  if (candidates.length === 0) return null;
  // candidates[0] is non-undefined by the length check above, but
  // noUncheckedIndexedAccess requires a runtime narrow.
  const file = candidates[0];
  if (!file) return null;
  return require(join(dir, file)) as NativeTypes.NativeModule;
}

function loadNative(): NativeTypes.NativeModule {
  if (cached) return cached;
  const id = detectPlatform();
  const fromPkg = tryLoadFromPlatformPackage(id.pkg);
  if (fromPkg) {
    cached = fromPkg;
    return cached;
  }
  const fromDev = tryLoadFromDevFallback(id.triplet);
  if (fromDev) {
    cached = fromDev;
    return cached;
  }
  throw new Error(
    `[@ortools-node/cp-sat] no prebuilt native addon found for ${id.triplet}.\n` +
      `Tried optional dependency '${id.pkg}' and the in-tree prebuilds/${id.triplet}/ directory.\n` +
      `If you installed via npm: optional dependencies may have been skipped\n` +
      `(e.g. with --no-optional, or on Alpine / Windows / unsupported platforms).\n` +
      `Build from source with:\n` +
      `  cd ortools/sat/node && npx cmake-js compile --CDBUILD_CXX=ON --CDBUILD_DEPS=ON --CDBUILD_NODE=ON\n` +
      `or follow CONTRIBUTING.md.`,
  );
}

/**
 * Lazily-loaded native module. Property access triggers the load; this lets
 * pure-TS code paths (e.g. building a model without solving) work even when
 * no prebuild is available.
 */
export const native: NativeTypes.NativeModule = new Proxy(
  {} as NativeTypes.NativeModule,
  {
    get(_target, prop) {
      const mod = loadNative() as unknown as Record<string | symbol, unknown>;
      return mod[prop];
    },
  },
);
