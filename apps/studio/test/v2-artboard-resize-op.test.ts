// S2.8 — `artboard.resize` through the one dispatch route (S2-edit-ops.md): a handle drag / an inspector number
// lands in the VERSIONED file (JSX width/height, DDR-027), the way canvas-tsx.md says to do it by hand — and
// never in the per-user camera. Pure dispatcher harness (no server), the same shape as edit-op-dispatch.test.ts.
import { describe, expect, test } from 'bun:test';

import { type DispatchDeps, dispatchEditOp, EDIT_OPS } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';

const FILE = 'ui/Home.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={1440} height={900} kind="web">
        <section data-cd-id="hero">Hello</section>
      </DCArtboard>
      <DCArtboard id="mobile" label="Mobile" width={390} height={844} fixed>
        <p>Hi</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness() {
  const files = new Map<string, string>([[FILE, SRC]]);
  const writes: string[] = [];
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after, label) => {
      files.set(rel, after);
      writes.push(label);
    },
    heldByAi: () => null,
    log: createWriteLog(),
  };
  return {
    files,
    writes,
    run: (params: Record<string, unknown>) =>
      dispatchEditOp({ file: FILE, op: 'artboard.resize', targets: [], params }, deps),
  };
}
const ok = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};

describe('artboard.resize', () => {
  test('is in the op table the route dispatches (not only in a test table)', () => {
    expect(EDIT_OPS.some((o) => o.id === 'artboard.resize')).toBe(true);
  });

  test('a width drag writes the numeric width prop and nothing else', async () => {
    const h = harness();
    ok(await h.run({ artboard: 'desktop', width: 1280 }));
    expect(h.files.get(FILE)).toContain('id="desktop" label="Desktop" width={1280} height={900}');
    expect(h.files.get(FILE)).not.toContain('fixed kind');
    expect(h.writes).toEqual(['pre-artboard.resize']);
  });

  test('a bottom-edge drag writes the height AND the bare `fixed` prop in ONE write', async () => {
    const h = harness();
    ok(await h.run({ artboard: 'desktop', height: 1200, fixed: true }));
    const out = h.files.get(FILE) ?? '';
    expect(out).toMatch(/<DCArtboard[^>]*id="desktop"[^>]*height=\{1200\}/);
    expect(out).toMatch(
      /<DCArtboard\s[^>]*\bfixed\b[^>]*id="desktop"|<DCArtboard[^>]*id="desktop"[^>]*\bfixed\b/
    );
    expect(h.writes.length).toBe(1);
  });

  test('"Fits content" removes `fixed` and leaves the height as the floor', async () => {
    const h = harness();
    ok(await h.run({ artboard: 'mobile', fixed: false }));
    const out = h.files.get(FILE) ?? '';
    expect(out).toMatch(/<DCArtboard[^>]*id="mobile"[^>]*height=\{844\}/);
    expect(out).not.toMatch(/<DCArtboard[^>]*id="mobile"[^>]*\bfixed\b/);
  });

  test('only the named artboard moves', async () => {
    const h = harness();
    ok(await h.run({ artboard: 'desktop', width: 1000, height: 700 }));
    expect(h.files.get(FILE)).toContain('width={390} height={844} fixed');
  });

  test('sizes are clamped to what the resize route always accepted (64 … 8192) and rounded', async () => {
    const h = harness();
    ok(await h.run({ artboard: 'desktop', width: 99999, height: 3.4 }));
    expect(h.files.get(FILE)).toContain('width={8192} height={64}');
  });

  test('an unchanged size answers ok with no write and no action', async () => {
    const h = harness();
    const r = ok(await h.run({ artboard: 'desktop', width: 1440, height: 900 }));
    expect(h.writes).toEqual([]);
    expect(r.actionId).toBeNull();
  });

  test('refuses an artboard that is not in the file, a bad id, and an empty request, in words', async () => {
    const h = harness();
    for (const params of [
      { artboard: 'nope', width: 500 },
      { artboard: '../x', width: 500 },
      { artboard: 'desktop' },
    ]) {
      const r = await h.run(params);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('invalid');
        expect(r.message.length).toBeGreaterThan(0);
        expect(r.message).not.toMatch(/at \w+ \(/); // never a stack
      }
    }
    expect(h.writes).toEqual([]);
  });

  test('a width that is not a number is refused, not written as NaN', async () => {
    const h = harness();
    const r = await h.run({ artboard: 'desktop', width: 'wide' });
    expect(r.ok).toBe(false);
    expect(h.files.get(FILE)).toBe(SRC);
  });

  test('the write never carries the camera: no viewport / x / y reaches the file', async () => {
    const h = harness();
    ok(await h.run({ artboard: 'desktop', width: 1000, x: 50, y: 60, viewport: { zoom: 2 } }));
    const out = h.files.get(FILE) ?? '';
    expect(out).not.toContain('viewport');
    expect(out).not.toMatch(/\sx=\{/);
  });
});
