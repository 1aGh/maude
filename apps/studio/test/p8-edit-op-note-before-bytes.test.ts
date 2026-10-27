// S2.20b — a ⌘Z the instant after an edit-op undoes THAT edit, never the one before it (p8-e2e-fix-r9).
//
// The edit-op route used to say its write (`source-written`, the local home's note) only after the
// /design:rollback snapshot — a second disk write AFTER the canvas bytes landed. In that gap the file
// watcher can deliver the new bytes and a ⌘Z's `GET undo-stack` can settle the log: with no note yet the
// home records the person's edit as an `outside` change the undo stack leaves out, and ⌘Z takes back the
// edit BEFORE it (desktop e2e edit-undo / photo-per-use, red under load). The route now notes the bytes
// before they land (`source-writing`); the hub path keeps its after-the-write `source-written`.
//
// A real in-process local home (bun:sqlite, temp project) behind the real edit-op route, wired by the
// same bus server.ts uses (`attachLocalHome`). The snapshot hook stands in for the gap.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { applyEdit } from '../canvas-edit.ts';
import type { EditOp } from '../edit-ops/types.ts';
import { createEditRoutes } from '../routes/edit.ts';
import { attachLocalHome, type LocalHome, OUTSIDE_KIND } from '../sync/local-kernel.ts';

const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <footer data-cd-id="footer">Footer</footer>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const paint = (color: string): EditOp => ({
  id: `test.paint-${color}`,
  apply: (src, r) => ({
    source: r.targets.reduce(
      (s, t) => applyEdit(r.file, s, t.element, 'style.color', `'${color}'`).source,
      src
    ),
  }),
});
const REL = 'ui/Home.tsx';
const REPO_REL = `.design/${REL}`;

const dirs: string[] = [];
const closers: Array<() => void> = [];
afterAll(() => {
  for (const c of closers) c();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function rig() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-note-before-bytes-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  writeFileSync(path.join(designRoot, REL), SRC);
  process.env.MAUDE_MACHINE_FILE = path.join(root, 'machine.json');
  const subs = new Map<string, Array<(x: unknown) => void>>();
  const bus = {
    on(ev: string, fn: (x: unknown) => void) {
      subs.set(ev, [...(subs.get(ev) ?? []), fn]);
      return () => {};
    },
    emit(ev: string, x?: unknown) {
      for (const fn of subs.get(ev) ?? []) fn(x);
    },
  };
  const att = attachLocalHome(
    { cfg: { canvasGroups: [{ path: 'ui' }] }, paths: { designRoot, designRel: '.design' }, bus },
    { current: () => null },
    {}
  );
  closers.push(() => att.close());
  const home = att.home() as LocalHome;
  /** What the snapshot hook does: nothing, or the gap (the watcher delivers, a ⌘Z reads the stack). */
  let inGap: (() => Promise<void>) | null = null;
  const [spec] = createEditRoutes({
    designRoot,
    designRel: '.design',
    repoRoot: root,
    emit: (e, p) => bus.emit(e, p),
    snapshot: async () => {
      if (inGap) await inGap();
    },
    ops: [paint('red'), paint('blue')],
  });
  const editOp = async (op: string) => {
    const r = await spec.handle(
      new Request('http://localhost/_api/edit-op', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          file: REPO_REL,
          op,
          targets: [{ artboard: 'desktop', element: 'footer' }],
        }),
      }),
      {}
    );
    expect(r.status).toBe(200);
  };
  const read = () => readFileSync(path.join(designRoot, REL), 'utf8');
  return {
    abs: path.join(designRoot, REL),
    home,
    bus,
    editOp,
    read,
    gap: (fn: (() => Promise<void>) | null) => {
      inGap = fn;
    },
  };
}

describe('S2.20b — the edit-op notes its bytes before they land', () => {
  test('the watcher and a ⌘Z landing between the bytes and the snapshot still see the person’s edit', async () => {
    const r = rig();
    await r.home.ready();
    // edit A: an ordinary edit, delivered and recorded
    await r.editOp('test.paint-red');
    r.bus.emit('fs:any', REL);
    await r.home.flush();
    const afterA = r.read();
    expect(afterA).toContain("color: 'red'");

    // edit B: its bytes are on disk; before the route says so, the watcher delivers them and a ⌘Z's
    // undo-stack read settles the log (both land in the snapshot's await)
    let seenInGap: string[] = [];
    r.gap(async () => {
      r.bus.emit('fs:any', REL);
      const rows = await r.home.runtime.acceptedHistory({ path: REPO_REL, limit: 10 });
      seenInGap = rows.map((x) => x.kind);
    });
    await r.editOp('test.paint-blue');
    r.gap(null);
    await r.home.flush();
    expect(r.read()).toContain("color: 'blue'");
    expect(seenInGap).not.toContain(OUTSIDE_KIND);

    const rows = await r.home.runtime.acceptedHistory({ path: REPO_REL, limit: 10, mine: true });
    const [top] = rows;
    expect(top.kind).toBe('edit');
    // ⌘Z takes back B, never A
    const u = await r.home.runtime.acceptedUndo(top.actionId, false, { via: 'keys' });
    expect(u.status).toBe('accepted');
    expect(r.read()).toBe(afterA);
  });

  test('said twice (before and after the bytes) is one note: a later outside write of the same bytes stays outside', async () => {
    const r = rig();
    await r.home.ready();
    // the studio's edit: noted early, delivered and recorded in the snapshot's await, then said again
    r.gap(async () => {
      r.bus.emit('fs:any', REL);
      await r.home.flush();
    });
    await r.editOp('test.paint-red');
    r.gap(null);
    const a = r.read();
    // an outside editor writes something else, then exactly the edit's bytes again
    writeFileSync(r.abs, SRC);
    r.bus.emit('fs:any', REL);
    await r.home.flush();
    writeFileSync(r.abs, a);
    r.bus.emit('fs:any', REL);
    await r.home.flush();
    const rows = await r.home.runtime.acceptedHistory({ path: REPO_REL, limit: 10 });
    expect(rows.slice(0, 3).map((x) => x.kind)).toEqual([OUTSIDE_KIND, OUTSIDE_KIND, 'edit']);
  });
});
