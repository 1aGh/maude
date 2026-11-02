// S2.10b — on a LOCAL op-log home an artboard copy and ⌫ Move to trash are ONE project action each:
// the source and the layout lane together (routes/edit.ts `land` → `proposeLanes`), so one ⌘Z
// (`acceptedUndo`) restores both files and redo re-applies both. The trash action is `kind: 'trash'`
// with `origin.trashed`, so the shared Trash lists the artboard. The watcher's echo of the route's own
// writes records nothing. An AI run's artboard lease refuses copy / resize / trash with 409.
//
// Real store (openLocalHome over _state/project-store.sqlite), real route (createEditRoutes); the
// oracle is the store's history and the files on disk.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { RunRegistry } from '../ai/runs.ts';
import { createEditRoutes } from '../routes/edit.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const FILE = 'ui/Home.tsx';
const META = 'ui/Home.meta.json';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={1440} height={900}>
        <p data-cd-id="intro">World</p>
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

async function setup(runs?: RunRegistry) {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-s210b-local-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  writeFileSync(path.join(designRoot, FILE), SRC);
  writeFileSync(path.join(designRoot, META), META0);
  const h = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: { id: 'm_s210b', name: 'Mac' },
    bootId: 'boot-1',
    lockRetryMs: 0,
    settleMs: 5,
    log: { warn() {}, error() {} },
  });
  homes.push(h);
  await h.ready();
  const read = (rel: string) => readFileSync(path.join(designRoot, rel), 'utf8');
  const [spec] = createEditRoutes({
    designRoot,
    designRel: '.design',
    repoRoot: root,
    emit: () => {},
    control: () => h.runtime,
    meta: {
      load: async () => JSON.parse(read(META)),
      // the legacy layout writer (api.patchCanvasMeta's shape); the op-log path never calls it
      patch: async (_f, patch) => {
        const next = { ...JSON.parse(read(META)), ...patch };
        writeFileSync(path.join(designRoot, META), `${JSON.stringify(next, null, 2)}\n`);
      },
      writeText: async (_f, next) => writeFileSync(path.join(designRoot, META), next),
    },
    now: () => new Date('2026-10-18T10:00:00.000Z'),
    ...(runs ? { runs } : {}),
  });
  const op = async (name: string, params: Record<string, unknown>) => {
    const res = await spec.handle(
      new Request('http://localhost/_api/edit-op', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: FILE, op: name, targets: [], params }),
      }),
      {}
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  /** The watcher's echo of what the route wrote. */
  const echo = async () => {
    h.observe(FILE);
    h.observe(META);
    await h.flush();
  };
  const history = () => h.runtime.acceptedHistory({});
  const ids = (rel: string) =>
    [...read(rel).matchAll(/<DCArtboard id="([^"]+)"/g)].map((m) => m[1] as string);
  const places = () =>
    (JSON.parse(read(META)).layout.artboards as { id: string; x: number }[]).map((a) => a.id);
  return { h, op, echo, history, read, ids, places };
}

describe('S2.10b — one step on a local op-log home', () => {
  test('a copy and its place are ONE edit action; ⌘Z restores both lanes, redo re-applies both', async () => {
    const s = await setup();
    const before = (await s.history()).length;
    const r = await s.op('artboard.duplicate', {
      items: [{ artboard: 'desktop', at: { x: 3000, y: 0 } }],
    });
    expect(r.status).toBe(200);
    expect(typeof r.body.actionId).toBe('string');
    // an op-log write never carries a legacy revert record
    expect(r.body.writeId).toBe('');
    expect(s.ids(FILE)).toEqual(['desktop', 'desktop-2', 'mobile']);
    expect(s.places()).toEqual(['desktop', 'mobile', 'desktop-2']);
    await s.echo();
    const rows = await s.history();
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({
      actionId: r.body.actionId,
      kind: 'edit',
      label: 'Duplicate artboard',
      canvases: [FILE],
    });

    const undo = await s.h.runtime.acceptedUndo(r.body.actionId as string);
    expect(undo.status).toBe('accepted');
    expect(s.read(FILE)).toBe(SRC);
    expect(s.places()).toEqual(['desktop', 'mobile']);

    const redo = await s.h.runtime.acceptedUndo(undo.actionId as string, true);
    expect(redo.status).toBe('accepted');
    expect(s.ids(FILE)).toEqual(['desktop', 'desktop-2', 'mobile']);
    expect(s.places()).toEqual(['desktop', 'mobile', 'desktop-2']);
  });

  test('⌫ Move to trash is ONE trash action: the Trash lists it, ⌘Z brings back the board and its place', async () => {
    const s = await setup();
    const before = (await s.history()).length;
    const r = await s.op('artboard.trash', { artboards: ['mobile'] });
    expect(r.status).toBe(200);
    expect(s.ids(FILE)).toEqual(['desktop']);
    expect(s.places()).toEqual(['desktop']);
    await s.echo();
    const rows = await s.history();
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({
      actionId: r.body.actionId,
      kind: 'trash',
      label: 'Moved “Příběh” to the trash',
    });

    const listing = await s.h.runtime.acceptedTrash();
    expect(listing?.artboards).toHaveLength(1);
    expect(listing?.artboards[0]).toMatchObject({
      artboard: 'mobile',
      label: 'Příběh',
      actionId: r.body.actionId,
    });
    expect(listing?.artboards[0]?.id).toBe(`artboard:${r.body.actionId}/mobile`);

    const undo = await s.h.runtime.acceptedUndo(r.body.actionId as string);
    expect(undo.status).toBe('accepted');
    expect(s.read(FILE)).toBe(SRC);
    expect(JSON.parse(s.read(META)).layout.artboards).toEqual([
      { id: 'desktop', x: 0, y: 0 },
      { id: 'mobile', x: 1520, y: 0 },
    ]);
  });

  test('the last artboard stays: the canvas keeps at least one', async () => {
    const s = await setup();
    const r = await s.op('artboard.trash', { artboards: ['desktop', 'mobile'] });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('A canvas keeps at least one artboard.');
    expect(s.read(FILE)).toBe(SRC);
  });

  test("an AI run's artboard lease refuses copy, resize and trash with 409 held-by-ai", async () => {
    const runs = {
      canvasKey: (rel: string) => `path:.design/${rel}`,
      holderOf: (k: { canvas: string; artboard: string }) =>
        k.canvas === `path:.design/${FILE}` && k.artboard === 'mobile' ? { runId: 'run_1' } : null,
      live: () => [{ runId: 'run_1' }],
      view: () => ({ others: [] }),
    } as unknown as RunRegistry;
    const s = await setup(runs);
    for (const [name, params] of [
      ['artboard.duplicate', { items: [{ artboard: 'mobile' }] }],
      ['artboard.resize', { artboard: 'mobile', width: 500 }],
      ['artboard.trash', { artboards: ['mobile'] }],
    ] as const) {
      const r = await s.op(name, params);
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({
        ok: false,
        code: 'held-by-ai',
        message: "mobile is AI's until it's done · Stop in the AI chat",
      });
    }
    expect(s.read(FILE)).toBe(SRC);
    // a board no run holds is free
    expect((await s.op('artboard.trash', { artboards: ['desktop'] })).status).toBe(200);
  });
});
