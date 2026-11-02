// S7.6 — ⌘Z after a Timeline clip verb undoes exactly that verb through the ONE canvas undo stack
// (decision `maude/v2-S7-timeline-undo-is-project-undo`). The verb rides `/_api/edit-op`
// (`clip.<verb>`), its answer's `writeId` becomes a `record-edit { op: 'edit-op' }` the canvas pushes
// as a `revert {writeId}` record, and redo re-applies it. No `seq`, no timeline-local stack, no
// `timeline.undo` / `timeline.redo` bindings: ⌘Z with the timeline focused is `edit.undo`.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MOVED_KEYS } from '../actions/help.ts';
import { ACTIONS } from '../actions/index.ts';
import {
  CLIP_VERB_LABELS,
  clipVerbRequest,
  editOpUndoPayload,
  runClipVerb,
} from '../client/v2/timeline/clip-verb.js';
import { applySplitClip } from '../clip-ops.ts';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import { WRITE_ID_RE } from '../edit-ops/revert.ts';
import { editOpRecord, SHELL_WRITE_ID_RE } from '../editing/edit-op.ts';
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

/** A project with one comp, its edit route, and a `fetch` that answers like the studio. */
function studio() {
  const root = mkdtempSync(join(tmpdir(), 'maude-tl-undo-'));
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
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.startsWith('/_api/comp-clips'))
      return Response.json({
        ok: true,
        clips: [
          { kind: 'sequence', stableId: 'name:one' },
          { kind: 'sequence', stableId: 'name:two' },
        ],
      });
    if (url === '/_api/edit-op')
      return editOp.handle(new Request(`http://localhost${url}`, init), {} as never);
    return Response.json({ ok: false, error: 'not here' }, { status: 404 });
  };
  /** The canvas iframe as `runEditOp` sees it: its shell pins the file and calls the route. */
  const listeners: Array<(e: MessageEvent) => void> = [];
  const parent = {
    postMessage(m: {
      dgn: string;
      requestId: string;
      op: string;
      targets: unknown;
      params?: unknown;
    }) {
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
  return { fetch, calls, win, read: () => readFileSync(abs, 'utf8') };
}

const byStable = (cc: { clips?: Array<{ stableId: string }> }, ref: { stableId: string }) =>
  cc.clips?.find((c) => c.stableId === ref.stableId) ?? null;

describe('a Timeline clip verb is an edit op', () => {
  test('the request is clip.<verb> on /_api/edit-op; every labelled verb is an op', () => {
    expect(
      clipVerbRequest({
        canvas: FILE,
        artboardId: 'reel',
        clip: { stableId: 'name:two', contentHash: 'h1' },
        verb: 'split',
        params: { atFrame: 150 },
      })
    ).toEqual({
      file: FILE,
      op: 'clip.split',
      targets: [],
      params: { atFrame: 150, artboard: 'reel', stableId: 'name:two', contentHash: 'h1' },
    });
    const ids = new Set(EDIT_OPS.map((o) => o.id));
    // S7.10: a dotted verb (`video.fit`, `video.title.motion`, …) is already the op id; a bare one is `clip.<verb>`.
    for (const verb of Object.keys(CLIP_VERB_LABELS))
      expect(ids.has(verb.includes('.') ? verb : `clip.${verb}`)).toBe(true);
  });

  test('only a writeId records; a seq is not an undo any more', () => {
    expect(editOpUndoPayload({ ok: true, seq: 4 }, 'split clip')).toBeNull();
    expect(editOpUndoPayload({ ok: false, writeId: 'w_0123456789abcdef' }, 'x')).toBeNull();
    expect(editOpUndoPayload({ ok: true, writeId: 'w_0123456789abcdef' }, 'split clip')).toEqual({
      op: 'edit-op',
      writeId: 'w_0123456789abcdef',
      label: 'split clip',
    });
    expect(SHELL_WRITE_ID_RE.source).toBe(WRITE_ID_RE.source);
  });
});

describe('⌘Z after a timeline split undoes exactly that split; ⇧⌘Z re-applies it', () => {
  test('split → the shell posts ONE record-edit; the canvas keeps no stack (p8-v1-drop: ⌘Z is the op log)', async () => {
    const s = studio();
    const recorded: unknown[] = [];
    const j = await runClipVerb({
      fetch: s.fetch,
      canvas: FILE,
      artboardId: 'reel',
      clipRef: { stableId: 'name:two' },
      verb: 'split',
      params: { atFrame: 150 },
      resolveClip: byStable,
      record: (p: unknown) => recorded.push(p),
    });
    expect(j?.ok).toBe(true);
    expect(s.calls).toContain('/_api/edit-op');
    expect(s.calls).not.toContain('/_api/clip-edit');
    const split = applySplitClip(FILE, SRC, 'reel', 'name:two', undefined, 150).source;
    expect(s.read()).toBe(split);

    // the shell posts this to the canvas; the write is a kernel action, so the canvas records nothing
    // (the legacy `revert {writeId}` stack record went with p8-v1-drop)
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ op: 'edit-op', label: 'split clip' });
    expect(editOpRecord((recorded[0] as { writeId: string }).writeId, 'split clip')).toBeNull();
  });

  test('a refused verb records nothing', async () => {
    const s = studio();
    const recorded: unknown[] = [];
    const j = await runClipVerb({
      fetch: s.fetch,
      canvas: FILE,
      artboardId: 'reel',
      clipRef: { stableId: 'name:two' },
      verb: 'split',
      params: { atFrame: 'soon' },
      resolveClip: byStable,
      record: (p: unknown) => recorded.push(p),
    });
    expect(j?.ok).toBe(false);
    expect(recorded).toHaveLength(0);
    expect(s.read()).toBe(SRC);
  });
});

describe('the timeline-local undo is retired', () => {
  test('no timeline.undo / timeline.redo; ⌘Z with the timeline focused is edit.undo', () => {
    const ids = new Set(ACTIONS.map((a) => a.id));
    expect(ids.has('timeline.undo')).toBe(false);
    expect(ids.has('timeline.redo')).toBe(false);
    const undo = ACTIONS.find((a) => a.id === 'edit.undo');
    expect(undo?.keys?.some((k) => k.layer === 'timeline' && k.chord === '⌘Z')).toBe(true);
    expect(MOVED_KEYS.some((m) => m.to === 'edit.undo' && m.was.includes('Timeline'))).toBe(true);
  });

  test('the hook no longer reads a seq from a clip verb, nor keeps its own stack', () => {
    const hook = readFileSync(
      join(import.meta.dir, '..', 'client', 'hooks', 'use-photo-and-timeline.jsx'),
      'utf8'
    );
    expect(hook).not.toContain("'/_api/clip-edit'");
    expect(hook).not.toContain('tlUndoRef');
    expect(hook).toContain('runClipVerb');
  });
});
