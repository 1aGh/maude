// video/framing.ts — S7.5 (contract V2-1.10 §5.3, §5.4, §5.6; S7 Q5).
//
// The PURE half of the comp vocabulary: the math `<Captions>`, `<Duck>`, `<Reframe>` and `<Place>`
// run every frame inside the canvas iframe, and that the server (`video/derive.ts`, the route, the
// verbs) runs too. One copy, so the picture and the Timeline never disagree.
//
// NO IMPORTS, on purpose: canvas-lib.tsx reaches this file, and the canvas iframe's module graph may
// hold no npm package outside the runtime externals (test/canvas-lib-graph.test.ts). derive.ts
// pulls in the oxc parser, so the canvas side can never import it — it imports this instead.
//
// Deterministic (DDR-148): a function of its inputs and the frame. No clock, no random.

// ---------------------------------------------------------------------------
// ducking

/** Linear gain multiplier for `frame`: 1 outside speech, `10^(db/20)` inside it, a linear-in-dB
 *  ramp over `attackFrames` before each region and `releaseFrames` after it. A pure function of the
 *  frame (DDR-148) — `speech` must be sorted, as `compSpeech` returns it. */
export function duckGain(
  frame: number,
  speech: ReadonlyArray<readonly [number, number]>,
  o: { db: number; attackFrames: number; releaseFrames: number }
): number {
  const db = Math.min(0, o.db);
  if (db === 0) return 1;
  let depth = 0; // 0..1 of the full attenuation, the deepest over all regions
  for (const [s, e] of speech) {
    if (s - o.attackFrames > frame) break; // sorted: every later region starts later still
    let k: number;
    if (frame >= s && frame <= e) k = 1;
    else if (frame < s)
      k = o.attackFrames > 0 ? (frame - (s - o.attackFrames)) / o.attackFrames : 0;
    else k = o.releaseFrames > 0 ? 1 - (frame - e) / o.releaseFrames : 0;
    if (k > depth) depth = k;
    if (depth >= 1) break;
  }
  return depth <= 0 ? 1 : 10 ** ((db * depth) / 20);
}

/** `<Duck>`'s defaults (V2-1.10 §5.3) and the ms → frames of its ramps. */
export const DUCK_DEFAULTS = { db: -12, attackMs: 200, releaseMs: 400 } as const;

export function msToFrames(ms: number, fps: number): number {
  return Number.isFinite(ms) && ms > 0 && fps > 0 ? Math.round((ms * fps) / 1000) : 0;
}

// ---------------------------------------------------------------------------
// framing

/** "W:H" reduced by the greatest common divisor — the key of `<Reframe formats>` / `<Place formats>`. */
export function aspectKey(w: number, h: number): string {
  let x = Math.round(Math.abs(w));
  let y = Math.round(Math.abs(h));
  if (!x || !y) return `${w}:${h}`;
  const gcd = (p: number, q: number): number => (q ? gcd(q, p % q) : p);
  const g = gcd(x, y);
  x /= g;
  y /= g;
  return `${x}:${y}`;
}

/**
 * The output-aspect window cut from the source: the largest window of that aspect that fits, scaled
 * by 1/zoom (zoom < 1 counts as 1), centred on the focus point (fractions of the source frame) and
 * clamped to the source. Pixels of the SOURCE.
 */
export function reframeWindow(
  focus: readonly [number, number],
  src: { w: number; h: number },
  out: { w: number; h: number },
  zoom: number
): { x: number; y: number; w: number; h: number } {
  const aspect = out.w / out.h;
  let w: number;
  let h: number;
  if (src.w / src.h > aspect) {
    h = src.h;
    w = h * aspect;
  } else {
    w = src.w;
    h = w / aspect;
  }
  const z = zoom >= 1 ? zoom : 1;
  w /= z;
  h /= z;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const x = clamp(clamp(focus[0], 0, 1) * src.w - w / 2, 0, src.w - w);
  const y = clamp(clamp(focus[1], 0, 1) * src.h - h / 2, 0, src.h - h);
  return { x, y, w, h };
}

/** Where the whole source sits, in output pixels, so the reframe window fills the output exactly. */
export function reframeBox(
  focus: readonly [number, number],
  src: { w: number; h: number },
  out: { w: number; h: number },
  zoom: number
): { left: number; top: number; width: number; height: number } {
  const win = reframeWindow(focus, src, out, zoom);
  const s = out.w / win.w;
  return { left: -win.x * s, top: -win.y * s, width: src.w * s, height: src.h * s };
}

/** The source second a clip plays at its own frame `frame` (DDR-163 clocks: trim in output frames). */
export function sourceSecond(frame: number, trimBefore: number, rate: number, fps: number): number {
  return (trimBefore + frame * (rate > 0 ? rate : 1)) / (fps > 0 ? fps : 30);
}

/** One `<Reframe focus>` key: `[sourceSec, x, y]`, x and y fractions of the SOURCE frame. */
export type FocusKey = readonly [number, number, number];

/**
 * The focus point at source second `t`: `formats["W:H"] ?? focus`, linear between keys, holding the
 * first and last. No usable key = the centre (B3). Keys are expected sorted (`maude design check`
 * refuses unsorted ones); an unsorted list is read in its own order, never re-sorted.
 */
export function focusAt(
  t: number,
  focus: ReadonlyArray<FocusKey> | undefined,
  formats: Readonly<Record<string, ReadonlyArray<FocusKey>>> | undefined,
  out: { w: number; h: number }
): [number, number] {
  const keys = (formats?.[aspectKey(out.w, out.h)] ?? focus ?? []).filter(
    (k) =>
      Array.isArray(k) &&
      k.length >= 3 &&
      k.every((v) => typeof v === 'number' && Number.isFinite(v))
  );
  if (keys.length === 0) return [0.5, 0.5];
  const first = keys[0] as FocusKey;
  if (t <= first[0]) return [first[1], first[2]];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1] as FocusKey;
    const b = keys[i] as FocusKey;
    if (t <= b[0]) {
      const span = b[0] - a[0];
      const k = span > 0 ? (t - a[0]) / span : 1;
      return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  }
  const last = keys[keys.length - 1] as FocusKey;
  return [last[1], last[2]];
}

/** `<Place at formats>` (S7 Q5): the title's centre anchor in output pixels — `formats["W:H"]`
 *  when the output has that aspect, else `at`; fractions are clamped to the frame. */
export function placeAt(
  spec: { at: readonly [number, number]; formats?: Record<string, readonly [number, number]> },
  out: { w: number; h: number }
): { x: number; y: number } {
  const p = spec.formats?.[aspectKey(out.w, out.h)] ?? spec.at;
  const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));
  return { x: clamp(p[0]) * out.w, y: clamp(p[1]) * out.h };
}

// ---------------------------------------------------------------------------
// captions

/** The words `<Captions>` receives at build (`__words`): `CompWord` minus what the picture ignores. */
export interface CaptionWordFrames {
  wordId: string;
  clip: string;
  f0: number;
  f1: number;
  text: string;
}

export type WordsAtATime = 1 | 3 | 'line';

/** Line reflow, the same rules as generation/captions.ts `reflowWords` (in frames): a line ends at
 *  `maxChars`, after 6 s, at a 0.8 s silence, after `. ! ?`, and — here — at a cut between clips. */
export const CAPTION_REFLOW = { maxChars: 32, maxDurationSec: 6, gapBreakSec: 0.8 } as const;

export interface CaptionGroup {
  words: CaptionWordFrames[];
  /** comp frames the group is on screen: [f0, f1) */
  f0: number;
  f1: number;
}

/** Group the comp's words into what is on screen together. `words` sorted by f0 (compWords is). */
export function captionGroups(
  words: ReadonlyArray<CaptionWordFrames>,
  mode: WordsAtATime,
  fps: number,
  maxChars: number = CAPTION_REFLOW.maxChars
): CaptionGroup[] {
  const per = mode === 1 ? 1 : mode === 3 ? 3 : Number.POSITIVE_INFINITY;
  const chars = Number.isFinite(maxChars) && maxChars >= 4 ? maxChars : CAPTION_REFLOW.maxChars;
  const gap = CAPTION_REFLOW.gapBreakSec * fps;
  const span = CAPTION_REFLOW.maxDurationSec * fps;
  const groups: CaptionGroup[] = [];
  let cur: CaptionWordFrames[] = [];
  const flush = () => {
    if (!cur.length) return;
    groups.push({
      words: cur,
      f0: (cur[0] as CaptionWordFrames).f0,
      f1: (cur[cur.length - 1] as CaptionWordFrames).f1,
    });
    cur = [];
  };
  for (const w of words) {
    if (!w || typeof w.text !== 'string' || !w.text.trim()) continue;
    const prev = cur[cur.length - 1];
    if (prev) {
      const projected = cur.map((x) => x.text.trim()).join(' ').length + 1 + w.text.trim().length;
      if (
        cur.length >= per ||
        w.clip !== prev.clip ||
        w.f0 - prev.f1 >= gap ||
        w.f1 - (cur[0] as CaptionWordFrames).f0 > span ||
        (mode === 'line' && projected > chars)
      )
        flush();
    }
    cur.push(w);
    if (mode !== 1 && /[.!?…]$/.test(w.text.trim())) flush();
  }
  flush();
  // A short silence keeps the line up until the next one starts — no flicker between lines.
  for (let i = 0; i + 1 < groups.length; i++) {
    const g = groups[i] as CaptionGroup;
    const next = groups[i + 1] as CaptionGroup;
    if (next.f0 > g.f1 && next.f0 - g.f1 < gap) g.f1 = next.f0;
  }
  return groups;
}

/** What `<Captions>` shows at `frame`: the group on screen and the word being spoken in it (the
 *  last one that has started), or null when nothing is. */
export function captionAt(
  groups: ReadonlyArray<CaptionGroup>,
  frame: number
): { group: CaptionGroup; active: number } | null {
  for (const g of groups) {
    if (frame < g.f0) return null; // sorted: nothing later is on screen yet
    if (frame >= g.f1) continue;
    let active = -1;
    g.words.forEach((w, i) => {
      if (w.f0 <= frame) active = i;
    });
    return { group: g, active };
  }
  return null;
}
