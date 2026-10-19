/** Sticky note — a paper card with a wrapped text body (DDR-242). */

import {
  DEFAULT_FONT_SIZE,
  DEFAULT_STICKY_FILL,
  STICKY_MAX_GROWN_H,
  STICKY_MIN_SIZE,
  STICKY_RADIUS,
} from '../constants.ts';
import { color, num, text } from '../fields.ts';
import type { ElementDef } from '../types.ts';
import {
  BOX_FIELDS,
  boxOf,
  ROT_FIELD,
  resizeBox,
  isoTimeField,
  resolvedField,
  solidBoxHit,
  textStyleFields,
  translateBox,
} from './_shared.ts';

export const sticky: ElementDef = {
  type: 'sticky',
  fields: {
    ...BOX_FIELDS,
    ...ROT_FIELD,
    fill: color(DEFAULT_STICKY_FILL),
    text: text(),
    fontSize: num({ min: 4, max: 400, dp: 1, def: DEFAULT_FONT_SIZE }),
    radius: num({ min: 0, max: 200, dp: 1, def: STICKY_RADIUS }),
    ...textStyleFields('left'),
  },
  // Format 2 (R5): who resolved it, and when — absent = open; `at` is when it was made (local clock, ISO;
  // absent on a sticky from before it existed: the author line then shows the name only).
  ext: { at: isoTimeField(), resolved: resolvedField() },
  caps: {
    box: true,
    rotatable: true,
    resizable: true,
    bindable: true,
    container: false,
    textSlot: 'text',
  },
  bounds: (el) => boxOf(el),
  hitTest: (el, px, py, tol) => solidBoxHit(el, px, py, tol),
  translate: translateBox,
  resize: resizeBox,
  meaningful: (el) => {
    const b = boxOf(el);
    return b.w >= STICKY_MIN_SIZE && b.h >= STICKY_MIN_SIZE;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// S4.12 — a sticky up close (canvas 15 `an-sticky`). Pure and DOM-free: the layer
// draws with these, the tests pin them.

/** Between −2° and +2° (cell 2): the same on every screen and every peer. */
export const STICKY_TILT_MAX = 2;

/**
 * The paper's tilt in degrees, from its id alone — never random per screen. FNV-1a over the id, spread
 * over [−2, +2] in tenths. A sticky the person rotated by hand (a stored `rot`) keeps theirs; the tilt is
 * a drawing default, never written to the file.
 */
export function tiltOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const steps = STICKY_TILT_MAX * 2 * 10; // 40 steps of 0.1°
  return Math.round(((h % (steps + 1)) / 10 - STICKY_TILT_MAX) * 10) / 10;
}

/** A sticky grows to this many lines, then wider (cell 1). */
export const STICKY_MAX_LINES = 5;
/** The text gets smaller only past this many words (cell 1). */
export const STICKY_SHRINK_WORDS = 120;
export const STICKY_MIN_FONT = 10;
/** Widening stops here; past it the paper grows taller again rather than run off the board. */
export const STICKY_MAX_W = 480;
const PAD_X = 16;
const PAD_Y = 14;
/** The sticky line height (annotations/ui/text-style.ts LINE_HEIGHT.sticky — kept local: no UI import). */
const LINE_H = 1.35;
/** Average glyph width of Maude's rounded face, in em. An estimate: the editor's own measurement still wins. */
const GLYPH_EM = 0.52;

const wordsOf = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);

/** How many lines `text` takes in a body `innerW` wide at `fontSize`. */
export function wrapLines(text: string, fontSize: number, innerW: number): number {
  const per = Math.max(1, Math.floor(innerW / (fontSize * GLYPH_EM)));
  let lines = 0;
  for (const para of text.split('\n')) {
    let len = 0;
    let used = 1;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const w = word.length;
      if (len === 0 || len + 1 + w > per) {
        if (len !== 0) used++;
        len = w;
        while (len > per) {
          used++;
          len -= per;
        }
      } else {
        len += 1 + w;
      }
    }
    lines += used;
  }
  return Math.max(1, lines);
}

export interface StickySize {
  w: number;
  h: number;
  fontSize: number;
}

/**
 * The size a sticky needs for `text` (cell 1): square until the words need more, then it grows to five
 * lines, then wider (never a scrollbar), and the type gets smaller only past 120 words. GROWS ONLY — a
 * sticky the person made roomy never shrinks on a text edit (as `grownStickyBox` before it).
 */
export function fitSticky(cur: StickySize, text: string): StickySize {
  let fontSize = cur.fontSize;
  const words = wordsOf(text);
  if (words > STICKY_SHRINK_WORDS) {
    const scale = Math.sqrt(STICKY_SHRINK_WORDS / words);
    fontSize = Math.max(STICKY_MIN_FONT, Math.min(cur.fontSize, Math.floor(cur.fontSize * scale)));
  }
  const lineH = fontSize * LINE_H;
  const hFor = (lines: number) => Math.ceil(lines * lineH + PAD_Y * 2);
  let w = Math.abs(cur.w);
  let h = Math.abs(cur.h);
  let lines = wrapLines(text, fontSize, w - PAD_X * 2);
  // 1. taller, up to five lines.
  if (hFor(Math.min(lines, STICKY_MAX_LINES)) > h) h = hFor(Math.min(lines, STICKY_MAX_LINES));
  // 2. past five lines: wider, a step at a time, until it fits in five (or the width ceiling).
  while (lines > STICKY_MAX_LINES && w < STICKY_MAX_W) {
    w = Math.min(STICKY_MAX_W, w + 20);
    lines = wrapLines(text, fontSize, w - PAD_X * 2);
  }
  // 3. still more (a long essay at the ceiling): taller again, so nothing is clipped.
  if (hFor(lines) > h) h = Math.min(STICKY_MAX_GROWN_H, hFor(lines));
  return { w, h, fontSize };
}

/** A drop on a sticky lands this far down and right, so the one under it still shows (cell 3). */
export const STICKY_STACK_STEP = 12;

export interface Placed {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where a sticky dropped at `point` lands: null when the point is not over another sticky; else
 * `STICKY_STACK_STEP` down and right of the TOP-LEFT of the sticky it landed on, and again for each
 * sticky already sitting on that spot (a stack of three steps 12, 24). `stickies` are in paint order
 * (last = on top); `selfId` is skipped (a sticky being moved does not stack on itself).
 */
export function stackLanding(
  point: { x: number; y: number },
  stickies: readonly Placed[],
  selfId?: string
): { x: number; y: number } | null {
  let target: Placed | null = null;
  for (const s of stickies) {
    if (s.id === selfId) continue;
    if (point.x >= s.x && point.x <= s.x + s.w && point.y >= s.y && point.y <= s.y + s.h)
      target = s;
  }
  if (!target) return null;
  let x = target.x + STICKY_STACK_STEP;
  let y = target.y + STICKY_STACK_STEP;
  const taken = (cx: number, cy: number) =>
    stickies.some((s) => s.id !== selfId && Math.abs(s.x - cx) < 1 && Math.abs(s.y - cy) < 1);
  while (taken(x, y)) {
    x += STICKY_STACK_STEP;
    y += STICKY_STACK_STEP;
  }
  return { x, y };
}

/** The stickies stacked with `id`: boxes that overlap by more than half of the smaller one, chained. */
export function stackMembers(stickies: readonly Placed[], id: string): string[] {
  const byId = new Map(stickies.map((s) => [s.id, s]));
  if (!byId.has(id)) return [];
  const overlaps = (a: Placed, b: Placed) => {
    const iw = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const ih = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (iw <= 0 || ih <= 0) return false;
    return iw * ih > 0.5 * Math.min(a.w * a.h, b.w * b.h);
  };
  const seen = new Set<string>([id]);
  const queue = [id];
  while (queue.length) {
    const cur = byId.get(queue.pop() as string) as Placed;
    for (const s of stickies) {
      if (!seen.has(s.id) && overlaps(cur, s)) {
        seen.add(s.id);
        queue.push(s.id);
      }
    }
  }
  return stickies.filter((s) => seen.has(s.id)).map((s) => s.id);
}

/** Fan out (cell 3): a stack spread into a row, in paint order, from the leftmost corner. */
export function fanOut(
  members: readonly Placed[],
  gap = 16
): Array<{ id: string; x: number; y: number }> {
  if (members.length < 2) return [];
  const x0 = Math.min(...members.map((m) => m.x));
  const y0 = Math.min(...members.map((m) => m.y));
  let x = x0;
  return members.map((m) => {
    const out = { id: m.id, x, y: y0 };
    x += m.w + gap;
    return out;
  });
}

/** "just now" · "5 min ago" · "2 h ago" · "yesterday" · "3 d ago" (CONTRACT §4: relative first). */
export function relativeTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.floor((now - t) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d >= 8) return absoluteTime(t);
  return d === 1 ? 'yesterday' : `${d} d ago`;
}

/** CONTRACT §4 absolute form: "6 Oct, 14:05" (24-hour, local). */
function absoluteTime(t: number): string {
  const d = new Date(t);
  const month = d.toLocaleString('en-GB', { month: 'short' });
  return `${d.getDate()} ${month}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The author line under a sticky (cell 5): "Jonas · 2 h ago"; the time is left out when it is not known. */
export function authorLine(
  who: { name?: string; ai?: boolean; me?: boolean },
  at: string | null | undefined,
  now: number
): string {
  const name = who.ai ? 'AI' : who.me ? 'You' : (who.name ?? '');
  if (!name) return '';
  const when = at ? relativeTime(at, now) : '';
  return when ? `${name} · ${when}` : name;
}

/** Where an imported sticky came from (cell 5: "Imported stickies say where they came from"). */
export function provenanceLine(source: unknown): string | null {
  if (!source || typeof source !== 'object') return null;
  const s = source as { kind?: unknown; author?: unknown };
  if (typeof s.kind !== 'string') return null;
  const who = typeof s.author === 'string' && s.author ? ` · ${s.author}` : '';
  switch (s.kind) {
    case 'figjam':
      return `From FigJam${who}`;
    case 'figma':
      return `From Figma${who}`;
    case 'comment':
      return `From a comment${who}`;
    default:
      return null; // a template, or a source this build does not know: nothing to say
  }
}
