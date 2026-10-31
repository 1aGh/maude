// p8-closure-lows-2 (V2-8.9 recheck) — the hub's project listing (access-files `projectReader`)
// reports what it left out, like the studio's `diskProjectReader`: `listTruncated` (the depth or
// file cap was hit), `unlisted` (canvas-shaped symlinks and dot names, by name, never followed) and
// `present` (an exact NFC-compared name in the parent's entries, inside the root). The closure's
// same-name owner rule (`grantedBySlug`) applies only to a reader that reports all three, so the
// Combine-admin case (V2-8.14) keeps working on a cell and a hidden twin keeps it refused.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { closureFor } from '../../studio/access/closure.ts';
import { narrowToFrame } from '../../studio/access/frame.ts';
import { resolveAccess } from '../../studio/access/scope.ts';
import { projectReader } from '../src/access-files.mjs';

const CANVAS = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import "./combine-admin.css";
export default function A() {
  return (<DesignCanvas><DCSection id="s" title="S">
    <DCArtboard id="a" label="A" width={960} height={600}><div className="x">a</div></DCArtboard>
  </DCSection></DesignCanvas>);
}
`;
const GRANT = 'ui/2026/combine/Combine-admin.tsx';
const CSS = 'ui/2026/combine/combine-admin.css';
const BASE = {
  'config.json': '{}',
  [GRANT]: CANVAS,
  'ui/2026/combine/Combine-admin.meta.json': '{}',
  [CSS]: '.x{color:red}',
  'ui-2026-combine-combine-admin.annotations.json': '{"v":1}',
};
const OWNER = resolveAccess({ v: 1, role: 'owner' });

let root = '';
let outside = '';
const lay = (files) => {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
};
const reader = () => projectReader({ designRoot: root, journal: null });
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hub-closure-lows-'));
  outside = mkdtempSync(join(tmpdir(), 'hub-closure-lows-out-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test('baseline: Combine-admin reads its own stylesheet through the hub reader', () => {
  lay(BASE);
  const r = reader();
  assert.equal(r.listTruncated(), false);
  assert.deepEqual([...r.unlisted()], []);
  const c = closureFor(narrowToFrame(OWNER, [GRANT]), r);
  assert.equal(c.blocked.has(GRANT), false);
  assert.equal(c.read.has(CSS), true);
});

test('a symlinked slug twin (never listed) is reported and keeps the stylesheet refused', () => {
  lay(BASE);
  writeFileSync(join(outside, 'twin.tsx'), CANVAS.replace('function A', 'function T'));
  mkdirSync(join(root, 'ui/2026-combine'), { recursive: true });
  symlinkSync(join(outside, 'twin.tsx'), join(root, 'ui/2026-combine/combine-admin.tsx'));
  const r = reader();
  assert.equal(r.list().has('ui/2026-combine/combine-admin.tsx'), false);
  assert.deepEqual([...r.unlisted()], ['ui/2026-combine/combine-admin.tsx']);
  const c = closureFor(narrowToFrame(OWNER, [GRANT]), r);
  assert.equal(c.blocked.has(GRANT), true);
  assert.equal(c.read.has(CSS), false);
});

test('a dot-named canvas file is reported as unlisted; a non-canvas symlink is not', () => {
  lay({ ...BASE, 'ui/.hidden.tsx': CANVAS, 'ui/.hidden.css': '' });
  writeFileSync(join(outside, 'n.png'), '');
  symlinkSync(join(outside, 'n.png'), join(root, 'ui/n.png'));
  const r = reader();
  assert.equal(r.list().has('ui/.hidden.tsx'), false);
  assert.deepEqual([...r.unlisted()], ['ui/.hidden.tsx']);
});

test('a listing past the depth cap is truncated: the owner rule refuses', () => {
  lay(BASE);
  lay({ 'a/b/c/d/e/f/g/h/i/deep.css': '' });
  const r = reader();
  assert.equal(r.listTruncated(), true);
  const c = closureFor(narrowToFrame(OWNER, [GRANT]), r);
  assert.equal(c.blocked.has(GRANT), true);
});

test('present() is exact-name (NFC on both sides, never case-folded) and inside the root', () => {
  lay(BASE);
  writeFileSync(join(outside, 'v.tsx'), '');
  symlinkSync(join(outside, 'v.tsx'), join(root, 'ui/café.tsx'));
  const r = reader();
  assert.equal(r.present(GRANT), true);
  assert.equal(r.present('ui/2026/combine/combine-admin.tsx'), false);
  assert.equal(r.present('ui/café.tsx'), true);
  assert.equal(r.present(`../${basename(outside)}/v.tsx`), false);
  assert.equal(r.present(join(outside, 'v.tsx')), false);
  assert.equal(r.present('ui/../config.json'), false);
});

test('a symlinked victim at the owner path: refused', () => {
  const attacker = 'ui/2026-combine/combine-admin.tsx';
  lay({
    'config.json': '{}',
    [attacker]: CANVAS.replace('./combine-admin.css', '../2026/combine/combine-admin.css'),
    [CSS]: '.x{color:red}',
    'ui-2026-combine-combine-admin.annotations.json': '{"v":1}',
  });
  writeFileSync(join(outside, 'victim.tsx'), CANVAS.replace('function A', 'function V'));
  symlinkSync(join(outside, 'victim.tsx'), join(root, 'ui/2026/combine/combine-admin.tsx'));
  const c = closureFor(narrowToFrame(OWNER, [attacker]), reader());
  assert.equal(c.blocked.has(attacker), true);
  assert.equal(c.read.has(CSS), false);
});
