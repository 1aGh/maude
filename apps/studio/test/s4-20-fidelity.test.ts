// S4.20 — fidelity round 4 (S4.V3 findings).
//   G4 a pinned / over-print sticky keeps its timeRange + parentArtboard all the way to the node the scene
//      draws (the stroke view used to drop them, so no chip / fade / "Not printed").
//   G3 an AI run's tagged annotation batch reaches the run's stage, never the live room.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnnotationElement } from '../annotations/types.ts';
import { AI_PAPER, sectionTone, stickyPaper } from '../annotations/ui/ai-marks.tsx';
import { strokeToRenderItem } from '../annotations/ui/render-model.ts';
import { elementsToStrokes } from '../annotations/v1-adapter.ts';
import { createApi } from '../api.ts';
import { annotationsState } from '../client/v2/export/annotations-policy.js';
import { buildSpec } from '../client/v2/export/use-export-spec.js';
import { AI_FROM_AUTHOR, fromHeadline, fromWho } from '../comments/from-line.ts';
import { type Context, createBus } from '../context.ts';
import { makeSandbox } from './_helpers.ts';

const sticky = (over: Record<string, unknown> = {}) =>
  ({
    id: 'n1',
    type: 'sticky',
    index: 'a0',
    x: 10,
    y: 10,
    w: 150,
    h: 120,
    text: 'Logo comes in too early',
    fill: '#f4a28c',
    ...over,
  }) as AnnotationElement;

describe('G4 — a timed / over-print sticky reaches the scene with its pin', () => {
  test('timeRange and parentArtboard survive board → stroke → render item', () => {
    const el = sticky({
      parentArtboard: 'reel',
      timeRange: { artboard: 'reel', start: 12, end: 15 },
    });
    const strokes = elementsToStrokes([el]);
    const item = strokeToRenderItem(strokes[0]!);
    expect(item?.el.parentArtboard).toBe('reel');
    expect(item?.el.timeRange).toEqual({ artboard: 'reel', start: 12, end: 15 });
  });

  test('a plain sticky carries neither', () => {
    const item = strokeToRenderItem(elementsToStrokes([sticky()])[0]!);
    expect(item?.el.parentArtboard).toBeUndefined();
    expect(item?.el.timeRange).toBeUndefined();
  });
});

// ── G2 ────────────────────────────────────────────────────────────────────────────────────────────
describe('G2 — a stored fill beats the AI neutral paper; a section keeps its tone', () => {
  const AI = { kind: 'ai' };
  test('an AI sticky wears its stored fill, and only falls back to neutral paper without one', () => {
    expect(stickyPaper(sticky({ author: AI, fill: '#c9b8f0' }))).toBe('#c9b8f0');
    expect(stickyPaper(sticky({ author: AI, fill: undefined }))).toBe(AI_PAPER);
    expect(stickyPaper(sticky({ fill: undefined }))).toBe('#fce8a6');
    expect(stickyPaper(sticky({ fill: '#a8d8f0' }))).toBe('#a8d8f0');
  });

  test('the stroke view tells "no fill stored" from a chosen fill, so the scene can decide', () => {
    const filled = strokeToRenderItem(
      elementsToStrokes([sticky({ author: AI, fill: '#c9b8f0' })])[0]!
    );
    expect(filled?.el.fill).toBe('#c9b8f0');
    const bare = strokeToRenderItem(
      elementsToStrokes([sticky({ author: AI, fill: undefined })])[0]!
    );
    expect(bare?.el.fill).toBeUndefined();
    expect(stickyPaper(bare!.el)).toBe(AI_PAPER);
  });

  test('a section’s tone is its stored colour, AI-written or not', () => {
    const sec = (over: Record<string, unknown>) =>
      ({ id: 'g1', type: 'section', x: 0, y: 0, w: 300, h: 400, ...over }) as AnnotationElement;
    expect(sectionTone(sec({ author: AI, color: '#f4d35e' }))).toBe('#f4d35e');
    expect(sectionTone(sec({ color: '#a6e3a1' }))).toBe('#a6e3a1');
    expect(sectionTone(sec({}))).toBe('#8a8a8a');
  });
});

// ── G5 ────────────────────────────────────────────────────────────────────────────────────────────
describe('G5 — the Export sheet says a print file never carries annotations', () => {
  test('a PDF over a print artboard: box off, with the line', () => {
    const s = annotationsState('pdf', { kinds: ['print'] });
    expect(s).toEqual({
      off: true,
      print: true,
      note: 'Print files never carry them — pick PDF for a review copy.',
    });
  });

  test('a PDF of screens, a PNG, an image of a print artboard: still a review copy', () => {
    expect(annotationsState('pdf', { kinds: ['web', 'digital'] }).off).toBe(false);
    expect(annotationsState('png', { kinds: ['print'] }).off).toBe(false);
    expect(annotationsState('pdf').note).toBeUndefined();
  });

  test('a video, a ZIP and a deck are off too, but they are not "print files"', () => {
    for (const f of ['mp4', 'gif', 'webm', 'audio', 'zip', 'pptx', 'canva']) {
      const s = annotationsState(f);
      expect(s.off).toBe(true);
      expect(s.print).toBe(false);
      expect(s.note).toBeUndefined();
    }
  });

  test('the spec never asks for the layer on a print file, even if the box was ticked before', () => {
    const state = { scope: 'canvas', format: 'pdf', annotations: true } as never;
    const print = buildSpec(state, { kinds: ['print'] });
    expect(print.options?.annotations).toBeUndefined();
    const review = buildSpec(state, { kinds: ['web'] });
    expect(review.options?.annotations).toBe(true);
  });
});

// ── G6 ────────────────────────────────────────────────────────────────────────────────────────────
describe('G6 — who a converted sticky was from', () => {
  test('a person-authored sticky: first name, no AI avatar', () => {
    expect(fromHeadline({ author: 'Jonas Novak' })).toBe('From Jonas’s sticky');
    expect(fromWho({ author: 'Jonas Novak' })).toEqual({
      name: 'Jonas Novak',
      ai: false,
      first: 'Jonas',
    });
  });

  test('an AI sticky reads "From AI’s sticky" with the AI avatar', () => {
    expect(fromHeadline({ author: AI_FROM_AUTHOR })).toBe('From AI’s sticky');
    expect(fromWho({ author: AI_FROM_AUTHOR })).toMatchObject({ name: 'AI', ai: true });
  });

  test('a sticky nobody signed never reads "From ’s sticky"', () => {
    expect(fromHeadline({ author: '' })).toBe('From a sticky');
    expect(fromHeadline({})).toBe('From a sticky');
    expect(fromWho({ author: '   ' }).ai).toBe(false);
  });
});

// ── G3 ────────────────────────────────────────────────────────────────────────────────────────────
// Contract S4-S5-ai-annotations §2: "The live-room shortcut (applyAnnotationOpsLive) is skipped for
// tagged batches." With a room open the shortcut took the batch, so the resolves landed as their own
// "Edit annotations" action and ⌘Z needed two presses.

const FILE = '.design/ui/Foo.tsx';

function apiRig() {
  const { root, designRoot } = makeSandbox();
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(join(designRoot, 'ui/Foo.tsx'), 'export default function P(){return <main/>}');
  const ctx: Context = {
    cfg: {} as Context['cfg'],
    projectLabel: 's420',
    bus: createBus(),
    paths: {
      repoRoot: root,
      designRel: '.design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: '',
      systemDirRel: 'system',
    },
  };
  const liveCalls: Array<string | undefined> = [];
  const published: Array<string | undefined> = [];
  const api = createApi(ctx, {
    onCommentsChanged() {},
    onAnnotationsChanged(_file, _svg, writeId) {
      published.push(writeId);
    },
    // A room is open: the shortcut would take any batch it is offered.
    applyAnnotationOpsLive(_file, ops, actionId) {
      liveCalls.push(actionId);
      return {
        touched: new Set(['n1']),
        applied: [...ops],
        inverse: [],
        rejected: [],
        state: new Map(),
      };
    },
  });
  return { api, liveCalls, published };
}

const PUT = [{ op: 'put' as const, el: sticky({ id: 'n1' }) }];

describe('G3 — a run-tagged annotation batch is staged, not shortcut into the room', () => {
  test('actionId run:<id> skips the live room and publishes with its tag', async () => {
    const r = apiRig();
    const res = await r.api.applyAnnotationOps(FILE, PUT, 'run:r_abc123');
    expect(res.ok).toBe(true);
    expect(r.liveCalls).toEqual([]);
    expect(r.published).toEqual(['run:r_abc123']);
  });

  test('a person-made batch still takes the room (unchanged)', async () => {
    const r = apiRig();
    await r.api.applyAnnotationOps(FILE, PUT, 'ui-edit-1');
    expect(r.liveCalls).toEqual(['ui-edit-1']);
    expect(r.published).toEqual([]);
  });
});
