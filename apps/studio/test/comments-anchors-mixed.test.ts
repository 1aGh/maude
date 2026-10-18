// comments-anchors-mixed.test.ts — S9.7 / V2-1.12 §5.1 R1, R3: the Maude 2 comment anchors (`artboard`,
// `t` video seconds, `mm` print millimetres) and authorship keys (`authorId`, `authorKind`) survive a
// Maude 1 peer in BOTH directions:
//   v2 → v1 → v2  a v1.9.1 reader + rewrite keeps every v2 key byte for byte;
//   v1 → v2       a Maude 2 read of a Maude 1 record invents nothing and drops nothing.
//
// `V1_*` below are FROZEN copies of the v1.9.1 code read (`api.ts` backfillComment +
// sanitizeTimelineAnchor + comment-anchor predicates, and the commentsPatch resolve write). They must
// not follow later edits to api.ts — they are the peer that is already installed.

import { describe, expect, test } from 'bun:test';

import {
  commentsAt,
  readAnchors,
  sanitizePrintPoint,
  sanitizeVideoTime,
  withSanitizedAnchors,
} from '../comments/anchors.ts';
import { applyCommentOp, parseCommentOp } from '../comments/ops.ts';

// ---- frozen v1.9.1 ---------------------------------------------------------------------------
const V1_ANNOTATION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const V1_isAnnotationId = (v: unknown) => typeof v === 'string' && V1_ANNOTATION_ID_RE.test(v);
const V1_isWorldPoint = (v: unknown) => {
  if (!v || typeof v !== 'object') return false;
  const { x, y } = v as { x?: unknown; y?: unknown };
  return (
    typeof x === 'number' &&
    typeof y === 'number' &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(x) <= 10_000_000 &&
    Math.abs(y) <= 10_000_000
  );
};
function V1_sanitizeTimelineAnchor(raw: unknown) {
  if (!raw || typeof raw !== 'object') return undefined;
  const t = raw as Record<string, unknown>;
  const anchor: Record<string, unknown> = {};
  if (typeof t.clipStableId === 'string' && t.clipStableId.length <= 200)
    anchor.clipStableId = t.clipStableId;
  if (Number.isFinite(Number(t.frameOffset)))
    anchor.frameOffset = Math.max(0, Math.round(Number(t.frameOffset)));
  if (Number.isFinite(Number(t.frame))) anchor.frame = Math.max(0, Math.round(Number(t.frame)));
  if (typeof t.lane === 'string' && t.lane.length <= 40) anchor.lane = t.lane;
  return anchor.clipStableId != null || anchor.frame != null ? anchor : undefined;
}
function V1_backfillComment(raw: unknown) {
  const c = (raw ?? {}) as Record<string, unknown>;
  const timeline = V1_sanitizeTimelineAnchor(c.timeline);
  return {
    ...c,
    author: typeof c.author === 'string' ? c.author : '',
    thread: Array.isArray(c.thread) ? c.thread : [],
    mentions: Array.isArray(c.mentions) ? c.mentions : [],
    ...(timeline ? { timeline } : { timeline: undefined }),
    annotationId: V1_isAnnotationId(c.annotationId) ? c.annotationId : undefined,
    world: V1_isWorldPoint(c.world)
      ? { x: (c.world as { x: number }).x, y: (c.world as { y: number }).y }
      : undefined,
  };
}
/** v1 load → resolve one id (commentsPatch) → save (JSON.stringify, the projection's write). */
function V1_resolveAndSave(fileText: string, id: string): string {
  const list = (JSON.parse(fileText) as unknown[]).map(V1_backfillComment);
  for (const c of list)
    if (c.id === id) Object.assign(c, { status: 'resolved', resolved_at: 'then' });
  return JSON.stringify(list, null, 2);
}
// ----------------------------------------------------------------------------------------------

const V2_KEYS = ['artboard', 't', 'mm', 'authorId', 'authorKind', 'from'] as const;

function v2Video() {
  const add = parseCommentOp({
    op: 'add',
    file: '.design/video/hype.tsx',
    text: 'Logo too early, after the touchdown ~0:14',
    artboard: 'reels-nabor',
    t: 12.3456,
  });
  const print = parseCommentOp({
    op: 'add',
    file: '.design/print/flyer.tsx',
    text: 'URL too close to the edge',
    artboard: 'a-front',
    mm: { x: 14, y: -2.04 },
  });
  if (!add || !print) throw new Error('fixture ops');
  let n = 0;
  const ctx = {
    actor: { name: 'Claude', id: 'h:claude', kind: 'ai' as const },
    now: '2026-10-18T10:00:00.000Z',
    newId: () => `c_${(++n).toString().padStart(12, '0')}`,
    newReplyId: () => `r_${(++n).toString().padStart(12, '0')}`,
  };
  const a = applyCommentOp([], add, ctx);
  if (!a.ok) throw new Error(a.error);
  const sticky = { kind: 'sticky', id: 's_ab12', author: 'Jonas', at: '2026-10-18T09:00:00.000Z' };
  const b = applyCommentOp(a.list, print, { ...ctx, from: sticky });
  if (!b.ok) throw new Error(b.error);
  return b.list;
}

const pick = (c: Record<string, unknown>) =>
  Object.fromEntries(V2_KEYS.filter((k) => k in c).map((k) => [k, c[k]]));

describe('v2 → v1 → v2: a Maude 1 peer carries the Maude 2 keys through', () => {
  test('the v1 read keeps artboard / t / mm / authorship / from verbatim', () => {
    const list = v2Video();
    expect(list[0]).toMatchObject({ artboard: 'reels-nabor', t: 12.346, authorKind: 'ai' });
    expect(list[1]).toMatchObject({
      artboard: 'a-front',
      mm: { x: 14, y: -2 },
      from: { kind: 'sticky', id: 's_ab12', author: 'Jonas', convertedBy: 'Claude' },
    });
    const v1 = (JSON.parse(JSON.stringify(list)) as unknown[]).map(V1_backfillComment);
    expect(v1.map(pick)).toEqual(list.map(pick));
  });

  test('a v1 rewrite (resolve + save) and a v2 re-read keep them byte for byte', () => {
    const list = v2Video();
    const saved = V1_resolveAndSave(JSON.stringify(list), list[0]?.id as string);
    const back = (JSON.parse(saved) as Record<string, unknown>[]).map(withSanitizedAnchors);
    expect(back.map(pick)).toEqual(list.map(pick));
    expect(back[0]?.status).toBe('resolved');
    expect(commentsAt(back, 'reels-nabor').map((c) => c.id)).toEqual([list[0]?.id]);
  });
});

describe('v1 → v2: a Maude 2 read of a Maude 1 record invents nothing', () => {
  const v1Records = [
    {
      id: 'c_000000000001',
      file: '.design/ui/home.tsx',
      selector: '[data-cd-id="hero"]',
      dom_path: [],
      tag: 'div',
      classes: '',
      bounds: { x: 1, y: 2, w: 3, h: 4 },
      html_excerpt: '',
      text: 'v1 element comment',
      status: 'open',
      created: '2026-01-01T00:00:00.000Z',
      resolved_at: null,
      author: 'Olga',
      thread: [{ id: 'r_000000000001', author: 'Max', body: 'ok', created: '2026-01-02' }],
      mentions: [],
    },
    {
      id: 'c_000000000002',
      file: '.design/video/hype.tsx',
      text: 'v1 timeline comment',
      status: 'resolved',
      author: 'Max',
      timeline: { clipStableId: 'clip-1', frameOffset: 12, lane: 'V2 overlay' },
      world: { x: 10, y: 20 },
      annotationId: 's_sticky1',
    },
  ];

  test('every key kept, no key added (the v1 anchors stay exactly as stored)', () => {
    for (const r of v1Records) expect(withSanitizedAnchors(r)).toEqual(r);
  });

  test('a later key the v2 reader does not know is kept too (tolerant both ways)', () => {
    const later = { ...v1Records[0], v3Field: { anything: [1, 2] } };
    expect(withSanitizedAnchors(later)).toEqual(later);
  });
});

describe('anchor shapes — peer-supplied, so a bad one is dropped, never guessed', () => {
  test('t and mm need an artboard; strings are not coerced; bounds hold', () => {
    expect(readAnchors({ t: 5 })).toEqual({});
    expect(readAnchors({ artboard: 'a', t: '5' })).toEqual({ artboard: 'a' });
    expect(sanitizeVideoTime(-1)).toBeUndefined();
    expect(sanitizeVideoTime(86_401)).toBeUndefined();
    expect(sanitizePrintPoint({ x: 1, y: Number.NaN })).toBeUndefined();
    expect(sanitizePrintPoint({ x: 10_001, y: 0 })).toBeUndefined();
    expect(readAnchors({ artboard: '../etc', t: 1 })).toEqual({});
    const dropped = withSanitizedAnchors({ id: 'c_1', artboard: 'a', t: 'soon', mm: 'x', keep: 1 });
    expect(dropped).toEqual({ id: 'c_1', artboard: 'a', keep: 1 });
  });

  test('commentsAt: one board, earliest first', () => {
    const list = [
      { id: 'b', artboard: 'v', t: 9 },
      { id: 'a', artboard: 'v', t: 2 },
      { id: 'x', artboard: 'w', t: 1 },
      { id: 'n', artboard: 'v' },
    ];
    expect(commentsAt(list, 'v').map((c) => c.id)).toEqual(['a', 'b']);
  });
});
