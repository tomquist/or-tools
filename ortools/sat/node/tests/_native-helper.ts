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

// Test helper: probe whether a prebuilt native addon is present in
// prebuilds/<triplet>/. Native-dependent test suites use this to
// auto-skip when run on a developer machine that hasn't built the
// addon yet, while still exercising on CI where cmake produces it
// before `npm test` runs.

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedIsMusl: boolean | undefined;

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
    cachedIsMusl = false;
  }
  return cachedIsMusl;
}

/**
 * Returns the platform-specific prebuild directory name. Mirrors the
 * loader's `detectPlatform()` so test skip-logic and the loader stay in
 * sync; updates here should match `src/internal/native.ts`.
 */
export function prebuildTriplet(): string {
  const a = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'win32') return 'win32-x64';
  if (process.platform === 'darwin') return `darwin-${a}`;
  if (process.platform === 'linux') {
    return isMusl() ? `linux-${a}-musl` : `linux-${a}`;
  }
  return `${process.platform}-${a}`;
}

function prebuildPresent(): boolean {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, '..', 'prebuilds', prebuildTriplet());
  try {
    return readdirSync(dir).some((f) => f.endsWith('.node'));
  } catch {
    // Fallback for the historical `node.napi.node` filename used by
    // node-gyp-build; current builds emit any *.node, the readdirSync
    // path above covers them. Kept for older in-tree prebuilds.
    return existsSync(join(dir, 'node.napi.node'));
  }
}

/**
 * Whether the native addon is available for this platform.
 *
 * On a developer machine that hasn't built the addon this returns `false`
 * and the native suites `describe.skip` themselves so the pure-TS tests
 * still run. On CI that MUST exercise the native paths, set
 * `REQUIRE_NATIVE=1`: a missing prebuild then throws at import time, turning
 * a would-be silent skip into a hard test failure. This prevents a broken or
 * mismatched `.node` from passing the gate simply because the native tests
 * were quietly skipped.
 *
 * The `testFileUrl` parameter is retained for call-site compatibility; the
 * probe itself is resolved relative to this helper.
 */
export function hasNative(_testFileUrl?: string): boolean {
  const present = prebuildPresent();
  if (!present && process.env.REQUIRE_NATIVE) {
    throw new Error(
      `REQUIRE_NATIVE is set but no native addon was found under ` +
        `prebuilds/${prebuildTriplet()}/. Build the addon before running the ` +
        `test suite (see CONTRIBUTING.md), or unset REQUIRE_NATIVE to allow ` +
        `native suites to skip on machines without a build.`,
    );
  }
  return present;
}
