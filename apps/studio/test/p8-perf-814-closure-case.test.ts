// V2-8.14 (p8-perf-814): the Alligators canvas `ui/2026/combine/Combine-admin.tsx` imports its
// stylesheet as `./combine-admin.css` (the file on disk is lower-case). Its board lives under the
// case-folded slug `ui-2026-combine-combine-admin.annotations.json`, so the closure walk took the
// stylesheet's same-name owner `ui/2026/combine/combine-admin.tsx` — a file that does not exist —
// for ANOTHER canvas (the board made it one), refused the import and blocked the granted canvas:
// every frame on it got 403 not-in-scope, so it never opened and its cover never rendered.
//
// A same-name owner that is no file, has no meta of its own and folds to the slug of exactly the
// granted canvas IS the granted canvas (the board is its own). Another canvas stays refused.

import { describe, expect, test } from 'bun:test';

import { closureFor, type ProjectReader } from '../access/closure.ts';
import { narrowToFrame } from '../access/frame.ts';
import { resolveAccess } from '../access/scope.ts';

function project(files: Record<string, string>): ProjectReader {
  return { list: () => Object.keys(files), text: (r) => files[r] ?? null, head: () => 'h1' };
}

const CANVAS = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import "./combine-admin.css";
export default function A() {
  return (<DesignCanvas><DCSection id="s" title="S">
    <DCArtboard id="a" label="A" width={960} height={600}><div className="x">a</div></DCArtboard>
  </DCSection></DesignCanvas>);
}
`;

const BASE: Record<string, string> = {
  'config.json': '{}',
  'ui/2026/combine/Combine-admin.tsx': CANVAS,
  'ui/2026/combine/Combine-admin.meta.json': '{}',
  'ui/2026/combine/combine-admin.css': '.x{color:red}',
  // the board: slug-keyed, the slug is case-folded
  'ui-2026-combine-combine-admin.annotations.json': '{"v":1}',
};

const OWNER = resolveAccess({ v: 1, role: 'owner' });
const GRANT = 'ui/2026/combine/Combine-admin.tsx';

describe('a canvas importing its own stylesheet under another letter case (V2-8.14)', () => {
  test('the frame is not blocked and reads the stylesheet', () => {
    const c = closureFor(narrowToFrame(OWNER, [GRANT]), project(BASE));
    expect(c.blocked.has(GRANT)).toBe(false);
    expect(c.read.has('ui/2026/combine/combine-admin.css')).toBe(true);
  });

  test('a real canvas behind that name is still another canvas: refused', () => {
    const files = {
      ...BASE,
      'ui/2026/combine/combine-admin.tsx': CANVAS.replace('function A', 'function B'),
    };
    const c = closureFor(narrowToFrame(OWNER, [GRANT]), project(files));
    expect(c.blocked.has(GRANT)).toBe(true);
  });

  test('an orphan meta at that exact name keeps it a canvas: refused', () => {
    const files = { ...BASE, 'ui/2026/combine/combine-admin.meta.json': '{}' };
    const c = closureFor(narrowToFrame(OWNER, [GRANT]), project(files));
    expect(c.blocked.has(GRANT)).toBe(true);
  });

  test('a slug twin (another canvas folding to the same slug) keeps the owner unresolved: refused', () => {
    const files = { ...BASE, 'ui/2026-combine/combine-admin.tsx': CANVAS };
    const c = closureFor(narrowToFrame(OWNER, [GRANT]), project(files));
    expect(c.blocked.has(GRANT)).toBe(true);
  });
});
