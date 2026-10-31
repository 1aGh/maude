// V2-8.14 (p8-perf-814): the Alligators canvas `ui/2026/combine/Combine-admin.tsx` imports its
// stylesheet as `./combine-admin.css` (the file on disk is lower-case). Its board lives under the
// case-folded slug `ui-2026-combine-combine-admin.annotations.json`, so the closure walk took the
// stylesheet's same-name owner `ui/2026/combine/combine-admin.tsx` — a file that does not exist —
// for ANOTHER canvas (the board made it one), refused the import and blocked the granted canvas:
// every frame on it got 403 not-in-scope, so it never opened and its cover never rendered.
//
// A same-name owner that is no file, has no meta of its own and folds to the slug of exactly the
// granted canvas IS the granted canvas (the board is its own). Another canvas stays refused.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { closureConfigOf, closureFor, type ProjectReader } from '../access/closure.ts';
import { narrowToFrame } from '../access/frame.ts';
import { diskProjectReader } from '../access/request.ts';
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

// p8-closure-lows (V2-8.9 delta security pair, two Lows) — the rule above holds only while the
// walk can SEE every canvas that could own the stylesheet. Each case below refuses.
describe('the same-name owner rule fails closed (p8-closure-lows)', () => {
  const OWNER_REL = 'ui/2026/combine/combine-admin.tsx';
  const CSS = 'ui/2026/combine/combine-admin.css';

  test('a stored grant at the owner path keeps it a canvas: refused', () => {
    const cfg = closureConfigOf({}, [OWNER_REL]);
    const c = closureFor(narrowToFrame(OWNER, [GRANT]), project(BASE), undefined, cfg);
    expect(c.blocked.has(GRANT)).toBe(true);
    expect(c.read.has(CSS)).toBe(false);
  });

  test('a truncated listing cannot prove there is no twin: refused', () => {
    const reader: ProjectReader = { ...project(BASE), listTruncated: () => true };
    const c = closureFor(narrowToFrame(OWNER, [GRANT]), reader);
    expect(c.blocked.has(GRANT)).toBe(true);
    expect(c.read.has(CSS)).toBe(false);
  });

  test('an owner the listing leaves out but the design root holds: refused', () => {
    const reader: ProjectReader = { ...project(BASE), present: (r) => r === OWNER_REL };
    const c = closureFor(narrowToFrame(OWNER, [GRANT]), reader);
    expect(c.blocked.has(GRANT)).toBe(true);
    expect(c.read.has(CSS)).toBe(false);
  });

  describe('on disk', () => {
    // A slug-twin attacker (`ui/2026-combine/…` folds to the victim's slug) imports the victim's
    // stylesheet; the victim's own `.tsx` is a symlink, so the listing never names it.
    const ATTACKER = 'ui/2026-combine/combine-admin.tsx';
    const ATTACK: Record<string, string> = {
      'config.json': '{}',
      [ATTACKER]: CANVAS.replace('./combine-admin.css', '../2026/combine/combine-admin.css'),
      [CSS]: '.x{color:red}',
      'ui-2026-combine-combine-admin.annotations.json': '{"v":1}',
    };
    let root = '';
    let outside = '';
    const lay = (files: Record<string, string>) => {
      for (const [rel, body] of Object.entries(files)) {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), body);
      }
    };
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'p8-closure-lows-'));
      outside = mkdtempSync(join(tmpdir(), 'p8-closure-lows-out-'));
    });
    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    });

    test('baseline: Combine-admin reads its own stylesheet (case-insensitive disks too)', () => {
      lay(BASE);
      const c = closureFor(
        narrowToFrame(OWNER, [GRANT]),
        diskProjectReader(root, () => 'h')
      );
      expect(c.blocked.has(GRANT)).toBe(false);
      expect(c.read.has(CSS)).toBe(true);
    });

    test('a symlinked victim at the owner path (never listed): refused', () => {
      lay(ATTACK);
      const victim = join(outside, 'victim.tsx');
      writeFileSync(victim, CANVAS.replace('function A', 'function V'));
      symlinkSync(victim, join(root, OWNER_REL));
      const reader = diskProjectReader(root, () => 'h');
      expect([...reader.list()]).not.toContain(OWNER_REL);
      const c = closureFor(narrowToFrame(OWNER, [ATTACKER]), reader);
      expect(c.blocked.has(ATTACKER)).toBe(true);
      expect(c.read.has(CSS)).toBe(false);
    });

    test('a dangling symlink at the owner path: refused', () => {
      lay(ATTACK);
      symlinkSync(join(outside, 'gone.tsx'), join(root, OWNER_REL));
      const c = closureFor(
        narrowToFrame(OWNER, [ATTACKER]),
        diskProjectReader(root, () => 'h')
      );
      expect(c.blocked.has(ATTACKER)).toBe(true);
    });

    test('the disk reader reports a listing cut at its cap', () => {
      lay(BASE);
      const small = diskProjectReader(root, () => 'h', 2);
      expect([...small.list()].length).toBe(2);
      expect(small.listTruncated?.()).toBe(true);
      const whole = diskProjectReader(root, () => 'h');
      expect([...whole.list()].length).toBe(Object.keys(BASE).length);
      expect(whole.listTruncated?.()).toBe(false);
    });

    test('present() is exact-name, lstat-only and inside the design root', () => {
      lay(BASE);
      const reader = diskProjectReader(root, () => 'h');
      expect(reader.present?.(GRANT)).toBe(true);
      // the lower-case name is NOT present on a case-insensitive disk either
      expect(reader.present?.(OWNER_REL)).toBe(false);
      writeFileSync(join(outside, 'x.tsx'), '');
      expect(reader.present?.(`../${basename(outside)}/x.tsx`)).toBe(false);
      expect(reader.present?.(join(outside, 'x.tsx'))).toBe(false);
    });
  });
});
