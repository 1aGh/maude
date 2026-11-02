// S2.10c — a trashed artboard takes its own annotations with it (S1-trash.md §2): the stickies on
// it, the arrow bound only to them and a section inside it leave in the SAME `kind: 'trash'` action
// (the annotations lane joins the proposal), so one ⌘Z brings them back with the board, and the
// Trash's Restore (S1.13's splice from the revision before) brings them back too. Another artboard's
// annotations stay byte-identical throughout.
//
// The membership rule is unit-tested here; the action is tested on a real local home (openLocalHome
// over its store, the real edit route and Trash routes). The real hub, both directions, is in
// test/v2-artboard-one-step-hub.test.ts.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type AccessClaim, resolveAccess } from '../access/scope.ts';
import { AGENT_PATHS } from '../actions/agents.ts';
import { canvasKeyIndex } from '../actions/canvas-keys.ts';
import { canvasKeyCtx } from '../actions/ctx.ts';
import { CANVAS_KEYMAP } from '../actions/keymap.gen.ts';
import { resolveChord } from '../actions/resolve.ts';
import { artboardMembers } from '../annotations/artboard-members.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { EDITING_ACTIONS } from '../editing/index.tsx';
import { restoreArtboard } from '../history/restore-artboard.ts';
import { trashArtboardRestorer } from '../history/restore-artboard-action.ts';
import { createEditRoutes } from '../routes/edit.ts';
import type { RouteSpec } from '../routes/table.ts';
import { createTrashRoutes } from '../routes/trash.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

// biome-ignore lint/suspicious/noExplicitAny: a test reads arbitrary answer JSON
type Body = Record<string, any>;

const sticky = (id: string, index: string, x: number, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'sticky',
    index,
    x,
    y: 40,
    w: 160,
    h: 160,
    text: id,
    ...extra,
  }) as AnnotationElement;

/** A board as a board writes it (canonical key order, one element per line). */
const canonical = (els: AnnotationElement[]) =>
  serializeBoard(parseBoard(serializeBoard(els)).elements);

/** Two stickies on Mobile + the arrow between them; Desktop's own sticky + its arrow to Mobile. */
const BOARD_ELEMENTS: AnnotationElement[] = [
  sticky('m-one', 'a0', 1560, { parentArtboard: 'mobile' }),
  sticky('m-two', 'a1', 1760, { parentArtboard: 'mobile' }),
  { id: 'm-arrow', type: 'arrow', index: 'a2', start: { el: 'm-one' }, end: { el: 'm-two' } },
  sticky('d-one', 'a3', 40, { parentArtboard: 'desktop' }),
  {
    id: 'd-arrow',
    type: 'arrow',
    index: 'a4',
    parentArtboard: 'desktop',
    start: { el: 'd-one' },
    end: { x: 900, y: 120 },
  },
];

describe('artboardMembers — what belongs to an artboard as a whole', () => {
  const els: AnnotationElement[] = [
    ...BOARD_ELEMENTS,
    {
      id: 'sec',
      type: 'section',
      index: 'a5',
      x: 1500,
      y: 400,
      w: 600,
      h: 300,
      parentArtboard: 'mobile',
    },
    { ...sticky('in-sec', 'a6', 20), parent: 'sec' },
    // an arrow with no parent, bound to Mobile on the canvas and free at the other end
    {
      id: 'host-arrow',
      type: 'arrow',
      index: 'a7',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      startHost: { ref: 'ab:mobile' },
    },
    // bound to a Mobile sticky AND a Desktop one: it reaches another artboard, so it stays
    { id: 'cross', type: 'arrow', index: 'a8', start: { el: 'm-one' }, end: { el: 'd-one' } },
    // Desktop's own arrow pointing at Mobile: Desktop's, wherever its ends are
    {
      id: 'd-to-m',
      type: 'arrow',
      index: 'a9',
      parentArtboard: 'desktop',
      start: { el: 'd-one' },
      end: { el: 'm-two' },
    },
    sticky('loose', 'b0', 3000),
  ];

  test('stickies, the arrow between them, a section with its contents, an arrow bound to the board', () => {
    expect([...artboardMembers(els, ['mobile'])].sort()).toEqual(
      ['host-arrow', 'in-sec', 'm-arrow', 'm-one', 'm-two', 'sec'].sort()
    );
  });

  test('another artboard keeps its own; loose notes and cross-board arrows belong to none', () => {
    expect([...artboardMembers(els, ['desktop'])].sort()).toEqual(['d-arrow', 'd-one', 'd-to-m']);
    expect(artboardMembers(els, ['ghost']).size).toBe(0);
    expect(artboardMembers(els, []).size).toBe(0);
  });
});

describe('the splice brings the members back (S1.13 "Restore only" / the Trash)', () => {
  const html = (boards: string[]) =>
    `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';\nexport default function B() {\n  return (\n    <DesignCanvas>\n${boards
      .map(
        (b) =>
          `      <DCArtboard id="${b}" label="${b}" width={100} height={100}>\n        <p>${b}</p>\n      </DCArtboard>\n`
      )
      .join('')}    </DesignCanvas>\n  );\n}\n`;
  test('the arrow bound only to Mobile’s stickies and a section’s contents come back too; Desktop’s stay', () => {
    const sec = {
      id: 'sec',
      type: 'section',
      index: 'a5',
      x: 1500,
      y: 400,
      w: 600,
      h: 300,
      parentArtboard: 'mobile',
    } as AnnotationElement;
    const inSec = { ...sticky('in-sec', 'a6', 20), parent: 'sec' } as AnnotationElement;
    const old = canonical([...BOARD_ELEMENTS, sec, inSec]);
    const now = canonical(BOARD_ELEMENTS.filter((e) => e.id.startsWith('d-')));
    const r = restoreArtboard(
      'ui/b.tsx',
      { html: html(['desktop']), annotations: now },
      { html: html(['desktop', 'mobile']), annotations: old },
      'mobile'
    );
    expect(r.ok).toBe(true);
    const board = r.ok ? (r.lanes.annotations ?? null) : null;
    expect(boardIds(board).sort()).toEqual(
      ['d-arrow', 'd-one', 'in-sec', 'm-arrow', 'm-one', 'm-two', 'sec'].sort()
    );
    for (const id of ['d-one', 'd-arrow', 'm-arrow'])
      expect(lineOf(board, id)).toBe(lineOf(old, id));
  });
});

describe('registry: artboard.trash owns ⌫ on an artboard selection', () => {
  const index = canvasKeyIndex(CANVAS_KEYMAP.map((a) => a.id));
  const on = (chord: string, selection: 'artboard' | 'object') =>
    resolveChord(index, chord, canvasKeyCtx({ typing: false, readOnly: false, selection }))?.action
      .id ?? null;

  test('⌫ / ⌦ (and ⇧) on an artboard run artboard.trash; on an element still object.remove', () => {
    for (const chord of ['⌫', '⇧⌫', '⌦', '⇧⌦']) {
      expect(on(chord, 'artboard')).toBe('artboard.trash');
      expect(on(chord, 'object')).toBe('object.remove');
    }
  });

  test('it has an agent path, and the canvas runs it from ⌘K (run-action)', () => {
    expect(AGENT_PATHS['artboard.trash']).toMatchObject({
      effect: 'project',
      agent: { path: 'file', format: 'canvas-tsx' },
    });
    expect((EDITING_ACTIONS as readonly string[]).includes('artboard.trash')).toBe(true);
  });
});

// ── a local home ────────────────────────────────────────────────────────────────────────────

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const FILE = 'ui/Home.tsx';
const META = 'ui/Home.meta.json';
const BOARD = 'ui-home.annotations.json';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={1440} height={900}>
        <p>World</p>
      </DCArtboard>
      <DCArtboard id="mobile" label="Příběh" width={390} height={844}>
        <p>Hi</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const META0 = `${JSON.stringify(
  {
    title: 'Home',
    layout: {
      artboards: [
        { id: 'desktop', x: 0, y: 0 },
        { id: 'mobile', x: 1520, y: 0 },
      ],
    },
  },
  null,
  2
)}\n`;
const BOARD0 = canonical(BOARD_ELEMENTS);
const MEMBER = resolveAccess({ v: 1, role: 'member' } as AccessClaim);

/** One element's line in a board, as the board writes it (one element per line, DDR-242). */
const lineOf = (board: string | null, id: string) =>
  (board ?? '').split('\n').find((l) => l.includes(`"id":"${id}"`)) ?? null;
const boardIds = (board: string | null) =>
  board ? parseBoard(board).elements.map((e) => e.id) : [];

async function setup(o: { board?: boolean } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-s210c-local-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  writeFileSync(path.join(designRoot, FILE), SRC);
  writeFileSync(path.join(designRoot, META), META0);
  if (o.board !== false) writeFileSync(path.join(designRoot, BOARD), BOARD0);
  const h = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: { id: 'm_s210c', name: 'Mac' },
    bootId: 'boot-1',
    lockRetryMs: 0,
    settleMs: 5,
    log: { warn() {}, error() {} },
  });
  homes.push(h);
  await h.ready();
  const read = (rel: string) => {
    try {
      return readFileSync(path.join(designRoot, rel), 'utf8');
    } catch {
      return null;
    }
  };
  const [spec] = createEditRoutes({
    designRoot,
    designRel: '.design',
    repoRoot: root,
    emit: () => {},
    control: () => h.runtime,
    meta: {
      load: async () => JSON.parse(read(META) ?? '{}'),
      patch: async () => {},
      writeText: async (_f, next) => writeFileSync(path.join(designRoot, META), next),
    },
    now: () => new Date('2026-10-18T10:00:00.000Z'),
  }) as [RouteSpec];
  const op = async (name: string, params: Record<string, unknown>) => {
    const res = await spec.handle(
      new Request('http://localhost/_api/edit-op', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: FILE, op: name, targets: [], params }),
      }),
      {}
    );
    return { status: res.status, body: (await res.json()) as Body };
  };
  const trash = createTrashRoutes({
    control: () => h.runtime as object,
    access: () => MEMBER,
    readSource: (rel) => read(rel),
    restoreArtboard: trashArtboardRestorer({
      control: () => h.runtime as object,
      designRel: '.design',
    }),
  });
  const call = async (method: string, p: string, body?: unknown) => {
    const spec = trash.find((s) => s.method === method && s.path === p) as RouteSpec;
    const res = await spec.handle(
      new Request(`http://localhost${p}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      {}
    );
    return { status: res.status, body: (await res.json()) as Body };
  };
  /** The watcher's echo of what the route wrote. */
  const echo = async () => {
    for (const rel of [FILE, META, BOARD]) h.observe(rel);
    await h.flush();
  };
  // The board reaches a local store only through an explicit action (WATCHED_LANES): record it the
  // way its stickies were added, so the trash's base is the board's head.
  await echo();
  if (o.board !== false) {
    const seeded = await h.runtime.proposeLanes(
      'ui-home',
      [{ lane: 'annotations', text: BOARD0, baseText: '' }],
      { kind: 'edit', label: 'Added stickies' }
    );
    expect(seeded).toMatchObject({ status: 'accepted' });
  }
  return {
    h,
    op,
    echo,
    read,
    history: () => h.runtime.acceptedHistory({}),
    list: async () => ((await call('GET', '/_api/trash')).body.items ?? []) as Body[],
    restore: (id: string) => call('POST', '/_api/trash/restore', { id }),
  };
}

describe('S2.10c — ⌫ Move to trash takes the artboard’s annotations (local home)', () => {
  test('ONE trash action carries the board; ⌘Z brings all three back; Desktop’s lines never move', async () => {
    const s = await setup();
    const before = (await s.history()).length;
    const r = await s.op('artboard.trash', { artboards: ['mobile'] });
    expect(r.status).toBe(200);
    expect(typeof r.body.actionId).toBe('string');
    const board = s.read(BOARD);
    expect(boardIds(board)).toEqual(['d-one', 'd-arrow']);
    for (const id of ['d-one', 'd-arrow']) expect(lineOf(board, id)).toBe(lineOf(BOARD0, id));
    await s.echo();
    const rows = await s.history();
    expect(rows.slice(0, rows.length - before).map((a) => [a.kind, a.label])).toEqual([
      ['trash', 'Moved “Příběh” to the trash'],
    ]);
    expect(rows[0]).toMatchObject({
      actionId: r.body.actionId,
      kind: 'trash',
      label: 'Moved “Příběh” to the trash',
    });

    const undo = await s.h.runtime.acceptedUndo(r.body.actionId as string);
    expect(undo.status).toBe('accepted');
    expect(s.read(FILE)).toBe(SRC);
    expect(s.read(BOARD)).toBe(BOARD0);
  });

  test('the Trash’s Restore brings the artboard back WITH its annotations; Desktop’s stay as they are now', async () => {
    const s = await setup();
    const r = await s.op('artboard.trash', { artboards: ['mobile'] });
    expect(r.status).toBe(200);
    expect(boardIds(s.read(BOARD))).toEqual(['d-one', 'd-arrow']);
    await s.echo();
    const item = (await s.list()).find((i) => i.kind === 'artboard' && i.artboard === 'mobile');
    expect(item?.id).toBe(`artboard:${r.body.actionId}/mobile`);

    const back = await s.restore(item?.id as string);
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ ok: true, path: FILE });
    await s.h.flush();
    expect(s.read(FILE)).toBe(SRC);
    const board = s.read(BOARD);
    expect(boardIds(board).sort()).toEqual(['d-arrow', 'd-one', 'm-arrow', 'm-one', 'm-two']);
    for (const id of ['m-one', 'm-two', 'm-arrow', 'd-one', 'd-arrow'])
      expect(lineOf(board, id)).toBe(lineOf(BOARD0, id));
  });

  test('a canvas with no annotations trashes as before: no board is written', async () => {
    const s = await setup({ board: false });
    const r = await s.op('artboard.trash', { artboards: ['mobile'] });
    expect(r.status).toBe(200);
    expect(s.read(BOARD)).toBeNull();
    await s.echo();
    expect((await s.history())[0]).toMatchObject({ actionId: r.body.actionId, kind: 'trash' });
  });
});
