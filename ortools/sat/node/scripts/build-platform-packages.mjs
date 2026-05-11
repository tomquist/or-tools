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

// Assemble per-platform npm packages from prebuilds/<triplet>/.
//
// Reads ortools/sat/node/prebuilds/ and writes a staging directory per
// recognised triplet under ortools/sat/node/_platform-packages/. Each
// staging dir contains a generated package.json (with the right name,
// version, os/cpu/libc, and main: ./cp-sat.node), the renamed addon, every
// bundled runtime library (libortools.so.X / libortools.*.dylib / etc.),
// plus README.md, LICENSE, and THIRD_PARTY_NOTICES.md.
//
// The script never reads the network and never runs npm itself. CI runs
// `npm pack` on each emitted directory in a separate step.
//
// Usage:
//   node scripts/build-platform-packages.mjs

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const prebuildsDir = join(root, 'prebuilds');
const stagingRoot = join(root, '_platform-packages');

// Whitelist of triplets we publish per-platform packages for. Anything else
// in prebuilds/ (e.g. linux-x64-musl, win32-x64) is logged and skipped.
//
// The `libc` field is recognised by npm 10+ as an install-time filter,
// matching how `os` and `cpu` work. Declaring it on the glibc Linux
// packages prevents Alpine/musl users from auto-installing a binary that
// would crash on first solve; our loader's error then steers them to
// build-from-source.
const PLATFORMS = {
  'linux-x64': { name: 'cp-sat-linux-x64', os: ['linux'], cpu: ['x64'], libc: ['glibc'] },
  'linux-arm64': { name: 'cp-sat-linux-arm64', os: ['linux'], cpu: ['arm64'], libc: ['glibc'] },
  'darwin-x64': { name: 'cp-sat-darwin-x64', os: ['darwin'], cpu: ['x64'] },
  'darwin-arm64': { name: 'cp-sat-darwin-arm64', os: ['darwin'], cpu: ['arm64'] },
};

const pkgJsonPath = join(root, 'package.json');
const mainPkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
const version = mainPkg.version;
if (!version) {
  console.error(`[build-platform-packages] missing version in ${pkgJsonPath}`);
  process.exit(1);
}

if (!existsSync(prebuildsDir)) {
  console.error(
    `[build-platform-packages] no prebuilds/ directory at ${prebuildsDir}; nothing to do.`,
  );
  process.exit(1);
}

// Wipe any prior staging output so reruns are deterministic.
if (existsSync(stagingRoot)) {
  rmSync(stagingRoot, { recursive: true, force: true });
}
mkdirSync(stagingRoot, { recursive: true });

const triplets = readdirSync(prebuildsDir).filter((name) =>
  statSync(join(prebuildsDir, name)).isDirectory(),
);

let built = 0;
for (const triplet of triplets) {
  const meta = PLATFORMS[triplet];
  if (!meta) {
    console.warn(
      `[build-platform-packages] skipping unknown triplet '${triplet}' (no platform package configured)`,
    );
    continue;
  }
  const srcDir = join(prebuildsDir, triplet);
  const entries = readdirSync(srcDir).filter((f) =>
    statSync(join(srcDir, f)).isFile(),
  );
  if (entries.length === 0) {
    console.warn(`[build-platform-packages] prebuilds/${triplet}/ is empty; skipping`);
    continue;
  }

  // The native addon is the only .node file in the triplet dir. We rename
  // it to a stable cp-sat.node so the platform package's package.json can
  // declare a fixed `"main": "./cp-sat.node"` regardless of the upstream
  // node-gyp-build naming convention (node.napi.glibc.node, node.napi.node,
  // etc.). All other files (libortools.so.X, libabsl_*.dylib, ...) keep
  // their original names so SONAME / install_name lookups still resolve.
  const nodeFiles = entries.filter((f) => f.endsWith('.node'));
  if (nodeFiles.length !== 1) {
    console.error(
      `[build-platform-packages] expected exactly one .node file in prebuilds/${triplet}/, found: ${nodeFiles.join(', ') || '(none)'}`,
    );
    process.exit(1);
  }
  const addonSrc = nodeFiles[0];

  const dstDir = join(stagingRoot, meta.name);
  mkdirSync(dstDir, { recursive: true });

  for (const file of entries) {
    const dstName = file === addonSrc ? 'cp-sat.node' : file;
    copyFileSync(join(srcDir, file), join(dstDir, dstName));
  }

  // Author the platform package.json.
  const pkg = {
    name: `@ortools-node/${meta.name}`,
    version,
    description: `Prebuilt native addon for @ortools-node/cp-sat on ${triplet}.`,
    license: 'Apache-2.0',
    homepage: 'https://developers.google.com/optimization',
    repository: {
      type: 'git',
      url: 'https://github.com/tomquist/or-tools.git',
      directory: 'ortools/sat/node',
    },
    publishConfig: { access: 'public' },
    engines: { node: '>=20.0.0' },
    os: meta.os,
    cpu: meta.cpu,
    ...(meta.libc ? { libc: meta.libc } : {}),
    main: './cp-sat.node',
  };
  writeFileSync(join(dstDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  // Author a short README that identifies the package and points users at
  // the main package. Per-platform packages aren't intended to be depended
  // on directly.
  const readme = `# @ortools-node/${meta.name}

Prebuilt native CP-SAT solver addon for [\`@ortools-node/cp-sat\`](https://www.npmjs.com/package/@ortools-node/cp-sat) on ${triplet}.

This package is installed automatically as an optional dependency of the
main \`@ortools-node/cp-sat\` package — you should not depend on it directly.
Public API, docs, and changelog live in the main package's repository:

https://github.com/tomquist/or-tools/tree/stable-node/ortools/sat/node

License: Apache-2.0. See [\`THIRD_PARTY_NOTICES.md\`](./THIRD_PARTY_NOTICES.md)
for the licenses of bundled C/C++ runtime libraries.
`;
  writeFileSync(join(dstDir, 'README.md'), readme);

  // Mirror LICENSE and THIRD_PARTY_NOTICES from the main package so each
  // tarball is self-contained for npm/pyrsia metadata scanners.
  copyFileSync(join(root, 'LICENSE'), join(dstDir, 'LICENSE'));
  copyFileSync(
    join(root, 'THIRD_PARTY_NOTICES.md'),
    join(dstDir, 'THIRD_PARTY_NOTICES.md'),
  );

  console.log(
    `[build-platform-packages] staged ${meta.name} (${entries.length} files) -> ${dstDir}`,
  );
  built++;
}

if (built === 0) {
  console.error('[build-platform-packages] no platform packages built');
  process.exit(1);
}
console.log(`[build-platform-packages] built ${built} platform package(s) at ${stagingRoot}`);
