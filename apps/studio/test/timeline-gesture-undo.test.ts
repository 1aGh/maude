// S7.9 — a timeline GESTURE is one edit op and one undo step. Trim an edge, move a beat, drop footage: each rides
// `/_api/edit-op` as `clip.retime` / `clip.move` / `clip.insert`, its `writeId` becomes ONE `record-edit` on the
// canvas stack, ⌘Z restores exactly the bytes before the gesture and ⇧⌘Z writes it again. And S names what it
// split, with the one Undo the toast carries.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyRetimeSequenceByClip, enumerateClips } from '../canvas-edit.ts';
import {
  CLIP_VERB_LABELS,
  clipVerbRefusal,
  clipVerbToast,
  runClipVerb,
} from '../client/v2/timeline/clip-verb.js';
import { applyFitTotalToContent, applyInsertClipAt, applySeriesMove } from '../clip-ops.ts';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import { createEditOpCommand, editOpRecordFromShell } from '../editing/edit-op.ts';
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

function studio() {
  const root = mkdtempSync(join(tmpdir(), 'maude-tl-gesture-'));
  dirs.push(root);
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  const abs = join(designRoot, 'ui', 'Reel.tsx');
  writeFileSync(abs, SRC);
  const specs = createEditRoutes({
    designRoot,
    designRel: '.design',
    repoRoot: root,
    emit: () => {},
  });
  const editOp = specs.find((s) => s.path === '/_api/edit-op') as (typeof specs)[number];
  const calls: string[] = [];
  const bodies: Array<{ op: string; params: Record<string, unknown> }> = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.startsWith('/_api/comp-clips'))
      return Response.json({
        ok: true,
        // the real fingerprints: the writer refuses a stale one
        clips: enumerateClips(FILE, SRC, 'reel').clips.map((c) => ({
          kind: 'sequence',
          stableId: c.stableId,
          contentHash: c.contentHash,
        })),
      });
    if (url === '/_api/edit-op') {
      bodies.push(JSON.parse(String(init?.body)));
      return editOp.handle(new Request(`http://localhost${url}`, init), {} as never);
    }
    return Response.json({ ok: false, error: 'not here' }, { status: 404 });
  };
  const listeners: Array<(e: MessageEvent) => void> = [];
  const parent = {
    postMessage(m: { requestId: string; op: string; targets: unknown; params?: unknown }) {
      void fetch('/_api/edit-op', {
        method: 'POST',
        body: JSON.stringify({ file: FILE, op: m.op, targets: m.targets, params: m.params }),
      })
        .then((r) => r.json())
        .then((j) => {
          for (const l of listeners)
            l({
              source: parent,
              data: { dgn: 'edit-op-result', requestId: m.requestId, ...j },
            } as unknown as MessageEvent);
        });
    },
  };
  const win = {
    parent,
    addEventListener: (_t: string, fn: (e: MessageEvent) => void) => listeners.push(fn),
  } as unknown as Window;
  return { fetch, calls, bodies, win, read: () => readFileSync(abs, 'utf8') };
}

const byStable = (cc: { clips?: Array<{ stableId: string }> }, ref: { stableId: string }) =>
  cc.clips?.find((c) => c.stableId === ref.stableId) ?? null;

const retimed = applyFitTotalToContent(
  FILE,
  applyRetimeSequenceByClip(FILE, SRC, 'reel', 'name:two', undefined, { durationInFrames: 90 })
    .source,
  'reel'
).source;
const moved = applySeriesMove(
  FILE,
  SRC,
  'reel',
  'name:three',
  undefined,
  'name:one',
  undefined,
  'before'
).source;
const insertOpts = {
  lane: 'storyline' as const,
  index: 1,
  durationInFrames: 60,
  mediaTag: 'Video',
  src: 'assets/new.mp4',
};
const inserted = applyInsertClipAt(FILE, SRC, 'reel', insertOpts).source;

const GESTURES = [
  {
    name: 'trim the end of a beat',
    verb: 'retime',
    clipRef: { stableId: 'name:two' },
    params: { durationInFrames: 90 },
    want: retimed,
  },
  {
    name: 'drag a beat before another',
    verb: 'move',
    clipRef: { stableId: 'name:three' },
    params: { refRef: { stableId: 'name:one' }, position: 'before' },
    want: moved,
  },
  {
    name: 'drop footage between two beats',
    verb: 'insert',
    clipRef: null,
    params: insertOpts,
    want: inserted,
  },
];

describe('every gesture is one clip op and one undo step', () => {
  test('retime, move and insert are labelled verbs and ops of the dispatcher', () => {
    const ids = new Set(EDIT_OPS.map((o) => o.id));
    for (const verb of ['retime', 'move', 'insert']) {
      expect(CLIP_VERB_LABELS[verb]).toBeTruthy();
      expect(ids.has(`clip.${verb}`)).toBe(true);
    }
  });

  for (const g of GESTURES) {
    test(`${g.name}: one write, one record; ⌘Z restores the bytes, ⇧⌘Z writes it again`, async () => {
      const s = studio();
      const recorded: unknown[] = [];
      const j = await runClipVerb({
        fetch: s.fetch,
        canvas: FILE,
        artboardId: 'reel',
        clipRef: g.clipRef,
        verb: g.verb,
        params: g.params,
        resolveClip: byStable,
        record: (p: unknown) => recorded.push(p),
      });
      expect(j?.ok).toBe(true);
      expect(s.calls.filter((c) => c === '/_api/edit-op')).toHaveLength(1); // one gesture, one write
      expect(s.calls).not.toContain('/_api/retime-sequence');
      expect(s.calls).not.toContain('/_api/reorder-sequence');
      expect(s.calls).not.toContain('/_api/insert-sequence');
      expect(s.bodies[0].op).toBe(`clip.${g.verb}`);
      expect(s.read()).toBe(g.want);

      expect(recorded).toHaveLength(1);
      const record = editOpRecordFromShell(recorded[0]);
      expect(record).not.toBeNull();
      const cmd = createEditOpCommand(
        record?.payload as { writeId: string },
        record?.label as string,
        s.win
      );
      await cmd.undo();
      expect(s.read()).toBe(SRC);
      await cmd.do();
      expect(s.read()).toBe(g.want);
    });
  }

  test('the move names its drop place by stableId and fingerprint, resolved from fresh clips', async () => {
    const s = studio();
    await runClipVerb({
      fetch: s.fetch,
      canvas: FILE,
      artboardId: 'reel',
      clipRef: { stableId: 'name:three' },
      verb: 'move',
      params: { refRef: { stableId: 'name:one' }, position: 'before' },
      resolveClip: byStable,
      record: () => {},
    });
    const p = s.bodies[0].params;
    expect(p.refStableId).toBe('name:one');
    expect(p.refContentHash).toBe(
      enumerateClips(FILE, SRC, 'reel').clips.find((c) => c.stableId === 'name:one')?.contentHash
    );
    expect(typeof p.refContentHash).toBe('string');
    expect(p.refRef).toBeUndefined();
    expect(p.stableId).toBe('name:three');
  });

  test('a drop onto a clip that is gone resolves nothing and writes nothing', async () => {
    const s = studio();
    const j = await runClipVerb({
      fetch: s.fetch,
      canvas: FILE,
      artboardId: 'reel',
      clipRef: { stableId: 'name:three' },
      verb: 'move',
      params: { refRef: { stableId: 'name:gone' }, position: 'before' },
      resolveClip: byStable,
      record: () => {},
    });
    expect(j).toBeNull();
    expect(s.read()).toBe(SRC);
  });
});

describe('the toast after a gesture', () => {
  test('S: "Split Oslava at 0:10." with the one Undo', () => {
    expect(clipVerbToast('split', { name: 'Oslava', atFrame: 300, fps: 30 })).toEqual({
      text: 'Split Oslava at 0:10.',
      undo: true,
    });
  });

  test('the other gestures say what happened, with no action', () => {
    expect(clipVerbToast('retime', { params: { durationInFrames: 60 } }).text).toBe(
      'Clip trimmed.'
    );
    expect(clipVerbToast('retime', { params: { from: 30 } }).text).toBe('Clip moved.');
    expect(clipVerbToast('move', {}).text).toBe('Clip moved.');
    expect(clipVerbToast('insert', {}).text).toBe('Clip added to the timeline.');
    expect(clipVerbToast('insert', { params: { items: [{}, {}, {}] } }).text).toBe(
      '3 clips added to the timeline.'
    );
    expect(clipVerbToast('remove', {}).text).toBe('Clip removed.');
    expect(clipVerbToast('speed', {}).text).toBe('Applied: set speed.');
    for (const verb of ['retime', 'move', 'insert', 'remove', 'speed'])
      expect(clipVerbToast(verb, {}).undo).toBe(false);
  });
});

describe('a refused gesture says it in a designer’s word', () => {
  test('Trim refused, Move refused, Drop refused — never "retime refused"', () => {
    expect(clipVerbRefusal('retime')).toBe('Trim refused');
    expect(clipVerbRefusal('move')).toBe('Move refused');
    expect(clipVerbRefusal('insert')).toBe('Drop refused');
    expect(clipVerbRefusal('remove')).toBe('Remove refused');
    expect(clipVerbRefusal('speed')).toBe('Set speed refused');
  });
});
