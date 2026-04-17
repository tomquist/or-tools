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

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type * as NativeTypes from './native.d.js';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

// `node-gyp-build` resolves to `prebuilds/<triplet>/node.napi.node` for the
// host platform. The package root is two levels up from src/internal/
// (relative to the .js file at runtime), and one level up at source time.
// Both layouts are safe because node-gyp-build walks up looking for a
// prebuilds/ directory.
const packageRoot = resolve(here, '..', '..');

type NodeGypBuild = (root: string) => unknown;

let cached: NativeTypes.NativeModule | undefined;

function loadNative(): NativeTypes.NativeModule {
  if (cached) return cached;
  try {
    const load = require('node-gyp-build') as NodeGypBuild;
    cached = load(packageRoot) as NativeTypes.NativeModule;
    return cached;
  } catch (err) {
    const platform = process.platform;
    const arch = process.arch;
    const libc =
      platform === 'linux' && process.report?.getReport
        ? ((process.report.getReport() as { header?: { glibcVersionRuntime?: string } })
            .header?.glibcVersionRuntime
            ? 'glibc'
            : 'musl')
        : '';
    const triplet =
      platform === 'win32'
        ? 'win32-x64'
        : platform === 'darwin'
          ? `darwin-${arch === 'arm64' ? 'arm64' : 'x64'}`
          : platform === 'linux'
            ? `linux-${arch === 'arm64' ? 'arm64' : 'x64'}-${libc || 'glibc'}`
            : `${platform}-${arch}`;
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[@google-ortools/cp-sat] no prebuilt binary for ${triplet}.\n` +
        `Underlying error: ${cause}\n` +
        `Build from source with:\n` +
        `  cd ortools/node && npx cmake-js compile --CDBUILD_CXX=ON --CDBUILD_DEPS=ON --CDBUILD_NODE=ON\n` +
        `or follow CONTRIBUTING.md.`,
    );
  }
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
