#!/usr/bin/env node
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

// Drive cmake-js to build the addon and copy it into prebuilds/<triplet>/.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, arch } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function detectTriplet() {
  const a = arch() === 'arm64' ? 'arm64' : 'x64';
  if (platform() === 'win32') return 'win32-x64';
  if (platform() === 'darwin') return `darwin-${a}`;
  if (platform() === 'linux') {
    // Glibc Linux uses no suffix; musl gets `-musl` so the two libcs can
    // coexist as siblings under prebuilds/. This matches the directory
    // layout that cmake/node.cmake produces and that scripts/build-
    // platform-packages.mjs maps to platform-package names.
    return existsSync('/etc/alpine-release') ? `linux-${a}-musl` : `linux-${a}`;
  }
  throw new Error(`unsupported platform ${platform()}`);
}

const triplet = detectTriplet();
console.log(`[prebuild] triplet=${triplet}`);

const cmakeArgs = [
  'compile',
  '--CDBUILD_CXX=ON',
  '--CDBUILD_DEPS=ON',
  '--CDBUILD_NODE=ON',
  '--CDBUILD_SAMPLES=OFF',
  '--CDBUILD_EXAMPLES=OFF',
  '--CDBUILD_TESTING=OFF',
];

const cmakejs = process.env.CMAKE_JS ?? join(root, 'node_modules', '.bin', 'cmake-js');
console.log(`[prebuild] $ ${cmakejs} ${cmakeArgs.join(' ')}`);
const r = spawnSync(cmakejs, cmakeArgs, { cwd: root, stdio: 'inherit' });
if (r.status !== 0) {
  console.error(`[prebuild] cmake-js exited ${r.status}`);
  process.exit(r.status ?? 1);
}

// Locate the produced .node and copy it into prebuilds/<triplet>/node.napi.node.
function findNode(dir) {
  const ents = readdirSync(dir);
  for (const ent of ents) {
    const p = join(dir, ent);
    const st = statSync(p);
    if (st.isDirectory()) {
      const inner = findNode(p);
      if (inner) return inner;
    } else if (ent.endsWith('.node')) {
      return p;
    }
  }
  return null;
}

const buildDir = join(root, 'build');
const built = findNode(buildDir);
if (!built) {
  console.error(`[prebuild] no .node found under ${buildDir}`);
  process.exit(1);
}

const dst = join(root, 'prebuilds', triplet);
mkdirSync(dst, { recursive: true });
const dstFile = join(dst, 'node.napi.node');
copyFileSync(built, dstFile);
console.log(`[prebuild] wrote ${dstFile}`);
