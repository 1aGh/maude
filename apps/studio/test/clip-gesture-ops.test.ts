// S7.9 — the three timeline gestures the S7.6 verbs did not cover are edit ops too (S7-slices Q2, decision
// `maude/v2-S7-clip-ops-through-edit-op`): trimming an edge or moving a clip (`clip.retime`), dragging a beat to
// a new place in the series (`clip.move`), and dropping footage (`clip.insert`). Each is ONE write through the
// dispatcher, so a gesture is one undo step (`writeId`, never a timeline-local `seq`), a human and an agent
// reach the same bytes, and a run holding the artboard refuses it with `held-by-ai`.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyRetimeSequenceByClip } from '../canvas-edit.ts';
import { applyFitTotalToContent, applyInsertClipAt, applySeriesMove } from '../clip-ops.ts';
import { CLIP_GESTURE_OPS, CLIP_OPS } from '../edit-ops/clip/index.ts';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import { createEditRoutes } from '../routes/edit.ts';

const SRC = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { TransitionSeries } from '@remotion/transitions';",
  "import { Video } from '@remotion/media';",
  'const TOTAL = 270;',
  'const Comp = () => (',
  '  <TransitionSeries>',
  '    <TransitionSeries.Sequence name="one" durationInFrames={90}><Video src="a.mp4" /></TransitionSeries.Sequence>',
  '    <TransitionSeries.Sequence name="two" durationInFrames={120}><Video src="b.mp4" trimBefore={30} /></TransitionSeries.Sequence>',
  '    <TransitionSeries.Sequence name="three" durationInFrames={60}><Video src="c.mp4" /></TransitionSeries.Sequence>',
  '  </TransitionSeries>',
  ');',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="reel" kind="video" width={1080} height={1920}><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} /></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');
const FILE = 'ui/Reel.tsx';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'maude-clip-gesture-'));
  dirs.push(root);
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(join(designRoot, 'ui', 'Reel.tsx'), SRC);
  return { root, designRoot, read: () => readFileSync(join(designRoot, 'ui', 'Reel.tsx'), 'utf8') };
}

function editOpRoute(
  designRoot: string,
  root: string,
  leases: Array<{ canvas: string; artboard: string }> = []
) {
  const runs = {
    canvasKey: (rel: string) => `path:.design/${rel}`,
    live: () => [{ runId: 'r1', state: 'running', objects: [], scope: null, leases }],
    holderOf: (k: { canvas: string; artboard: string }) =>
      leases.some((l) => l.canvas === k.canvas && l.artboard === k.artboard)
        ? { runId: 'r1' }
        : null,
    view: () => ({ others: [] }),
  } as never;
  const specs = createEditRoutes({
    designRoot,
    designRel: '.design',
    repoRoot: root,
    emit: () => {},
    runs,
  });
  return specs.find((s) => s.path === '/_api/edit-op') as (typeof specs)[number];
}
const post = (body: unknown) =>
  new Request('http://localhost/_api/edit-op', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('the gesture ops are in the one op table', () => {
  test('clip.retime, clip.move and clip.insert are artboard-scoped ops of the dispatcher', () => {
    expect(CLIP_GESTURE_OPS.map((o) => o.id)).toEqual(['clip.retime', 'clip.move', 'clip.insert']);
    for (const op of CLIP_GESTURE_OPS) {
      expect(op.scope).toBe('artboard');
      expect(CLIP_OPS).toContain(op);
      expect(EDIT_OPS).toContain(op);
    }
    const ids = EDIT_OPS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('one gesture, one write, the same bytes as the pure appliers', () => {
  test('trim the end: the beat shortens, the rest closes up and the video follows (270 → 240)', async () => {
    const s = sandbox();
    const route = editOpRoute(s.designRoot, s.root);
    const r = await route.handle(
      post({
        file: FILE,
        op: 'clip.retime',
        targets: [],
        params: { artboard: 'reel', stableId: 'name:two', durationInFrames: 90 },
      }),
      {}
    );
    expect(r.status).toBe(200);
    const j = (await r.json()) as Record<string, unknown>;
    expect(typeof j.writeId).toBe('string'); // the undo step
    expect(j.seq).toBeUndefined(); // no timeline-local revert
    const want = applyFitTotalToContent(
      FILE,
      applyRetimeSequenceByClip(FILE, SRC, 'reel', 'name:two', undefined, { durationInFrames: 90 })
        .source,
      'reel'
    ).source;
    expect(s.read()).toBe(want);
    expect(s.read()).toContain('const TOTAL = 240');
  });

  test('move a beat: it lands before the other, nothing else changes length', async () => {
    const s = sandbox();
    const route = editOpRoute(s.designRoot, s.root);
    const r = await route.handle(
      post({
        file: FILE,
        op: 'clip.move',
        targets: [],
        params: {
          artboard: 'reel',
          stableId: 'name:three',
          refStableId: 'name:one',
          position: 'before',
        },
      }),
      {}
    );
    expect(r.status).toBe(200);
    expect(s.read()).toBe(
      applySeriesMove(FILE, SRC, 'reel', 'name:three', undefined, 'name:one', undefined, 'before')
        .source
    );
    const order = [...s.read().matchAll(/name="(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['three', 'one', 'two']);
    expect(s.read()).toContain('const TOTAL = 270');
  });

  test('drop footage at a place: a new beat, the video grows by what was dropped', async () => {
    const s = sandbox();
    const route = editOpRoute(s.designRoot, s.root);
    const opts = {
      lane: 'storyline' as const,
      index: 1,
      durationInFrames: 60,
      mediaTag: 'Video',
      src: 'assets/new.mp4',
    };
    const r = await route.handle(
      post({
        file: FILE,
        op: 'clip.insert',
        targets: [],
        params: { artboard: 'reel', ...opts },
      }),
      {}
    );
    expect(r.status).toBe(200);
    const j = (await r.json()) as { detail?: { stableId?: string | null } };
    expect(s.read()).toBe(applyInsertClipAt(FILE, SRC, 'reel', opts).source);
    expect(s.read()).toContain('assets/new.mp4');
    expect(j.detail?.stableId).toBeTruthy();
  });
});

describe('dropping three clips is one gesture: one write, one undo step', () => {
  test('items land in order at index, in ONE edit-op, bytes = the appliers run one after another', async () => {
    const s = sandbox();
    const route = editOpRoute(s.designRoot, s.root);
    const items = [
      { mediaTag: 'Video', src: 'assets/a.mp4', durationInFrames: 60 },
      { mediaTag: 'Video', src: 'assets/b.mp4', durationInFrames: 90 },
      { mediaTag: 'Video', src: 'assets/c.mp4', durationInFrames: 30 },
    ];
    let want = SRC;
    items.forEach((it, k) => {
      want = applyInsertClipAt(FILE, want, 'reel', {
        lane: 'storyline',
        index: 1 + k,
        ...it,
      }).source;
    });
    const r = await route.handle(
      post({
        file: FILE,
        op: 'clip.insert',
        targets: [],
        params: { artboard: 'reel', lane: 'storyline', index: 1, items },
      }),
      {}
    );
    expect(r.status).toBe(200);
    const j = (await r.json()) as { writeId?: string; detail?: { stableIds?: unknown[] } };
    expect(typeof j.writeId).toBe('string');
    expect(j.detail?.stableIds).toHaveLength(3);
    expect(s.read()).toBe(want);
    const order = [...s.read().matchAll(/src="assets\/(\w)\.mp4"/g)].map((m) => m[1]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  test('a bad item refuses the whole drop and writes nothing', async () => {
    const s = sandbox();
    const route = editOpRoute(s.designRoot, s.root);
    const r = await route.handle(
      post({
        file: FILE,
        op: 'clip.insert',
        targets: [],
        params: {
          artboard: 'reel',
          lane: 'storyline',
          items: [
            { mediaTag: 'Video', src: 'assets/a.mp4', durationInFrames: 60 },
            { mediaTag: 'Video', src: '../escape.mp4', durationInFrames: 60 },
          ],
        },
      }),
      {}
    );
    expect(r.status).toBe(400);
    expect(s.read()).toBe(SRC);
  });
});

describe('refusals', () => {
  test('a gesture during an AI cut on the same artboard → 409 held-by-ai, file untouched', async () => {
    const s = sandbox();
    const route = editOpRoute(s.designRoot, s.root, [
      { canvas: 'path:.design/ui/Reel.tsx', artboard: 'reel' },
    ]);
    for (const [op, params] of [
      ['clip.retime', { stableId: 'name:two', durationInFrames: 90 }],
      ['clip.move', { stableId: 'name:three', refStableId: 'name:one', position: 'before' }],
      ['clip.insert', { lane: 'storyline', durationInFrames: 30, mediaTag: 'Video', src: 'a.mp4' }],
    ] as const) {
      const r = await route.handle(
        post({ file: FILE, op, targets: [], params: { artboard: 'reel', ...params } }),
        {}
      );
      expect(r.status).toBe(409);
    }
    expect(s.read()).toBe(SRC);
  });

  test('nonsense params are the applier’s refusal (400 invalid), not a write', async () => {
    const s = sandbox();
    const route = editOpRoute(s.designRoot, s.root);
    for (const [op, params] of [
      ['clip.retime', { stableId: 'name:two' }], // nothing to retime
      ['clip.move', { stableId: 'name:three', refStableId: 'name:three', position: 'before' }],
      ['clip.move', { stableId: 'name:three', refStableId: 'name:one', position: 'sideways' }],
      ['clip.insert', { lane: 'elsewhere', durationInFrames: 30 }],
      [
        'clip.insert',
        { lane: 'storyline', durationInFrames: 30, mediaTag: 'Video', src: '../x.mp4' },
      ],
    ] as const) {
      const r = await route.handle(
        post({ file: FILE, op, targets: [], params: { artboard: 'reel', ...params } }),
        {}
      );
      expect(r.status).toBe(400);
    }
    expect(s.read()).toBe(SRC);
  });
});
