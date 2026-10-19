// S4.11 — `element.stamp` (contract S2-S4-artboard-motion-ids.md §3, Q12): an arrow can only bind to an
// element by an AUTHORED id, so the canvas asks the one edit-op dispatcher to name it. The stamp is the
// write — the op itself changes nothing — and an element that already has an id answers `ok` with no
// write. A locked element may still be pointed at; an AI hold still refuses (the arrow then binds to the
// artboard); a stale revision refuses; the registry has the (hidden) row the dispatcher's op id names.

import { describe, expect, test } from 'bun:test';
import { ACTIONS } from '../actions/index.ts';
import { listElements } from '../canvas-edit.ts';
import { type DispatchDeps, dispatchEditOp, EDIT_OPS, revOf } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import { elementStamp } from '../edit-ops/stamp.ts';
import type { EditOpResult } from '../edit-ops/types.ts';

const FILE = 'ui/Home.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <section data-cd-id="services" className="services">
          <button className="cta">See the work</button>
          <img data-cd-id="logo" data-cd-locked className="logo" src="/logo.svg" alt="Acme" />
        </section>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(over: Partial<DispatchDeps> = {}) {
  const files = new Map<string, string>([[FILE, SRC]]);
  const writes: Array<{ label: string }> = [];
  const held = new Map<string, { mine: boolean }>();
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _before, after, label) => {
      files.set(rel, after);
      writes.push({ label });
    },
    heldByAi: (_rel, el) => held.get(el) ?? null,
    log: createWriteLog(),
    ops: [elementStamp],
    ...over,
  };
  return { files, writes, held, run: (body: unknown) => dispatchEditOp(body, deps) };
}
const ok = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const computedOf = (tag: string) =>
  listElements(FILE, SRC).find((e) => e.print.tag === tag)?.id as string;

describe('element.stamp', () => {
  test('an unnamed element is given a readable id; the answer carries it', async () => {
    const h = harness();
    const computed = computedOf('button');
    expect(computed).toMatch(/^[0-9a-f]{8}$/);
    const r = ok(
      await h.run({
        file: FILE,
        op: 'element.stamp',
        targets: [{ artboard: 'desktop', element: computed }],
      })
    );
    expect(r.refs).toHaveLength(1);
    const id = r.refs[0]?.element as string;
    expect(id).not.toMatch(/^[0-9a-f]{8}$/);
    expect(h.files.get(FILE)).toContain(`data-cd-id="${id}"`);
    expect(h.writes).toHaveLength(1);
    // the source is otherwise byte-for-byte what it was
    expect((h.files.get(FILE) as string).replace(` data-cd-id="${id}"`, '')).toBe(SRC);
  });

  test('an already-named element answers ok and writes nothing', async () => {
    const h = harness();
    const r = ok(
      await h.run({
        file: FILE,
        op: 'element.stamp',
        targets: [{ artboard: 'desktop', element: 'services' }],
      })
    );
    expect(r.refs[0]?.element).toBe('services');
    expect(h.writes).toEqual([]);
    expect(h.files.get(FILE)).toBe(SRC);
  });

  test('a locked element may still be pointed at (a lock forbids changes, not references)', async () => {
    const h = harness();
    ok(
      await h.run({
        file: FILE,
        op: 'element.stamp',
        targets: [{ artboard: 'desktop', element: 'logo' }],
      })
    );
  });

  test('a live AI run holds the element: held-by-ai (the arrow falls back to the artboard)', async () => {
    const h = harness();
    h.held.set('services', { mine: false });
    const r = await h.run({
      file: FILE,
      op: 'element.stamp',
      targets: [{ artboard: 'desktop', element: 'services' }],
    });
    expect(!r.ok && r.code).toBe('held-by-ai');
    expect(h.writes).toEqual([]);
  });

  test('a moved file is stale; the revision the caller saw makes it ok', async () => {
    const h = harness();
    const computed = computedOf('button');
    const stale = await h.run({
      file: FILE,
      op: 'element.stamp',
      targets: [{ artboard: 'desktop', element: computed }],
      expectRev: '0123456789abcdef',
    });
    expect(!stale.ok && stale.code).toBe('stale');
    ok(
      await h.run({
        file: FILE,
        op: 'element.stamp',
        targets: [{ artboard: 'desktop', element: computed }],
        expectRev: revOf(SRC),
      })
    );
  });

  test('the shipped op table has the writer, so the real route can run it', async () => {
    expect(EDIT_OPS.some((o) => o.id === 'element.stamp')).toBe(true);
    const h = harness({ ops: undefined });
    ok(
      await h.run({
        file: FILE,
        op: 'element.stamp',
        targets: [{ artboard: 'desktop', element: computedOf('button') }],
      })
    );
    expect(h.writes).toHaveLength(1);
  });

  test('the registry has the (hidden) row the dispatcher’s op id names, and annotation.point-to', () => {
    const stamp = ACTIONS.find((a) => a.id === 'element.stamp');
    expect(stamp).toBeDefined();
    expect(stamp?.search?.hidden).toBe(true);
    expect(stamp?.keys ?? []).toEqual([]);
    expect(ACTIONS.some((a) => a.id === 'annotation.point-to')).toBe(true);
  });
});
