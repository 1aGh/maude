// S2.20b — the studio's own layout and annotation writes on a LOCAL project are the person's `edit`
// actions, not `outside` (V2-1.5 U20, the hub link's `LANE_LABEL`), and a ⌘Z made the instant after
// an edit sees that edit (the 1 ms race: the write landed, the watcher has not delivered it yet).
//
// A real in-process kernel over `bun:sqlite` in a temp project. The studio's writes go through the
// same hooks server.ts calls (`runtime.proposeLane` after a meta / annotations write, api.ts
// `source-written` → `noteWritten` after a source write); the watcher is `observe` + `flush`.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { serializeBoard } from '../annotations/schema.ts';
import {
  attachLocalHome,
  type LocalHome,
  OUTSIDE_KIND,
  openLocalHome,
} from '../sync/local-kernel.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const quiet = { warn() {}, error() {} };
const M1 = { id: 'm_mac_one', name: 'Mac one' };
const REL = 'ui/k.tsx';
const REPO_REL = `.design/${REL}`;
const SLUG = 'ui-k';
/** The board sits at the design root under the canvas slug (api.ts `annotationsPath`). */
const BOARD_REL = `${SLUG}.annotations.json`;
const META_REL = 'ui/k.meta.json';

const canvas = (title = 'P title') => `import { DCArtboard } from '@maude/canvas-lib';

export default function K() {
  return (
    <DCArtboard id="p" width={100} height={100}>
      <h1>${title}</h1>
    </DCArtboard>
  );
}
`;
const meta = (x: number) =>
  `${JSON.stringify({ layout: { artboards: [{ id: 'p', x, y: 0 }] } }, null, 2)}\n`;
const sticky = (id: string, index: string) => ({
  id,
  type: 'sticky',
  index,
  x: 0,
  y: 0,
  w: 200,
  h: 120,
  text: id,
});
const board = (...ids: string[]) =>
  serializeBoard(ids.map((id, i) => sticky(id, `a${i}`)) as never);

function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-local-lanes-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  const file = (rel: string) => path.join(designRoot, rel);
  writeFileSync(file(REL), canvas());
  writeFileSync(file(META_REL), meta(0));
  writeFileSync(file(BOARD_REL), board('s1'));
  return {
    designRoot,
    read: (rel: string) => (existsSync(file(rel)) ? readFileSync(file(rel), 'utf8') : null),
    write: (rel: string, text: string) => writeFileSync(file(rel), text),
  };
}

function open(designRoot: string) {
  const h = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: M1,
    bootId: 'boot-1',
    lockRetryMs: 0,
    settleMs: 5,
    aiSettleMs: 0,
    log: quiet,
  });
  homes.push(h);
  return h;
}

type P = ReturnType<typeof project>;
/** server.ts `onMetaChanged` / `onAnnotationsChanged` — the studio's lane write, after it landed. */
function studioLane(
  h: LocalHome,
  p: P,
  lane: 'meta' | 'annotations',
  rel: string,
  text: string,
  withBase = true
) {
  const base = p.read(rel); // api.ts hands the board it replaced to onAnnotationsChanged
  p.write(rel, text);
  const proposed = h.runtime.proposeLane?.(
    SLUG,
    lane,
    text,
    withBase && base !== null ? { baseText: base } : undefined
  );
  // A local home never takes the write over: the room bridge keeps working (server.ts falls through).
  expect(proposed ?? null).toBeNull();
}
const mineRows = (h: LocalHome) =>
  h.runtime.acceptedHistory({ path: REPO_REL, limit: 50, mine: true });

describe('U20 — studio layout and annotation writes are the person’s edits on a local project', () => {
  test('a layout move (meta) is an `edit` "Edit layout", and ⌘Z puts the artboard back', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    studioLane(h, p, 'meta', META_REL, meta(240));
    h.observe(META_REL);
    await h.flush();
    const [row] = await mineRows(h);
    expect([row.kind, row.label]).toEqual(['edit', 'Edit layout']);
    expect(row.canvases).toEqual([REL]);

    const u = await h.runtime.acceptedUndo(row.actionId, false, { via: 'keys' });
    expect(u.status).toBe('accepted');
    expect(JSON.parse(p.read(META_REL) as string).layout.artboards[0].x).toBe(0);
  });

  test('an annotation stroke is an `edit` "Edit annotations", and ⌘Z takes the stroke back', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    // The board is an explicit lane (S4.7, A6a): no file event reaches it — the stroke is proposed.
    studioLane(h, p, 'annotations', BOARD_REL, board('s1', 's2'));
    await h.flush();
    const [row] = await mineRows(h);
    expect([row.kind, row.label]).toEqual(['edit', 'Edit annotations']);
    expect(row.canvases).toEqual([REL]);

    const u = await h.runtime.acceptedUndo(row.actionId, false, { via: 'keys' });
    expect(u.status).toBe('accepted');
    expect(p.read(BOARD_REL)).toBe(board('s1'));
  });

  test('a stroke of unknown base on a never-recorded board is recorded, never wiped by ⌘Z', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    studioLane(h, p, 'annotations', BOARD_REL, board('s1', 's2'), false);
    await h.flush();
    const rows = (await mineRows(h)).filter((r) => r.kind === 'edit');
    expect(rows).toEqual([]); // the board is on the record now (`outside`), not undoable
    studioLane(h, p, 'annotations', BOARD_REL, board('s1', 's2', 's3'), false);
    const [top] = await mineRows(h);
    const u = await h.runtime.acceptedUndo(top.actionId, false, { via: 'keys' });
    expect(u.status).toBe('accepted');
    expect(p.read(BOARD_REL)).toBe(board('s1', 's2'));
  });

  test('a ⌘Z the instant after a stroke sees that stroke (history waits for the proposal)', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    studioLane(h, p, 'annotations', BOARD_REL, board('s1', 's2'));
    const [top] = await mineRows(h); // no flush
    expect([top.kind, top.label]).toEqual(['edit', 'Edit annotations']);
  });

  test('two strokes are two edits; the same board repeated (PUT + room projection) is one', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    studioLane(h, p, 'annotations', BOARD_REL, board('s1', 's2'));
    studioLane(h, p, 'annotations', BOARD_REL, board('s1', 's2')); // the room repeats the PUT
    studioLane(h, p, 'annotations', BOARD_REL, board('s1', 's2', 's3'));
    await h.flush();
    const rows = (await mineRows(h)).filter((r) => r.label === 'Edit annotations');
    expect(rows.map((r) => r.kind)).toEqual(['edit', 'edit']);

    const u = await h.runtime.acceptedUndo(rows[0].actionId, false, { via: 'keys' });
    expect(u.status).toBe('accepted');
    expect(p.read(BOARD_REL)).toBe(board('s1', 's2')); // only the last stroke went
  });

  test('a board written by something else is NOT recorded by the watcher (A6a explicit lane)', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    p.write(BOARD_REL, board('s1', 's9'));
    h.observe(BOARD_REL);
    await h.flush();
    const rows = await h.runtime.acceptedHistory({ path: REPO_REL, limit: 50 });
    expect(rows.map((r) => r.kind)).not.toContain(OUTSIDE_KIND);
    expect(rows.map((r) => r.kind)).not.toContain('edit');
  });
});

describe('U20 — a collab room projecting its board (the live-room stroke path)', () => {
  test('`annotations-projected` on the bus makes the flushed board the person’s edit', async () => {
    const p = project();
    process.env.MAUDE_MACHINE_FILE = path.join(p.designRoot, '..', 'machine.json');
    const subs = new Map<string, Array<(x: unknown) => void>>();
    const bus = {
      on(ev: string, fn: (x: unknown) => void) {
        subs.set(ev, [...(subs.get(ev) ?? []), fn]);
      },
      emit(ev: string, x: unknown) {
        for (const fn of subs.get(ev) ?? []) fn(x);
      },
    };
    const att = attachLocalHome(
      {
        cfg: { canvasGroups: [{ path: 'ui' }] },
        paths: { designRoot: p.designRoot, designRel: '.design' },
        bus,
      },
      { current: () => null },
      {}
    );
    const h = att.home() as LocalHome;
    await h.ready();
    const next = board('s1', 's3');
    bus.emit('annotations-projected', { slug: SLUG, board: next }); // collab/index.ts, before the write
    p.write(BOARD_REL, next);
    bus.emit('fs:any', BOARD_REL);
    await h.flush();
    const [row] = await mineRows(h);
    expect([row.kind, row.label]).toEqual(['edit', 'Edit annotations']);
    att.close();
  });
});

describe('the 1 ms race — a ⌘Z right after an edit sees that edit', () => {
  test('a noted source write the watcher has not delivered yet is in the log before history answers', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    // edit A: written, noted, delivered
    p.write(REL, canvas('A'));
    h.noteWritten(REL, canvas('A'));
    h.observe(REL);
    await h.flush();
    // edit B: written and noted — the fs event is still in flight (no observe yet)
    p.write(REL, canvas('B'));
    h.noteWritten(REL, canvas('B'));
    const [top] = await mineRows(h);
    expect([top.kind, top.label]).toEqual(['edit', 'Edit canvas']);
    // ⌘Z takes back B, never A
    const u = await h.runtime.acceptedUndo(top.actionId, false, { via: 'keys' });
    expect(u.status).toBe('accepted');
    expect(p.read(REL)).toBe(canvas('A'));
  });

  test('S2.24 G3: a source write that says what it was is that row, not "Edit canvas"', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    p.write(REL, canvas('A'));
    h.noteWritten(REL, canvas('A'), 'Headline text');
    h.observe(REL);
    await h.flush();
    const [top] = await mineRows(h);
    expect([top.kind, top.label]).toEqual(['edit', 'Headline text']);
  });

  test('a noted layout write is waited on too', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    studioLane(h, p, 'meta', META_REL, meta(120));
    const [top] = await mineRows(h);
    expect([top.kind, top.label]).toEqual(['edit', 'Edit layout']);
  });
});
