// S2.11c (ed-lay-auto) — `layout.set-gap`: ⌥ "every gap at once" is ONE edit-op over several auto
// layouts: one write, one snapshot, one undo step. The canvas half is test/edit-layout-client.test.tsx.

import { describe, expect, test } from 'bun:test';

import { readAttributeState } from '../canvas-edit.ts';
import { type DispatchDeps, dispatchEditOp, EDIT_OPS, statusOf } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';

const FILE = 'ui/Home.tsx';

// Three frames in auto layout whose gap is 16px, one that is 24px, and a plain block.
const HOME = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={1440} height={900}>
        <section data-cd-id="a" style={{ display: "flex", gap: "16px" }}>
          <div data-cd-id="a1">One</div>
          <div data-cd-id="a2">Two</div>
        </section>
        <section data-cd-id="b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div data-cd-id="b1">One</div>
          <div data-cd-id="b2">Two</div>
        </section>
        <section data-cd-id="c" style={{ display: "grid", gap: "16px" }}>
          <div data-cd-id="c1">One</div>
        </section>
        <section data-cd-id="d" style={{ display: "flex", gap: "24px" }}>
          <div data-cd-id="d1">One</div>
        </section>
        <section data-cd-id="plain" style={{ display: "block" }}>Text</section>
        <section data-cd-id="classy" className="row">
          <div data-cd-id="k1">One</div>
        </section>
        <section data-cd-id="computed" style={styles.row}>
          <div data-cd-id="m1">One</div>
        </section>
        <section data-cd-id="locker" data-cd-locked="true" style={{ display: "flex", gap: "16px" }}>
          <div data-cd-id="l1">One</div>
        </section>
      </DCArtboard>
    </DesignCanvas>
  );
}
const styles = { row: { display: "flex" } };
`;

function harness(initial = HOME, held: string[] = []) {
  const files = new Map<string, string>([[FILE, initial]]);
  const snapshots: string[] = [];
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, before, after) => {
      snapshots.push(before);
      files.set(rel, after);
    },
    heldByAi: (_rel, element) => (held.includes(element) ? { mine: true } : null),
    log: createWriteLog(),
  };
  const run = (op: string, targets: string[], params?: Record<string, unknown>) =>
    dispatchEditOp(
      {
        file: FILE,
        op,
        targets: targets.map((element) => ({ artboard: 'desktop', element })),
        ...(params ? { params } : {}),
      },
      deps
    );
  return { files, snapshots, deps, run, src: () => files.get(FILE) as string };
}

const good = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const bad = (r: EditOpResult) => {
  if (r.ok) throw new Error('expected a refusal');
  return r;
};
const gap = (src: string, id: string) => {
  const s = readAttributeState(FILE, src, id, 'style.gap');
  return s.kind === 'literal' ? s.value : s.kind;
};
const SPACE = { gap: { token: '--space-5' } };

describe('layout.set-gap', () => {
  test('is registered under its registry id', () => {
    expect(EDIT_OPS.some((o) => o.id === 'layout.set-gap')).toBe(true);
  });

  test('one op over three containers: one write, one snapshot, all three change', async () => {
    const h = harness();
    const r = good(await h.run('layout.set-gap', ['a', 'b', 'c'], SPACE));
    expect(h.snapshots).toHaveLength(1);
    expect(h.snapshots[0]).toBe(HOME);
    for (const id of ['a', 'b', 'c']) expect(gap(h.src(), id)).toBe('var(--space-5)');
    expect(gap(h.src(), 'd')).toBe('24px'); // not a target: untouched
    expect(r.refs.map((x) => x.element)).toEqual(['a', 'b', 'c']);
  });

  test('one undo restores all of them (revert by the one writeId)', async () => {
    const h = harness();
    const r = good(await h.run('layout.set-gap', ['a', 'b', 'c'], SPACE));
    const undo = good(
      await dispatchEditOp(
        { file: FILE, op: 'revert', targets: [], params: { writeId: r.writeId } },
        h.deps
      )
    );
    expect(undo.ok).toBe(true);
    expect(h.src()).toBe(HOME);
  });

  test('a pixel value (⌘ any number) is written as px', async () => {
    const h = harness();
    good(await h.run('layout.set-gap', ['a', 'd'], { gap: { px: 20 } }));
    expect(gap(h.src(), 'a')).toBe('20px');
    expect(gap(h.src(), 'd')).toBe('20px');
  });

  test('a container with no gap yet gets one', async () => {
    const h = harness();
    good(await h.run('layout.set-gap', ['classy'], SPACE));
    expect(gap(h.src(), 'classy')).toBe('var(--space-5)');
  });

  test('the same gap again writes nothing new', async () => {
    const h = harness();
    good(await h.run('layout.set-gap', ['a', 'b'], { gap: { px: 16 } }));
    expect(h.snapshots).toHaveLength(0);
  });

  test('v1 reader: the file still parses as TSX, the same elements, only style changed', async () => {
    const h = harness();
    good(await h.run('layout.set-gap', ['a', 'b', 'c'], SPACE));
    const t = new Bun.Transpiler({ loader: 'tsx' });
    expect(() => t.transformSync(h.src())).not.toThrow();
    const ids = (s: string) => [...s.matchAll(/data-cd-id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids(h.src())).toEqual(ids(HOME));
    expect([...h.src().matchAll(/\bdata-[a-z-]+=/g)].map((m) => m[0]).sort()).toEqual(
      [...HOME.matchAll(/\bdata-[a-z-]+=/g)].map((m) => m[0]).sort()
    );
    // the only lines that differ are the three frames' style lines
    const a = HOME.split('\n');
    const b = h.src().split('\n');
    expect(b).toHaveLength(a.length);
    expect(b.filter((l, i) => l !== a[i])).toHaveLength(3);
  });

  describe('refusals write nothing (the whole request)', () => {
    const untouched = (h: ReturnType<typeof harness>) => {
      expect(h.snapshots).toHaveLength(0);
      expect(h.src()).toBe(HOME);
    };

    test('a locked target: 409, even with good targets before it', async () => {
      const h = harness();
      const r = bad(await h.run('layout.set-gap', ['a', 'locker'], SPACE));
      expect(r.code).toBe('locked');
      expect(statusOf(r)).toBe(409);
      untouched(h);
    });

    test('a target an AI run holds: 409', async () => {
      const h = harness(HOME, ['b']);
      const r = bad(await h.run('layout.set-gap', ['a', 'b'], SPACE));
      expect(r.code).toBe('held-by-ai');
      expect(statusOf(r)).toBe(409);
      untouched(h);
    });

    test('a target that is not a layout (display: block): 400', async () => {
      const h = harness();
      const r = bad(await h.run('layout.set-gap', ['a', 'plain'], SPACE));
      expect(r.code).toBe('invalid');
      expect(statusOf(r)).toBe(400);
      untouched(h);
    });

    test('a target whose style the file computes: 400', async () => {
      const h = harness();
      const r = bad(await h.run('layout.set-gap', ['a', 'computed'], SPACE));
      expect(statusOf(r)).toBe(400);
      untouched(h);
    });

    test('a target that is not on the canvas: 400', async () => {
      const h = harness();
      const r = bad(await h.run('layout.set-gap', ['a', 'nope'], SPACE));
      expect(statusOf(r)).toBe(400);
      untouched(h);
    });

    test('no target: 400', async () => {
      const h = harness();
      expect(statusOf(bad(await h.run('layout.set-gap', [], SPACE)))).toBe(400);
      untouched(h);
    });

    test.each([
      ['no gap', {}],
      ['a raw css string', { gap: '1px; color: red' }],
      ['a string in a token slot that is not a space token', { gap: { token: 'x; y' } }],
      ['a non-space token', { gap: { token: '--color-accent' } }],
      ['a negative number', { gap: { px: -4 } }],
      ['NaN', { gap: { px: Number.NaN } }],
      ['an absurd number', { gap: { px: 1e9 } }],
    ] as const)('a bad value (%s): 400', async (_name, params) => {
      const h = harness();
      const r = bad(await h.run('layout.set-gap', ['a', 'b'], params as Record<string, unknown>));
      expect(statusOf(r)).toBe(400);
      untouched(h);
    });
  });
});
