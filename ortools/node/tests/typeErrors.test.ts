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

// Verifies that the intentionally-broken `tests/fixtures/typeErrors.invalid.ts`
// compiles cleanly under strict TS — which happens only if every
// `@ts-expect-error` site above it really is a type error.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');

describe('compile-time type guards (D4, D15)', () => {
  it('fixtures/typeErrors.invalid.ts compiles only because @ts-expect-error covers every issue', () => {
    const res = spawnSync(
      'npx',
      [
        'tsc',
        '--noEmit',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--strict',
        '--noUncheckedIndexedAccess',
        '--exactOptionalPropertyTypes',
        '--verbatimModuleSyntax',
        '--useUnknownInCatchVariables',
        '--skipLibCheck',
        'tests/fixtures/typeErrors.invalid.ts',
      ],
      { cwd: pkgRoot, encoding: 'utf8' },
    );
    if (res.status !== 0) {
      console.error('stdout:', res.stdout);
      console.error('stderr:', res.stderr);
    }
    expect(res.status).toBe(0);
  }, 30000);
});
