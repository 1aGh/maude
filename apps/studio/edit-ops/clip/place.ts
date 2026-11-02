// edit-ops/clip/place.ts — `video.place` (S7.6c; S7-slices Q5, 07 ve-formats per-format title
// position).
//
// `<Place at={[x, y]} formats={{ "16:9": [x, y] }}>` holds a title clip's content: a centre anchor in
// fractions of the OUTPUT frame, with a per-format override keyed by reduced W:H (`placeAt` in
// video/derive.ts reads it). The op merges a patch: `at` sets the shared position, `format` + `at`
// sets one format's own (`null` drops it back to the shared one), `formats` replaces the map. A
// Place left with no override and the centre position is unwrapped — no `<Place>` = where the title
// already sits. Pure: no IO.

import MagicString from 'magic-string';

import {
  ASPECT_RE,
  bad,
  ensureCanvasLibImport,
  finish,
  firstIn,
  innerText,
  isFrac,
  jsonProp,
  jsxElements,
  literalProp,
  parseProgram,
  resolveClip,
  setProp,
  tagOf,
} from './jsx.ts';

export type Point = [number, number];
const PLACE = new Set(['Place']);
const CENTRE: Point = [0.5, 0.5];

export interface PlacePatch {
  at?: Point | null;
  format?: string;
  formats?: Record<string, Point> | null;
}

function point(file: string, v: unknown, id: string): Point {
  if (!Array.isArray(v) || v.length !== 2 || !isFrac(v[0]) || !isFrac(v[1]))
    bad(file, 'The position is outside the frame.', id);
  return [(v as number[])[0] as number, (v as number[])[1] as number];
}

function points(file: string, v: unknown, id: string): Record<string, Point> {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    bad(file, 'The formats are not readable.', id);
  const out: Record<string, Point> = {};
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 32) bad(file, 'Too many formats.', id);
  for (const [k, p] of entries) {
    if (!ASPECT_RE.test(k)) bad(file, `“${k}” is not a format (W:H).`, id);
    out[k] = point(file, p, id);
  }
  return out;
}

export function placePatch(file: string, p: Record<string, unknown>, id: string): PlacePatch {
  const out: PlacePatch = {};
  if (p.format !== undefined) {
    if (typeof p.format !== 'string' || !ASPECT_RE.test(p.format))
      bad(file, 'The format is not readable (W:H).', id);
    out.format = p.format as string;
  }
  if (p.at !== undefined) out.at = p.at === null ? null : point(file, p.at, id);
  if (p.formats !== undefined)
    out.formats = p.formats === null ? null : points(file, p.formats, id);
  return out;
}

const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];

export function applyPlace(
  file: string,
  source: string,
  artboard: string | undefined,
  stableId: string,
  hash: string | undefined,
  patch: PlacePatch
): { source: string; placed: boolean } {
  const { clip } = resolveClip(file, source, artboard, stableId, hash);
  const program = parseProgram(file, source);
  const els = jsxElements(program);
  const own = els.find((e) => e.el.start === clip.start)?.el;
  if (!own) bad(file, 'That clip is not on the timeline.', stableId);
  const place = firstIn(els, clip.start, clip.end, PLACE)?.el ?? null;

  let at: Point = CENTRE;
  let formats: Record<string, Point> = {};
  if (place) {
    const a = literalProp(file, place, 'at', stableId);
    if (a !== undefined) at = point(file, a, stableId);
    const f = literalProp(file, place, 'formats', stableId);
    if (f !== undefined) formats = points(file, f, stableId);
  }
  if (patch.formats !== undefined) formats = patch.formats ?? {};
  if (patch.at !== undefined) {
    if (patch.format) {
      if (patch.at === null) delete formats[patch.format];
      else formats[patch.format] = patch.at;
    } else at = patch.at ?? CENTRE;
  }
  const empty = same(at, CENTRE) && Object.keys(formats).length === 0;
  const fText = Object.keys(formats).length ? jsonProp(formats) : null;
  const s = new MagicString(source);
  if (place) {
    if (empty) s.overwrite(place.start, place.end, innerText(source, place));
    else {
      setProp(s, place, 'at', jsonProp(at));
      setProp(s, place, 'formats', fText);
    }
  } else {
    if (empty) return { source, placed: false };
    if (!own.closingElement || tagOf(own) === 'TransitionSeries.Transition')
      bad(file, 'This clip has nothing to place.', stableId);
    const inner = innerText(source, own);
    if (!inner.trim()) bad(file, 'This clip has nothing to place.', stableId);
    s.overwrite(
      own.openingElement.end,
      own.closingElement.start,
      `<Place at=${jsonProp(at)}${fText ? ` formats=${fText}` : ''}>${inner}</Place>`
    );
    ensureCanvasLibImport(s, program, 'Place');
  }
  return { source: finish(file, s, stableId), placed: !empty };
}
