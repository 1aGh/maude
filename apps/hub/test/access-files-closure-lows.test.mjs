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

import { closureFor, createClosureCache } from '../../studio/access/closure.ts';
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

// p8-closure-lows-3 (V2-8.9 recheck #2, Low) — `present()` must not follow a symlinked parent
// folder. A tenant commits `link/foo.css`, then swaps `link/` for a symlink to a host folder; the
// stale journal row keeps `link/foo.css` listed. A granted `link-foo.tsx` with a board importing
// `./link/foo.css` would ask `present('link/foo.tsx')`, and the answer would be the host folder's
// listing — one bit about the host. A parent whose real path leaves the root answers "present", so
// the stylesheet stays the (unknowable) owner's: refused, whatever the host folder holds.
const LINK_GRANT = 'link-foo.tsx';
const LINK_CSS = 'link/foo.css';
const linkCanvas = CANVAS.replace('./combine-admin.css', `./${LINK_CSS}`);
const journalOf = (paths) => ({
  epoch: () => 'e1',
  head: () => 1,
  compaction: () => paths.map((path) => ({ path })),
});

test('present() answers true under a parent folder that symlinks outside the root', () => {
  lay({ 'config.json': '{}', [LINK_GRANT]: linkCanvas, 'link-foo.annotations.json': '{"v":1}' });
  symlinkSync(outside, join(root, 'link'));
  const r = projectReader({ designRoot: root, journal: journalOf([LINK_CSS]) });
  assert.equal(r.list().has(LINK_CSS), true);
  // the host folder holds no foo.tsx — the answer must not depend on that
  assert.equal(r.present('link/foo.tsx'), true);
  assert.equal(r.present('link/foo.meta.json'), true);
  // a nested missing folder under the escaping link: still fail closed
  assert.equal(r.present('link/sub/foo.tsx'), true);
  // the observable bit: the grant is blocked (the import refused) whether or not the host folder
  // holds foo.tsx — pre-fix it opened when the host folder lacked one
  const c = closureFor(narrowToFrame(OWNER, [LINK_GRANT]), r);
  assert.equal(c.blocked.has(LINK_GRANT), true);
  assert.equal(c.read.has(LINK_CSS), false);
});

test('present() still answers false for a missing name in a missing in-root folder', () => {
  lay(BASE);
  const r = reader();
  assert.equal(r.present('ui/nope/x.tsx'), false);
  assert.equal(r.present('config.tsx'), false);
});

// p8-closure-lows-3 (Info) — the reader's cache key covers what the walk left out: a commit that only
// adds a symlinked twin (or an empty deep folder past the cap) leaves every walked file and the
// journal head unchanged, so a cached "granted" closure would otherwise survive it.
test('adding only a symlinked slug twin changes head(): the closure is recomputed and refused', () => {
  lay(BASE);
  const cache = createClosureCache(8);
  const first = reader();
  const before = closureFor(narrowToFrame(OWNER, [GRANT]), first, cache);
  assert.equal(before.read.has(CSS), true);
  writeFileSync(join(outside, 'twin.tsx'), CANVAS.replace('function A', 'function T'));
  mkdirSync(join(root, 'ui/2026-combine'), { recursive: true });
  symlinkSync(join(outside, 'twin.tsx'), join(root, 'ui/2026-combine/combine-admin.tsx'));
  const second = reader();
  assert.notEqual(second.head(), first.head());
  const after = closureFor(narrowToFrame(OWNER, [GRANT]), second, cache);
  assert.equal(after.blocked.has(GRANT), true);
  assert.equal(after.read.has(CSS), false);
});

test('a walk that only becomes truncated changes head()', () => {
  lay(BASE);
  const first = reader();
  mkdirSync(join(root, 'a/b/c/d/e/f/g/h/i'), { recursive: true });
  const second = reader();
  assert.equal(second.listTruncated(), true);
  assert.notEqual(second.head(), first.head());
});
