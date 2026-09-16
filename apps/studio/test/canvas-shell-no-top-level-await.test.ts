// The canvas shell's module must not suspend at the top level.
//
// With a top-level `await` the shell was the one asynchronously-evaluated
// module on the page, suspended with its own dynamic imports in flight while
// the canvas built. Switching canvases away and back on the desktop tore the
// half-loaded frame down in that state and eventually wedged WKWebView's web
// content process inside JavaScriptCore's module loader (surface row L23,
// 2026-09-16). The boot runs in an async function nothing awaits instead.
//
// Asked of V8 rather than of a regex: `SourceTextModule#hasTopLevelAwait` is
// the engine's own answer, and a regex cannot tell `await` in a nested
// function from `await` at the top.

import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SHELL = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  'plugins',
  'design',
  'templates',
  '_shell.html'
);

test('every inline module in the canvas shell finishes evaluating without suspending', () => {
  const html = readFileSync(SHELL, 'utf8');
  const modules = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(
    (m) => m[1]
  );
  expect(modules.length).toBeGreaterThan(0);
  const probe = spawnSync(
    'node',
    [
      '--experimental-vm-modules',
      '--no-warnings',
      '-e',
      `const vm = require('node:vm');
       let src = ''; process.stdin.on('data', (c) => (src += c)).on('end', () => {
         const out = JSON.parse(src).map((s) => new vm.SourceTextModule(s).hasTopLevelAwait());
         process.stdout.write(JSON.stringify(out));
       });`,
    ],
    { input: JSON.stringify(modules), encoding: 'utf8' }
  );
  expect(probe.status).toBe(0);
  const verdicts = JSON.parse(probe.stdout) as boolean[];
  // Not vacuous: the engine answered for each module it was given.
  expect(verdicts).toHaveLength(modules.length);
  expect(verdicts).toEqual(modules.map(() => false));
});
