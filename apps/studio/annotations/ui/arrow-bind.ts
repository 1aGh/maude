/**
 * @file       annotations/ui/arrow-bind.ts — aiming an arrow at the thing you mean (S4.11)
 * @scope      apps/studio/annotations/ui/arrow-bind.ts
 * @purpose    Pure half of an-arrow-bind: from one `canvas-rects` snapshot and a world point,
 *             which artboard edge / element the end would bind to ("Button · See the work"),
 *             and — once the pointer lets go — the `startHost` / `endHost` bind to write.
 *
 *             An element can be pointed at only by an AUTHORED id (V2-1.4 rule 3): a computed
 *             8-hex id is never a durable reference, so an unstamped target is stamped first
 *             through the S2.1 edit-op `element.stamp` (Q12; `bindEnd`). If the file is busy
 *             (an AI run holds it, T11) the bind falls back to the artboard — the edge — with
 *             the tag "Bound to the artboard". No DOM, no React; the stamp call is injected.
 */

import type { ArrowStroke } from '../../annotations-model.ts';
import {
  applyHostEnd,
  boxCenter,
  type CanvasHostBind,
  EDGE_INSET,
  type HostBox,
  type HostRects,
  type HostResolver,
  hostEndpoint,
  resolveHost,
} from '../hosts.ts';

/** The edit-op answer `bindEnd` needs (structural: no import of the client relay). */
export type StampResult =
  | { ok: true; refs: ReadonlyArray<{ artboard: string; element: string; occurrence?: number }> }
  | { ok: false; code: string; message: string };

export type StampFn = (target: {
  artboard: string;
  element: string;
  occurrence?: number;
  /** The rev the caller saw, for a `stale` retry. */
  expectRev?: string;
}) => Promise<StampResult>;

/** What the pointer is over. */
export interface BindCandidate {
  kind: 'el' | 'ab';
  artboard: string;
  /** World box of the host (the element, or the whole artboard). */
  box: HostBox;
  /** "Button" — the kind word the ring's tag opens with. */
  word: string;
  /** What the thing says ("See the work"); an artboard: its label. */
  text: string;
  /** `el:` only: the id the manifest saw (authored or computed 8-hex). */
  cdId?: string;
  occurrence?: number;
  /** `el:` only: false when the id is computed — it must be stamped before it can be bound. */
  stamped: boolean;
  /** Over an artboard's edge band: the whole artboard lights up. */
  edge: boolean;
  /** The artboard the candidate sits on (an `el:` candidate falls back to it, Q12). */
  board: HostBox;
  boardText: string;
}

/** The manifest an aim reads: `HostRects` plus what the tag names. */
export interface AimRects {
  artboards: readonly { id: string; x: number; y: number; w: number; h: number }[];
  elements: readonly {
    cdId: string | null;
    artboard: string | null;
    x: number;
    y: number;
    w: number;
    h: number;
    index?: number;
    tag?: string;
    text?: string;
  }[];
}

const COMPUTED_ID = /^[0-9a-f]{8}$/;

const KIND_WORD: Record<string, string> = {
  button: 'Button',
  a: 'Link',
  img: 'Image',
  picture: 'Image',
  svg: 'Icon',
  video: 'Video',
  input: 'Field',
  textarea: 'Field',
  select: 'Menu',
  label: 'Label',
  h1: 'Heading',
  h2: 'Heading',
  h3: 'Heading',
  h4: 'Heading',
  h5: 'Heading',
  h6: 'Heading',
  p: 'Text',
  span: 'Text',
  li: 'Text',
};

/** The word the ring's tag opens with. */
export function kindWord(tag: string | undefined): string {
  return (tag && KIND_WORD[tag.toLowerCase()]) || 'Element';
}

/** True for an id a person (or Claude) wrote — a computed 8-hex id is not durable. */
export const isAuthoredId = (id: string | null | undefined): id is string =>
  !!id && !COMPUTED_ID.test(id);

const area = (b: { w: number; h: number }): number => b.w * b.h;
const within = (b: HostBox, x: number, y: number, pad = 0): boolean =>
  x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

/** Width of the edge band, world px. `px` is the screen width (12), `zoom` the canvas zoom. */
export const edgeBand = (zoom: number, px = EDGE_INSET): number => px / Math.max(zoom, 0.01);

/**
 * The host an end dropped at (x, y) would bind to, or null over empty canvas.
 *
 * 1. Within `band` of an artboard's boundary (either side): that artboard, `edge: true`.
 * 2. Inside an artboard: the SMALLEST element box under the point (the button, not the page).
 * 3. Inside an artboard but over no element: null (a free end; an arrow drawn on a design must
 *    not jump to the artboard's side).
 */
export function pickCandidate(
  rects: AimRects,
  x: number,
  y: number,
  opts: { band: number; labelOf?: (artboardId: string) => string }
): BindCandidate | null {
  const labelOf = opts.labelOf ?? ((id: string) => id);
  const boards = rects.artboards.filter((a) => a.w > 0 && a.h > 0);
  for (const a of boards) {
    const outer = within(a, x, y, opts.band);
    const innerFull =
      x > a.x + opts.band &&
      x < a.x + a.w - opts.band &&
      y > a.y + opts.band &&
      y < a.y + a.h - opts.band;
    if (outer && !innerFull)
      return {
        kind: 'ab',
        artboard: a.id,
        box: { x: a.x, y: a.y, w: a.w, h: a.h },
        word: 'Artboard',
        text: labelOf(a.id),
        stamped: true,
        edge: true,
        board: { x: a.x, y: a.y, w: a.w, h: a.h },
        boardText: labelOf(a.id),
      };
  }
  const board = boards.find((a) => within(a, x, y));
  if (!board) return null;
  let best: AimRects['elements'][number] | null = null;
  for (const e of rects.elements) {
    if (e.artboard !== board.id || !e.cdId || e.w <= 0 || e.h <= 0) continue;
    // The artboard-sized wrapper is the artboard itself, not "an element".
    if (e.w >= board.w - 1 && e.h >= board.h - 1) continue;
    if (!within(e, x, y)) continue;
    if (!best || area(e) < area(best)) best = e;
  }
  if (best?.cdId) {
    return {
      kind: 'el',
      artboard: board.id,
      box: { x: best.x, y: best.y, w: best.w, h: best.h },
      word: kindWord(best.tag),
      text: (best.text ?? '').trim(),
      cdId: best.cdId,
      ...(best.index ? { occurrence: best.index } : {}),
      stamped: isAuthoredId(best.cdId),
      edge: false,
      board: { x: board.x, y: board.y, w: board.w, h: board.h },
      boardText: labelOf(board.id),
    };
  }
  // Over an artboard's body but no element: nothing to point at — the end stays free.
  return null;
}

/** The ref a candidate binds to once it has an authored id. */
export function hostRefOf(c: BindCandidate, elementId?: string): string {
  if (c.kind === 'ab') return `ab:${c.artboard}`;
  const id = elementId ?? c.cdId ?? '';
  return `el:${c.artboard}/${id}${c.occurrence ? `#${c.occurrence}` : ''}`;
}

/** The ring's tag, as the canvas words it: "Button · See the work". */
export function aimTag(c: BindCandidate): { word: string; text: string } {
  return { word: c.word, text: c.text };
}

/** The name stored on the bind — what the dangling card shows (`label`, 1–200 plain chars). */
export function bindLabel(c: BindCandidate): string {
  const t = c.text.replace(/\s+/g, ' ').trim().slice(0, 80);
  return t || c.word;
}

export interface BoundEnd {
  bind: CanvasHostBind;
  /** Set when the element could not be named and the artboard took the bind (Q12). */
  fallback?: 'busy';
  /** The tag the layer shows for a moment: "Bound to the artboard". */
  tag?: string;
}

export const BOUND_TO_ARTBOARD = 'Bound to the artboard';

/**
 * The bind to write for an end that was dropped on `c`. An artboard binds at once. An element
 * with an authored id binds at once. An unstamped one is stamped first (`element.stamp`); a
 * `stale` answer retries once with the fresh rev, `held-by-ai` falls back to the artboard,
 * `forbidden` / anything else yields null (the end stays free; Can comment never gets here).
 */
type Magnet = { nx: number; ny: number };

const mkBind = (ref: string, box: HostBox, label: string, magnet?: Magnet): CanvasHostBind => ({
  ref,
  label,
  box: { x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h) },
  ...(magnet ? { nx: magnet.nx, ny: magnet.ny } : {}),
});

/**
 * The bind for a candidate that needs no round trip: an artboard, or an element that already has
 * an authored id. Null when the element must be stamped first (`bindEnd`).
 */
export function bindNow(c: BindCandidate, magnet?: Magnet): BoundEnd | null {
  if (c.kind === 'ab') return { bind: mkBind(hostRefOf(c), c.box, bindLabel(c), magnet) };
  if (c.stamped && c.cdId) return { bind: mkBind(hostRefOf(c), c.box, bindLabel(c), magnet) };
  return null;
}

export async function bindEnd(
  c: BindCandidate,
  stamp: StampFn,
  magnet?: Magnet
): Promise<BoundEnd | null> {
  const mk = (ref: string, box: HostBox, label: string) => mkBind(ref, box, label, magnet);
  const ab = (): BoundEnd => ({
    bind: mk(`ab:${c.artboard}`, c.board, c.boardText || c.artboard),
    fallback: 'busy',
    tag: BOUND_TO_ARTBOARD,
  });
  const now = bindNow(c, magnet);
  if (now) return now;
  if (!c.cdId) return null;
  const ask = (expectRev?: string) =>
    stamp({
      artboard: c.artboard,
      element: c.cdId as string,
      ...(c.occurrence ? { occurrence: c.occurrence } : {}),
      ...(expectRev ? { expectRev } : {}),
    });
  let r = await ask();
  if (!r.ok && r.code === 'stale') r = await ask();
  if (r.ok) {
    const ref = r.refs[0];
    if (!ref || !isAuthoredId(ref.element)) return ab();
    return {
      bind: mk(
        hostRefOf({ ...c, occurrence: ref.occurrence ?? c.occurrence }, ref.element),
        c.box,
        bindLabel(c)
      ),
    };
  }
  if (r.code === 'held-by-ai' || r.code === 'locked' || r.code === 'stale') return ab();
  return null;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * The world point an end would sit on: the magnet facing `ref` (the other end), exactly as the
 * connector engine will draw it, so the preview and the settled arrow agree.
 */
export function endpointFor(
  c: BindCandidate,
  ref: readonly [number, number],
  magnet?: { nx: number; ny: number }
): [number, number] {
  return hostEndpoint(c.box, { ref: hostRefOf(c), ...(magnet ?? {}) }, ref);
}

/** `HostRects` view of an `AimRects` (the resolver wants the narrower shape). */
export function asHostRects(r: AimRects): HostRects {
  return {
    artboards: r.artboards,
    elements: r.elements.map((e) => ({
      cdId: e.cdId,
      artboard: e.artboard,
      x: e.x,
      y: e.y,
      w: e.w,
      h: e.h,
    })),
  };
}

/** Does the live element still say what the bind remembers? Else it was rewritten. */
export function rewrittenText(
  rects: AimRects,
  bind: Pick<CanvasHostBind, 'ref' | 'label'>
): string | null {
  const m = /^el:([^/]+)\/([^#]+)(?:#(\d+))?$/.exec(bind.ref);
  if (!m) return null;
  const occ = m[3] ? Number(m[3]) : 0;
  const hits = rects.elements.filter((e) => e.artboard === m[1] && e.cdId === m[2]);
  const hit = hits[occ];
  const now = (hit?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!hit || !now || now === bind.label) return null;
  return now;
}

/**
 * `arrow` with canvas binds written on its ends and each bound end placed where it meets its host
 * (the same placement the connector engine re-derives later, so a draw never jumps on commit). A
 * stroke bind on an end that now has a canvas bind is dropped — the canvas host wins (hosts.ts).
 */
export function attachHosts(
  arrow: ArrowStroke,
  binds: { start?: CanvasHostBind; end?: CanvasHostBind },
  resolve: HostResolver
): ArrowStroke {
  let next: ArrowStroke = { ...arrow };
  const sBox = binds.start ? resolveHost(resolve, binds.start.ref) : null;
  const eBox = binds.end ? resolveHost(resolve, binds.end.ref) : null;
  if (binds.start) {
    next = { ...next, startHost: binds.start };
    delete next.startBind;
    const ref: [number, number] = eBox ? boxCenter(eBox) : [next.x2, next.y2];
    next = applyHostEnd(next, 'start', binds.start, sBox, ref);
  }
  if (binds.end) {
    next = { ...next, endHost: binds.end };
    delete next.endBind;
    const ref: [number, number] = sBox ? boxCenter(sBox) : [next.x1, next.y1];
    next = applyHostEnd(next, 'end', binds.end, eBox, ref);
  }
  return next;
}
