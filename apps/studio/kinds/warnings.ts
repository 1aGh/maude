// apps/studio/kinds/warnings.ts — S7.25: ONE warning style for artboard kinds (08 ak-warnings).
//
// A warning is a mark beside the artboard's label and a row at the top of its inspector with ONE verb. It is shown,
// never blocking and never a dialog. This file is the detectors: pure functions from what an artboard says about itself
// (its kind, size, `print` prop, comp length) and, when there is a render, the WORLD-coordinate rects of what is in it
// (the `window.__maudeCanvasRects()` shape) to the warnings it has. Three callers read the same bytes:
//
//   the canvas        live, from its own DOM (canvas-lib stamps `data-dc-warnings` and draws the label mark), so a warning
//                     appears as the design changes, with no second render;
//   the server        `GET /_api/kinds/warnings?canvas=` (routes/kinds.ts) from a headless render — the agent's door and
//                     the one a script uses;
//   Change kind       the dialog's "Check after" list (kinds/convert.ts) asks the same detectors about the artboard it
//                     is about to make.
//
// The detectors (each is a warning with one verb):
//   crosses-cut        Move inside   a layer sits across the cut line of a print artboard (bleed art is not one)
//   layers-at-cut      Show          several layers do (one row, not one each)
//   soft-image         Replace…      a picture has fewer pixels than its place on paper needs (effective ppi)
//   longer-than-export Allow longer  a video is past the one-export cap (3 600 frames, C22)
//   not-paper-size     Fix size      a print artboard's pixels are not its paper + bleed (Combine-kampan: 1144, not 1145)
//   wider-than-web     Fit to width  a layer is wider than the web page it sits on
//
// Every warning carries the `fix` that its verb runs (a plain object, so the canvas, the shell and an agent read the
// same thing). Nothing here throws: a prop it cannot read is a warning it does not raise.
//
// decision:maude/v2-S7.25-one-warning-style

import { CSS_DPI, resolveMmPx } from '../print/units.ts';
import { MAX_FRAMES_CEILING } from './meta.ts';
import { resolveCustomPrintArtboard } from './print-custom.ts';

/** C22: one export goes up to 2 min at 30 fps (kinds/meta.ts `DEFAULT_MAX_FRAMES`, repeated here to stay React/IO-free). */
export const ONE_EXPORT_FRAMES = 3600;
/** A picture placed at fewer pixels per inch than this "may print a little soft" (print PDFs are made at 300 dpi). */
export const SOFT_PPI = 200;
/** A layer must overshoot a web page by more than this to be called wider than it (sub-pixel rounding is not an edit). */
const WIDE_SLACK_PX = 2;
/** A layer that reaches this far past the cut on its far side is bleed art by intent (a background to the edge). */
const EDGE_SLACK_PX = 1;
/** A layer covering this much of the trim box in both directions is a page, not content near the cut. */
const WRAPPER_SHARE = 0.8;
const MAX_ROWS = 6;

export type WarningCode =
  | 'crosses-cut'
  | 'layers-at-cut'
  | 'soft-image'
  | 'longer-than-export'
  | 'not-paper-size'
  | 'wider-than-web';

/** The one verb of a warning, in the words the row shows. */
export type WarningVerb =
  | 'Move inside'
  | 'Show'
  | 'Replace…'
  | 'Allow longer'
  | 'Fix size'
  | 'Fit to width';

export type WarningFix =
  | { kind: 'move-inside'; element: string; dx: number; dy: number }
  | { kind: 'show'; elements: string[] }
  | { kind: 'replace'; element: string }
  | { kind: 'allow-longer'; maxFrames: number }
  | { kind: 'fix-size'; width: number; height: number | null }
  | { kind: 'fit-width'; element: string; maxWidth: number };

export interface Warning {
  /** stable within one artboard: `<code>[:<element>]` */
  id: string;
  code: WarningCode;
  text: string;
  verb: WarningVerb;
  fix: WarningFix;
}

export interface WarnRect {
  cdId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  tag?: string;
  text?: string;
  /** a picture's own pixel width (`<img>.naturalWidth`); absent = unknown */
  naturalW?: number;
}

/** What the detectors read of the render: the artboard's design surface and its layers, all in WORLD px. */
export interface WarnRects {
  artboard: { x: number; y: number; w: number; h: number };
  elements: readonly WarnRect[];
}

export interface WarnArtboard {
  id: string;
  kind: 'digital' | 'web' | 'print' | 'video';
  /** the artboard's design surface in px (the manifest's, or the declared width/height) */
  widthPx: number;
  heightPx: number;
  /** false = the height hugs its content, so it is not compared with the paper */
  fixed?: boolean;
  /** the `print` prop (an object, or its JSON as `data-dc-print` carries it) */
  print?: unknown;
  /** video: the comp's length, fps and the artboard's own cap (`artboardMeta.maxFrames`) */
  durationFrames?: number | null;
  fps?: number | null;
  maxFrames?: number | null;
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const round1 = (n: number) => Math.round(n * 10) / 10;

function printOf(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return isRec(v) ? v : null;
    } catch {
      return null;
    }
  }
  return isRec(raw) ? raw : null;
}

/** The paper this print prop names, resolved (px = trim + 2 × bleed). Null when it does not resolve. */
export function resolvedPaper(raw: unknown) {
  const print = printOf(raw);
  if (!print || typeof print.paper !== 'string') return null;
  try {
    const r = resolveCustomPrintArtboard({
      paper: print.paper,
      ...(print.orientation === 'landscape' || print.orientation === 'portrait'
        ? { orientation: print.orientation }
        : {}),
      ...(finite(print.bleedMm) ? { bleedMm: print.bleedMm } : {}),
      ...(isRec(print.marginsMm) ? { marginsMm: print.marginsMm } : {}),
      sizeMm: print.sizeMm,
    });
    return { resolved: r, custom: Array.isArray(print.sizeMm), print };
  } catch {
    return null;
  }
}

/** "2:40" for a frame count at an fps. */
export function lengthWords(frames: number, fps: number): string {
  const s = Math.round(frames / (fps > 0 ? fps : 30));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "1 thing to check" / "2 things to check" — the label mark's tooltip. */
export const summaryWords = (n: number): string => `${n} ${n === 1 ? 'thing' : 'things'} to check`;

const NOUN: Record<string, string> = {
  img: 'picture',
  picture: 'picture',
  svg: 'graphic',
  video: 'video',
  button: 'button',
  a: 'link',
  input: 'field',
};

/** What the person calls a layer: its text, else what it is. */
function nameOf(e: WarnRect): string {
  const text = (e.text ?? '').replace(/\s+/g, ' ').trim();
  if (text && e.tag !== 'img') return `“${text.slice(0, 32)}${text.length > 32 ? '…' : ''}”`;
  return NOUN[e.tag ?? ''] ?? 'layer';
}
const nameForSentence = (e: WarnRect): string => {
  const n = nameOf(e);
  return n.startsWith('“') ? n : `The ${n}`;
};

// ── crosses the cut ──────────────────────────────────────────────────────────────────────────────

interface Cut {
  left: number;
  top: number;
  right: number;
  bottom: number;
  w: number;
  h: number;
}

function cutOf(paper: ReturnType<typeof resolvedPaper>, ab: WarnRects['artboard']): Cut | null {
  if (!paper) return null;
  const bleed = paper.resolved.bleedPx;
  const out = { left: bleed, top: bleed, right: ab.w - bleed, bottom: ab.h - bleed } as Cut;
  out.w = out.right - out.left;
  out.h = out.bottom - out.top;
  return out.w > 0 && out.h > 0 ? out : null;
}

/** The layers that sit ACROSS the cut line (part inside, part out) — bleed art by intent is left alone. */
export function layersAtCut(
  paper: ReturnType<typeof resolvedPaper>,
  rects: WarnRects
): Array<{ rect: WarnRect; corner: boolean; dx: number; dy: number }> {
  const cut = cutOf(paper, rects.artboard);
  if (!paper || !cut) return [];
  const ab = rects.artboard;
  const margins = paper.resolved.marginsMm;
  const mm = (n: number) => resolveMmPx(n, CSS_DPI);
  const out: Array<{ rect: WarnRect; corner: boolean; dx: number; dy: number }> = [];
  for (const e of rects.elements) {
    if (!(e.w > 0 && e.h > 0) || !e.cdId) continue;
    const x0 = e.x - ab.x;
    const y0 = e.y - ab.y;
    const x1 = x0 + e.w;
    const y1 = y0 + e.h;
    if (e.w >= cut.w * WRAPPER_SHARE && e.h >= cut.h * WRAPPER_SHARE) continue;
    // crosses an edge: part of it on each side of that line
    const overL = x0 < cut.left && x1 > cut.left;
    const overR = x1 > cut.right && x0 < cut.right;
    const overT = y0 < cut.top && y1 > cut.top;
    const overB = y1 > cut.bottom && y0 < cut.bottom;
    if (!(overL || overR || overT || overB)) continue;
    // bleed art by intent: it runs on to the artboard's own edge on the side that crosses
    if (
      (overL && x0 <= EDGE_SLACK_PX) ||
      (overR && x1 >= ab.w - EDGE_SLACK_PX) ||
      (overT && y0 <= EDGE_SLACK_PX) ||
      (overB && y1 >= ab.h - EDGE_SLACK_PX)
    )
      continue;
    // where it should be: inside the safe margin when it fits there, else just inside the cut
    const room = (side: number, margin: number) => (side - 2 * mm(margin) >= 0 ? mm(margin) : 0);
    const mL = room(cut.w - e.w, margins.left);
    const mR = room(cut.w - e.w, margins.right);
    const mT = room(cut.h - e.h, margins.top);
    const mB = room(cut.h - e.h, margins.bottom);
    let dx = 0;
    let dy = 0;
    if (x0 < cut.left + mL) dx = cut.left + mL - x0;
    else if (x1 > cut.right - mR) dx = cut.right - mR - x1;
    if (y0 < cut.top + mT) dy = cut.top + mT - y0;
    else if (y1 > cut.bottom - mB) dy = cut.bottom - mB - y1;
    out.push({
      rect: e,
      corner: (overL || overR) && (overT || overB),
      dx: Math.round(dx),
      dy: Math.round(dy),
    });
  }
  return out;
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

function cutWarnings(paper: ReturnType<typeof resolvedPaper>, rects: WarnRects): Warning[] {
  const at = layersAtCut(paper, rects);
  if (at.length === 0) return [];
  if (at.length === 1) {
    const [one] = at as [(typeof at)[number]];
    const id = one.rect.cdId as string;
    return [
      {
        id: `crosses-cut:${id}`,
        code: 'crosses-cut',
        text: `${nameForSentence(one.rect)} crosses the cut — ${
          one.corner ? 'its corner' : 'part of it'
        } would be trimmed.`,
        verb: 'Move inside',
        fix: { kind: 'move-inside', element: id, dx: one.dx, dy: one.dy },
      },
    ];
  }
  const n = at.length;
  return [
    {
      id: 'layers-at-cut',
      code: 'layers-at-cut',
      text: `${n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n)} layers sit where the paper is cut.`,
      verb: 'Show',
      fix: { kind: 'show', elements: at.map((a) => a.rect.cdId as string) },
    },
  ];
}

// ── soft pictures ────────────────────────────────────────────────────────────────────────────────

/** Pixels per inch a picture ends up with on paper: its own width over the inches it covers. */
export function effectivePpi(naturalW: number, placedWidthPx: number): number {
  const inches = placedWidthPx / CSS_DPI;
  return inches > 0 ? naturalW / inches : Number.POSITIVE_INFINITY;
}

function softWarnings(
  paper: ReturnType<typeof resolvedPaper>,
  rects: WarnRects,
  minPpi: number
): Warning[] {
  const out: Warning[] = [];
  for (const e of rects.elements) {
    if (e.tag !== 'img' || !e.cdId || !finite(e.naturalW) || e.naturalW <= 0 || !(e.w > 0))
      continue;
    if (effectivePpi(e.naturalW, e.w) >= minPpi) continue;
    const where = paper?.custom
      ? 'this size'
      : String(paper?.resolved.paper ?? 'print').toUpperCase();
    out.push({
      id: `soft-image:${e.cdId}`,
      code: 'soft-image',
      text: `${nameForSentence(e)} is ${Math.round(e.naturalW)} px wide — at ${where} it may print a little soft.`,
      verb: 'Replace…',
      fix: { kind: 'replace', element: e.cdId },
    });
  }
  return out;
}

// ── paper size ───────────────────────────────────────────────────────────────────────────────────

function paperSizeWarning(ab: WarnArtboard, paper: ReturnType<typeof resolvedPaper>): Warning[] {
  if (!paper || !finite(ab.widthPx) || !finite(ab.heightPx)) return [];
  const exp = paper.resolved;
  const dw = Math.round(ab.widthPx) - exp.widthPx;
  const dh = ab.fixed === false ? 0 : Math.round(ab.heightPx) - exp.heightPx;
  if (dw === 0 && dh === 0) return [];
  const name = paper.custom
    ? 'its size'
    : `${String(exp.paper).toUpperCase()}${exp.orientation === 'landscape' ? ' landscape' : ''}`;
  const how =
    dw !== 0
      ? `${Math.abs(dw)} px ${dw < 0 ? 'narrower' : 'wider'}`
      : `${Math.abs(dh)} px ${dh < 0 ? 'shorter' : 'taller'}`;
  return [
    {
      id: 'not-paper-size',
      code: 'not-paper-size',
      text: `${how} than ${name} with bleed (${exp.widthPx} × ${exp.heightPx}).`,
      verb: 'Fix size',
      fix: {
        kind: 'fix-size',
        width: exp.widthPx,
        height: ab.fixed === false ? null : exp.heightPx,
      },
    },
  ];
}

// ── video length ─────────────────────────────────────────────────────────────────────────────────

function videoWarning(ab: WarnArtboard): Warning[] {
  const frames = ab.durationFrames;
  if (!finite(frames) || frames <= 0) return [];
  const fps = finite(ab.fps) && ab.fps > 0 ? ab.fps : 30;
  const cap = finite(ab.maxFrames) && ab.maxFrames > 0 ? ab.maxFrames : ONE_EXPORT_FRAMES;
  if (frames <= cap) return [];
  const len = lengthWords(frames, fps);
  const limit = `one export goes up to ${Math.round(cap / fps / 60)} min (${cap} frames at ${fps} fps)`;
  // past the exporter's own ceiling no switch helps: say so, with no verb that cannot work
  if (frames > MAX_FRAMES_CEILING) return [];
  return [
    {
      id: 'longer-than-export',
      code: 'longer-than-export',
      text: `${len} long — ${limit}.`,
      verb: 'Allow longer',
      fix: { kind: 'allow-longer', maxFrames: Math.min(MAX_FRAMES_CEILING, Math.ceil(frames)) },
    },
  ];
}

// ── wider than the page ──────────────────────────────────────────────────────────────────────────

const WEB_NAMES: ReadonlyArray<[number, string]> = [
  [390, 'Mobile'],
  [834, 'Tablet'],
  [1280, 'Laptop'],
  [1440, 'Desktop'],
];

function wideWarnings(rects: WarnRects): Warning[] {
  const W = rects.artboard.w;
  if (!(W > 0)) return [];
  const named = WEB_NAMES.find(([w]) => Math.abs(w - W) < 1)?.[1] ?? 'this page';
  const out: Warning[] = [];
  for (const e of rects.elements) {
    if (!e.cdId || !(e.w > W + WIDE_SLACK_PX)) continue;
    // the page itself (a wrapper as wide as the content) is not "a layer wider than the page"
    out.push({
      id: `wider-than-web:${e.cdId}`,
      code: 'wider-than-web',
      text: `${nameForSentence(e)} is ${Math.round(e.w)} px wide — wider than ${named}.`,
      verb: 'Fit to width',
      fix: { kind: 'fit-width', element: e.cdId, maxWidth: Math.round(W) },
    });
  }
  return out;
}

// ── the one entry ────────────────────────────────────────────────────────────────────────────────

/**
 * The warnings of one artboard, in the order the inspector draws them (the most useful first). `rects` is optional:
 * without a render only what the artboard's own props say can be raised (paper size, video length).
 */
export function detectWarnings(ab: WarnArtboard, rects?: WarnRects | null): Warning[] {
  const out: Warning[] = [];
  if (ab.kind === 'print') {
    const paper = resolvedPaper(ab.print);
    out.push(...paperSizeWarning(ab, paper));
    if (rects) {
      out.push(...softWarnings(paper, rects, SOFT_PPI));
      out.push(...cutWarnings(paper, rects));
    }
  } else if (ab.kind === 'video') {
    out.push(...videoWarning(ab));
  } else if (ab.kind === 'web' && rects) {
    out.push(...wideWarnings(rects));
  }
  return out.slice(0, MAX_ROWS);
}

/** Round to a tenth for a sentence ("2.4 mm"). Exported for the convert dialog's words. */
export const tenth = round1;
