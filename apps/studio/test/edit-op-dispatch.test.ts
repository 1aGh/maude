// S2.1 — the edit-op dispatcher (contract client/v2/contracts/S2-edit-ops.md §2–§5): the refusal
// order, stamping, AI holds, locks, and the legacy-link revert (three-way, never a whole-file swap).

import { describe, expect, test } from 'bun:test';

import { applyEdit, applySetLocked, CanvasEditError, listElements } from '../canvas-edit.ts';
import { type DispatchDeps, dispatchEditOp, revOf, statusOf } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOp, EditOpResult } from '../edit-ops/types.ts';

const FILE = 'ui/Home.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <section data-cd-id="services" className="services">
          <article data-cd-id="brand-systems" className="card">Brand systems</article>
          <img data-cd-id="logo" data-cd-locked className="logo" src="/logo.svg" alt="Acme" />
          <p className="note">Made in Brno</p>
        </section>
        <footer data-cd-id="footer">Footer</footer>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

/** test ops: a colour write, a lock (the one op that may touch a locked target), a refusal */
const OPS: EditOp[] = [
  {
    id: 'test.paint',
    apply: (src, r) => {
      let out = src;
      for (const t of r.targets)
        out = applyEdit(r.file, out, t.element, 'style.color', "'red'").source;
      return { source: out };
    },
  },
  {
    id: 'object.lock',
    locked: 'allow',
    apply: (src, r) => ({
      source: r.targets.reduce((s, t) => applySetLocked(r.file, s, t.element, true).source, src),
    }),
  },
  {
    id: 'test.refuse',
    apply: () => {
      throw new CanvasEditError('That frame has no children to unframe.', { canvas: FILE, id: '' });
    },
  },
];

function harness(over: Partial<DispatchDeps> = {}) {
  const files = new Map<string, string>([[FILE, SRC]]);
  const writes: Array<{ rel: string; label: string }> = [];
  const held = new Map<string, { mine: boolean }>();
  const deps: DispatchDeps = {
    resolve: (f) => {
      const rel = f.replace(/^\.design\//, '');
      return files.has(rel) ? rel : null;
    },
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _before, after, label) => {
      files.set(rel, after);
      writes.push({ rel, label });
    },
    heldByAi: (_rel, el) => held.get(el) ?? null,
    log: createWriteLog(),
    ops: OPS,
    ...over,
  };
  const run = (body: unknown) => dispatchEditOp(body, deps);
  return { files, writes, held, deps, run };
}

const ok = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const ref = (element: string, artboard = 'desktop') => ({ artboard, element });

describe('edit-op dispatch: what it refuses', () => {
  test('an unknown op, a junk body, a junk ref and a foreign file are invalid (400), with no write', async () => {
    const h = harness();
    for (const body of [
      { file: FILE, op: 'object.nope', targets: [] },
      null,
      { file: FILE, op: 'test.paint', targets: 'all' },
      { file: FILE, op: 'test.paint', targets: [{ artboard: 'desktop', element: '../x' }] },
      { file: 'ui/Missing.tsx', op: 'test.paint', targets: [ref('footer')] },
      { file: FILE, op: 'test.paint', targets: [ref('nowhere')] },
      { file: FILE, op: 'test.paint', targets: [ref('footer', 'mobile')] },
    ]) {
      const r = await h.run(body);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.code).toBe('invalid');
      expect(statusOf(r)).toBe(400);
    }
    expect(h.writes).toEqual([]);
  });

  test('expectRev: the revision the caller saw, else stale (409)', async () => {
    const h = harness();
    const stale = await h.run({
      file: FILE,
      op: 'test.paint',
      targets: [ref('footer')],
      expectRev: '0'.repeat(16),
    });
    expect(!stale.ok && stale.code).toBe('stale');
    expect(statusOf(stale)).toBe(409);
    const r = ok(
      await h.run({ file: FILE, op: 'test.paint', targets: [ref('footer')], expectRev: revOf(SRC) })
    );
    expect(r.rev).toBe(revOf(h.files.get(FILE) as string));
  });

  test('a target a live AI run holds refuses with held-by-ai (409) and the S5.4 copy; nothing written', async () => {
    const h = harness();
    h.held.set('footer', { mine: true });
    const r = await h.run({
      file: FILE,
      op: 'test.paint',
      targets: [ref('services'), ref('footer')],
    });
    expect(r).toEqual({
      ok: false,
      code: 'held-by-ai',
      message: "footer is AI's until it's done · Stop in the AI chat",
    });
    expect(h.writes).toEqual([]);
    expect(h.files.get(FILE)).toBe(SRC);
    h.held.set('footer', { mine: false });
    const other = await h.run({ file: FILE, op: 'test.paint', targets: [ref('footer')] });
    expect(!other.ok && other.message).toBe("footer is AI's until it's done");
  });

  test('a locked target refuses (409 locked) unless the op is the lock; AI holds come first', async () => {
    const h = harness();
    const r = await h.run({ file: FILE, op: 'test.paint', targets: [ref('logo')] });
    expect(r).toEqual({ ok: false, code: 'locked', message: 'logo is locked · ⇧⌘L unlocks' });
    expect(
      ok(await h.run({ file: FILE, op: 'object.lock', targets: [ref('logo')] })).actionId
    ).toBeNull();
    h.held.set('logo', { mine: true });
    const both = await h.run({ file: FILE, op: 'test.paint', targets: [ref('logo')] });
    expect(!both.ok && both.code).toBe('held-by-ai');
  });

  test("a writer's CanvasEditError is invalid with its words, never a stack", async () => {
    const h = harness();
    const r = await h.run({ file: FILE, op: 'test.refuse', targets: [ref('services')] });
    expect(r).toEqual({
      ok: false,
      code: 'invalid',
      message: 'That frame has no children to unframe.',
    });
  });
});

describe('edit-op dispatch: one write', () => {
  test('a computed-id target is stamped in the same write; refs carry the authored id', async () => {
    const h = harness();
    const computed = listElements(FILE, SRC).find((e) => e.print.tag === 'p')?.id as string;
    expect(computed).toMatch(/^[0-9a-f]{8}$/);
    const r = ok(
      await h.run({ file: `.design/${FILE}`, op: 'test.paint', targets: [ref(computed)] })
    );
    expect(r.refs).toEqual([ref('made-in-brno')]);
    const out = h.files.get(FILE) as string;
    expect(out).toMatch(/<p [^>]*data-cd-id="made-in-brno"/);
    expect(out).toContain("color: 'red'");
    expect(h.writes).toEqual([{ rel: FILE, label: 'pre-test.paint' }]);
    expect(r.writeId).toMatch(/^w_[0-9a-f]{16}$/);
  });

  test('actionId is what the runtime says the write became, else null', async () => {
    const h = harness({ actionFor: (_rel, after) => (after.includes("'red'") ? 'act_1' : null) });
    expect(
      ok(await h.run({ file: FILE, op: 'test.paint', targets: [ref('footer')] })).actionId
    ).toBe('act_1');
  });
});

describe('edit-op revert (legacy link, contract §5)', () => {
  test('undo is a three-way revert: a later change elsewhere survives; redo = revert of the revert', async () => {
    const h = harness();
    const w = ok(await h.run({ file: FILE, op: 'test.paint', targets: [ref('footer')] }));
    const painted = h.files.get(FILE) as string;
    // a teammate renames the card meanwhile — not the bytes the paint wrote
    h.files.set(FILE, painted.replace('>Brand systems<', '>Brand studio<'));
    const undo = ok(
      await h.run({ file: FILE, op: 'revert', targets: [], params: { writeId: w.writeId } })
    );
    const undone = h.files.get(FILE) as string;
    expect(undone).not.toContain("color: 'red'");
    expect(undone).toContain('>Brand studio<');
    expect(undone).toBe(SRC.replace('>Brand systems<', '>Brand studio<'));
    ok(await h.run({ file: FILE, op: 'revert', targets: [], params: { writeId: undo.writeId } }));
    expect(h.files.get(FILE)).toBe(painted.replace('>Brand systems<', '>Brand studio<'));
  });

  test('a change on the same bytes, a forgotten write and another file are refused, never overwritten', async () => {
    const h = harness();
    h.files.set('ui/Other.tsx', SRC);
    const w = ok(await h.run({ file: FILE, op: 'test.paint', targets: [ref('footer')] }));
    const painted = h.files.get(FILE) as string;
    h.files.set(FILE, painted.replace("color: 'red'", "color: 'blue'"));
    const clash = await h.run({
      file: FILE,
      op: 'revert',
      targets: [],
      params: { writeId: w.writeId },
    });
    expect(clash).toEqual({
      ok: false,
      code: 'stale',
      message: 'Someone changed this since — undo skipped.',
    });
    expect(h.files.get(FILE)).toContain("color: 'blue'");
    const gone = await h.run({
      file: FILE,
      op: 'revert',
      targets: [],
      params: { writeId: `w_${'0'.repeat(16)}` },
    });
    expect(!gone.ok && gone.code).toBe('stale');
    const foreign = await h.run({
      file: 'ui/Other.tsx',
      op: 'revert',
      targets: [],
      params: { writeId: w.writeId },
    });
    expect(!foreign.ok && foreign.code).toBe('invalid');
    const junk = await h.run({ file: FILE, op: 'revert', targets: [], params: { writeId: 'x' } });
    expect(!junk.ok && junk.code).toBe('invalid');
  });

  test('the log is capped: the oldest write is forgotten first', () => {
    const log = createWriteLog(2);
    const a = log.add(FILE, 'a', 'b');
    log.add(FILE, 'b', 'c');
    log.add(FILE, 'c', 'd');
    expect(log.get(a)).toBeNull();
    expect(log.size).toBe(2);
  });
});
