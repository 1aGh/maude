// S5.19 G2 (03 `ai-copy`) — Undo of a run-on-a-copy removes the copy AND its sidecar entries, and the copy lands
// BESIDE the original. Red first (S5.V3 verdicts G2): settleCopyMeta wrote the sidecar through the studio's
// layout door (a noted write, proposed at once as the person's own edit), so the run's action held only the
// .tsx and Undo left `sections[].artboards` / `layout.artboards` entries of a copy that no longer existed; and
// with a neighbour on the right the copy went BELOW the original.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { artboardRects, metaWithCopy, placeBeside } from '../ai/copy-meta.ts';
import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry } from '../ai/runs.ts';
import { claimHashOf } from '../ai/write-claim.ts';
import { createAiRoutes } from '../routes/ai.ts';
import { matchRoute } from '../routes/table.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const ACCEPTED = `import { DCArtboard } from '@maude/canvas-lib';

export default function C() {
  return (
    <div>
      <DCArtboard id="P" label="Post 1:1" width={260} height={260}><b>p</b></DCArtboard>
      <DCArtboard id="S" label="Story" width={260} height={460}><b>s</b></DCArtboard>
    </div>
  );
}
`;
const WITH_COPY = ACCEPTED.replace(
  '<DCArtboard id="S"',
  '<DCArtboard id="P-copy-abc123" label="Post 1:1 · copy" width={260} height={260}><b>p</b></DCArtboard>\n      <DCArtboard id="S"'
);
const META = {
  sections: [
    {
      id: 's',
      artboards: [
        { id: 'P', label: 'Post 1:1' },
        { id: 'S', label: 'Story' },
      ],
    },
  ],
  layout: {
    artboards: [
      { id: 'P', x: 0, y: 0 },
      { id: 'S', x: 340, y: 0 },
    ],
  },
};

describe('placeBeside — beside the original even when a neighbour is on the right', () => {
  const rects = [
    { id: 'P', x: 0, y: 0, w: 260, h: 260 },
    { id: 'c', x: 9999, y: 9999, w: 260, h: 260 },
    { id: 'S', x: 340, y: 0, w: 260, h: 460 },
    { id: 'T', x: 680, y: 0, w: 260, h: 260 },
    { id: 'U', x: 0, y: 500, w: 260, h: 260 }, // another row: not moved
  ];
  test('a blocked right slot shifts the row’s right-hand neighbours instead of going below', () => {
    const r = placeBeside(rects, 'c', 'P');
    expect(r?.at).toEqual({ x: 340, y: 0 });
    expect(r?.shifts).toEqual([
      { id: 'S', x: 680, y: 0 },
      { id: 'T', x: 1020, y: 0 },
    ]);
  });
  test('a clear right slot shifts nothing', () => {
    const r = placeBeside(
      rects.filter((x) => x.id !== 'S' && x.id !== 'T'),
      'c',
      'P'
    );
    expect(r).toEqual({ at: { x: 340, y: 0 }, shifts: [] });
  });
  test('metaWithCopy writes the copy beside P and the shifted positions; nobody overlaps', () => {
    const next = metaWithCopy(META, {
      source: WITH_COPY,
      artboardId: 'P',
      copyId: 'P-copy-abc123',
      label: 'Post 1:1 · copy',
    });
    if (!next) throw new Error('no sidecar change');
    const placed = (next.layout as { artboards: Array<{ id: string; x: number; y: number }> })
      .artboards;
    expect(placed.find((e) => e.id === 'P-copy-abc123')).toMatchObject({ x: 340, y: 0 });
    expect(placed.find((e) => e.id === 'S')).toMatchObject({ x: 680, y: 0 });
    const rs = artboardRects(WITH_COPY, placed);
    for (const a of rs)
      for (const b of rs)
        if (a.id < b.id)
          expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(
            true
          );
  });
});

describe('the sidecar write belongs to the run’s action', () => {
  test('route: with a sync runtime the sidecar is written WITHOUT the studio-edit hook (the watcher stages it)', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 's519-copy-'));
    dirs.push(root);
    mkdirSync(path.join(root, '.design', 'ui'), { recursive: true });
    writeFileSync(path.join(root, '.design', 'ui', 'C.tsx'), ACCEPTED);
    writeFileSync(path.join(root, '.design', 'ui', 'C.meta.json'), `${JSON.stringify(META)}\n`);
    const reg = createRunRegistry({
      designRoot: null,
      home: createLocalLeaseHome({ actor: 'you' }),
      autoRenew: false,
      turns: { send: () => undefined },
    });
    const calls: Array<{ hooks?: boolean }> = [];
    const specs = createAiRoutes({
      registry: reg,
      repoRoot: root,
      designRel: '.design',
      control: () => ({ beginAiAction() {}, claimAiWrite() {} }),
      meta: {
        write: async (_f, _t, _b, o) => {
          calls.push(o ?? {});
          return true;
        },
      },
    });
    const ask = (chatId: string) =>
      reg.ask({
        chatId,
        origin: 'maude-chat',
        label: chatId,
        prompt: chatId,
        scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
      });
    const busy = await ask('c1');
    await reg.started(busy.runId);
    const w = await ask('c2');
    const url = `/_api/ai/runs/${w.runId}/copy`;
    const m = matchRoute(specs, 'POST', url);
    if (!m) throw new Error('no route');
    const res = await m.spec.handle(
      new Request(`http://localhost${url}`, { method: 'POST' }),
      m.params
    );
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ hooks: false }]);
  });

  test('kernel: a watcher-staged sidecar write is part of the run, so ONE Undo removes the copy and its entries', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 's519-kernel-'));
    dirs.push(root);
    const designRoot = path.join(root, '.design');
    mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
    const tsx = path.join(designRoot, 'ui', 'C.tsx');
    const meta = path.join(designRoot, 'ui', 'C.meta.json');
    writeFileSync(tsx, ACCEPTED);
    writeFileSync(meta, `${JSON.stringify(META, null, 2)}\n`);
    const h = openLocalHome({
      designRoot,
      designRel: '.design',
      canvasGroups: () => [{ path: 'ui' }],
      machine: { id: 'm_mac_one', name: 'Mac one' },
      bootId: 'boot-1',
      lockRetryMs: 0,
      settleMs: 5,
      aiSettleMs: 0,
      log: { warn() {}, error() {} },
    });
    homes.push(h);
    await h.ready();
    h.runtime.beginAiAction('r_copy', 'Make it greener', { runId: 'r_copy', chatId: 'c2' });
    writeFileSync(tsx, WITH_COPY);
    h.runtime.claimAiWrite('r_copy', '.design/ui/C.tsx', hashBytes(WITH_COPY));
    const next = metaWithCopy(META, {
      source: WITH_COPY,
      artboardId: 'P',
      copyId: 'P-copy-abc123',
      label: 'Post 1:1 · copy',
    });
    // p8-a1-claims — the route claims the sidecar's exact bytes for the run before they land
    const metaText = `${JSON.stringify(next, null, 2)}\n`;
    h.runtime.claimAiWrite(
      'r_copy',
      '.design/ui/C.meta.json',
      claimHashOf('.design/ui/C.meta.json', metaText)
    );
    writeFileSync(meta, metaText); // a plain disk write: no proposeLane note
    h.observe('ui/C.tsx');
    await h.flush();
    await h.runtime.endAiAction('r_copy', 'done');
    const rows = await h.runtime.acceptedHistory({ limit: 10 });
    expect(rows.filter((r) => r.chatId === 'c2')).toHaveLength(1); // the copy and its sidecar: ONE action
    const u = await h.runtime.acceptedUndo({ chatId: 'c2' }, false, { via: 'panel' });
    expect(u.status).toBe('accepted');
    expect(readFileSync(tsx, 'utf8')).toBe(ACCEPTED);
    expect(JSON.parse(readFileSync(meta, 'utf8'))).toEqual(META);
  });
});
