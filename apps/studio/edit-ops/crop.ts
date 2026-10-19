// edit-ops/crop.ts — `image.crop` (S2.15, ed-img: Fill · Fit · Crop · Tile and the Zoom row).
//
// One op for the inspector's Fit control, its Zoom row and the canvas crop mode (double-click → drag → ↵):
//
//   params { fit?: 'fill' | 'fit' | 'crop' | 'tile', zoom?: 1–8, x?: 0–100, y?: 0–100 }
//
//   Fill   object-fit: cover                              (the picture fills the box, cropped to fit)
//   Fit    object-fit: contain                            (all of it, letterboxed)
//   Crop   object-fit: cover + object-position: X% Y% — the point of the picture that stays put — and, past 100 %,
//          transform: scale(Z) about the same point (transform-origin: X% Y%); `data-image-fit="crop"` says "this one
//          was cropped by hand" so Fill and an uncropped Crop can be told apart; the frame gets `overflow: hidden`
//          so the zoom is clipped to it.
//   Tile   the `<img>` becomes `<div role="img" data-image-tile="assets/…" data-image-fit="tile">` with the same box and
//          background-image / background-repeat: repeat. Fill / Fit / Crop turn it back into an `<img>`.
//
// `zoom`, `x`, `y` alone keep the crop that is there (a picture that was not cropped becomes Crop). Edits belong to this
// use only — they are attributes of this one element, never of the asset. Plain CSS and one inert data attribute: a v1
// peer renders it as it always did. One request = one write = one undo.
//
// Refused (nothing written): a target that is not a picture, a fit that is not one of the four, a zoom outside 1–8 or a
// point outside 0–100, a style or source the file computes, a tile that holds children.
//
// Same result by hand: `canvas-tsx.md` § "Place, replace and crop an image".

import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';

import { applyEdit, applyRemove, readAttributeState } from '../canvas-edit.ts';
import { type IdElement, walkIdElements } from '../element-ids.ts';
import { refuse, writeStyle } from './constraints.ts';
import { elementOf, isPicture, stampElement, walkOrRefuse } from './image-fit.ts';
import type { EditOp, ElementRef, ResolvedEditOp } from './types.ts';
import type { CssPatch } from './words-css.ts';

export const FITS = ['fill', 'fit', 'crop', 'tile'] as const;
export type Fit = (typeof FITS)[number];
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;

export interface CropState {
  fit: Fit;
  zoom: number;
  x: number;
  y: number;
}

const FIT_ATTR = 'data-image-fit';
const TILE_ATTR = 'data-image-tile';

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (n: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

// ── reading what the file says ─────────────────────────────────────────────────────────────────

const literal = (
  file: string,
  source: string,
  id: string,
  attr: string,
  occurrence?: number
): string | null => {
  const s = readAttributeState(file, source, id, attr, occurrence);
  return s.kind === 'literal' ? s.value.trim() : null;
};

/** The fit, zoom and focal point a picture wears today (literal declarations only; defaults otherwise). */
export function cropStateOf(source: string, file: string, id: string): CropState {
  const walk = walkIdElements(source, file);
  const el = walk.ok ? walk.elements.find((e) => e.id === id) : undefined;
  const out: CropState = { fit: 'fill', zoom: 1, x: 50, y: 50 };
  if (!el) return out;
  if (el.tag === 'div' && el.attrs.some(([k]) => k === TILE_ATTR)) return { ...out, fit: 'tile' };
  const marker = literal(file, source, id, FIT_ATTR);
  const objectFit = literal(file, source, id, 'style.objectFit');
  if (objectFit === 'contain') return { ...out, fit: 'fit' };
  if (marker !== 'crop') return out;
  const pos = /^(-?[\d.]+)%\s+(-?[\d.]+)%$/.exec(
    literal(file, source, id, 'style.objectPosition') ?? ''
  );
  const scale = /^scale\(([\d.]+)\)$/.exec(literal(file, source, id, 'style.transform') ?? '');
  return {
    fit: 'crop',
    zoom: scale ? Number(scale[1]) : 1,
    x: pos ? Number(pos[1]) : 50,
    y: pos ? Number(pos[2]) : 50,
  };
}

// ── params ─────────────────────────────────────────────────────────────────────────────────────

interface CropParams {
  fit: Fit | null;
  zoom: number | null;
  x: number | null;
  y: number | null;
}

function cropParams(req: ResolvedEditOp): CropParams {
  const p = req.params;
  let fit: Fit | null = null;
  if (p.fit !== undefined) {
    if (typeof p.fit !== 'string' || !(FITS as readonly string[]).includes(p.fit))
      return refuse(req, 'Pick Fill, Fit, Crop or Tile.');
    fit = p.fit as Fit;
  }
  let zoom: number | null = null;
  if (p.zoom !== undefined) {
    if (!num(p.zoom) || p.zoom < ZOOM_MIN || p.zoom > ZOOM_MAX)
      return refuse(req, 'Zoom is between 100 % and 800 %.');
    zoom = round(p.zoom, 2);
  }
  const point = (v: unknown): number | null => {
    if (v === undefined) return null;
    if (!num(v) || v < 0 || v > 100) return refuse(req, 'Keep the crop inside the picture.');
    return round(v, 1);
  };
  const x = point(p.x);
  const y = point(p.y);
  if (fit === null && zoom === null && x === null && y === null)
    return refuse(req, 'Say how to fit the picture.');
  return { fit, zoom, x, y };
}

// ── Tile <-> <img> ─────────────────────────────────────────────────────────────────────────────

function openingAt(source: string, file: string, start: number): any {
  const parsed = parseSync(file.endsWith('.tsx') ? file : `${file}.tsx`, source, {
    sourceType: 'module',
  });
  let hit: any = null;
  const visit = (n: any): void => {
    if (hit || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const c of n) visit(c);
      return;
    }
    if (n.type === 'JSXElement' && n.start === start) {
      hit = n.openingElement;
      return;
    }
    for (const k of Object.keys(n)) if (k !== 'loc' && k !== 'range') visit(n[k]);
  };
  visit(parsed.program);
  return hit;
}

const attrName = (a: any): string => (a?.type === 'JSXAttribute' ? String(a.name?.name ?? '') : '');
const attrStr = (a: any): string | null =>
  a?.value && (a.value.type === 'Literal' || a.value.type === 'StringLiteral')
    ? String(a.value.value)
    : null;
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Rewrite the opening tag: new tag name, some attributes out, some in. Self-closing only. */
function reTag(
  source: string,
  req: ResolvedEditOp,
  el: IdElement,
  to: 'img' | 'div',
  drop: ReadonlySet<string>,
  add: (read: Map<string, string | null>) => string
): string {
  const opening = openingAt(source, req.file, el.start);
  if (!opening || !opening.selfClosing)
    return refuse(req, 'That holds something inside it; take it out first.', el.id ?? undefined);
  const read = new Map<string, string | null>();
  const s = new MagicString(source);
  s.overwrite(opening.name.start, opening.name.end, to);
  for (const a of opening.attributes as any[]) {
    const n = attrName(a);
    if (!n) continue;
    read.set(n, attrStr(a));
    if (drop.has(n)) {
      let from = a.start as number;
      while (from > 0 && /\s/.test(source[from - 1] as string)) from--;
      s.remove(from, a.end);
    }
  }
  // after the last attribute, before the ` />`
  let at = opening.end - 2;
  if (source[at - 1] === ' ') at -= 1;
  s.appendLeft(at, add(read));
  return s.toString();
}

// ── the parent clips the zoom ──────────────────────────────────────────────────────────────────

function clipParent(source: string, req: ResolvedEditOp, id: string, artboard: string): string {
  const walk = walkOrRefuse(source, req);
  const el = walk.elements.find((e) => e.id === id);
  const parent = el && el.parent >= 0 ? walk.elements[el.parent] : undefined;
  if (!parent || !/^[a-z]/.test(parent.tag)) return source;
  const stamped = stampElement(source, req, parent);
  const ref: ElementRef = { artboard, element: stamped.id };
  const now = literal(req.file, stamped.source, ref.element, 'style.overflow');
  if (now === 'hidden' || now === 'clip') return stamped.source;
  return writeStyle(stamped.source, req, ref, { overflow: 'hidden' });
}

// ── the op ─────────────────────────────────────────────────────────────────────────────────────

// camelCase, like every style a canvas writes (React's own spelling)
const RESET: CssPatch = { objectPosition: null, transform: null, transformOrigin: null };
const BACKGROUND: CssPatch = {
  backgroundImage: null,
  backgroundRepeat: null,
  backgroundSize: null,
};

export const imageCrop: EditOp = {
  id: 'image.crop',
  apply(source, req) {
    const t = req.targets[0];
    if (!t) return refuse(req, 'Select a picture first.');
    const params = cropParams(req);
    const walk = walkOrRefuse(source, req);
    const el = elementOf(walk, t);
    if (!el || !isPicture(el)) return refuse(req, 'That is not a picture.', t.element);
    if (el.locked) return refuse(req, 'That picture is locked; unlock it first.', t.element);
    const now = cropStateOf(source, req.file, t.element);
    // what is asked for, on top of what the file says
    const fit: Fit = params.fit ?? (now.fit === 'crop' || now.fit === 'tile' ? now.fit : 'crop');
    const next: CropState = {
      fit,
      zoom: params.zoom ?? (now.fit === 'crop' ? now.zoom : 1),
      x: params.x ?? (now.fit === 'crop' ? now.x : 50),
      y: params.y ?? (now.fit === 'crop' ? now.y : 50),
    };
    if (fit === 'tile' && el.tag === 'div') return { source };
    let out = source;

    // out of a tile, back into a picture
    if (el.tag === 'div' && fit !== 'tile') {
      const asset = literal(req.file, out, t.element, TILE_ATTR);
      if (!asset)
        return refuse(req, 'That picture is chosen by the code; change it there.', t.element);
      const alt = literal(req.file, out, t.element, 'aria-label') ?? '';
      out = reTag(
        out,
        req,
        el,
        'img',
        new Set(['role', 'aria-label', 'aria-hidden', TILE_ATTR, FIT_ATTR]),
        () => ` src="${esc(asset)}" alt="${esc(alt)}"`
      );
      out = writeStyle(out, req, t, BACKGROUND);
    }

    if (fit === 'tile') {
      const asset = literal(req.file, out, t.element, 'src');
      if (!asset)
        return refuse(req, 'That picture is chosen by the code; change it there.', t.element);
      const alt = literal(req.file, out, t.element, 'alt') ?? '';
      out = reTag(
        out,
        req,
        el,
        'div',
        new Set(['src', 'alt', FIT_ATTR]),
        () =>
          `${alt ? ` role="img" aria-label="${esc(alt)}"` : ' role="img" aria-hidden="true"'} ${TILE_ATTR}="${esc(asset)}" ${FIT_ATTR}="tile"`
      );
      out = writeStyle(out, req, t, {
        objectFit: null,
        ...RESET,
        backgroundImage: `url("${asset}")`,
        backgroundRepeat: 'repeat',
        backgroundSize: 'auto',
      });
      return { source: out };
    }

    if (fit === 'fill' || fit === 'fit') {
      out = writeStyle(out, req, t, { objectFit: fit === 'fit' ? 'contain' : 'cover', ...RESET });
      if (readAttributeState(req.file, out, t.element, FIT_ATTR).kind !== 'absent')
        out = applyRemove(req.file, out, t.element, FIT_ATTR).source;
      return { source: out };
    }

    // crop
    const patch: CssPatch = {
      objectFit: 'cover',
      objectPosition: `${next.x}% ${next.y}%`,
      transform: next.zoom > 1 ? `scale(${next.zoom})` : null,
      transformOrigin: next.zoom > 1 ? `${next.x}% ${next.y}%` : null,
    };
    out = writeStyle(out, req, t, patch);
    if (
      readAttributeState(req.file, out, t.element, FIT_ATTR).kind === 'absent' ||
      literal(req.file, out, t.element, FIT_ATTR) !== 'crop'
    )
      out = applyEdit(req.file, out, t.element, FIT_ATTR, 'crop').source;
    if (next.zoom > 1) out = clipParent(out, req, t.element, t.artboard);
    return { source: out };
  },
};
