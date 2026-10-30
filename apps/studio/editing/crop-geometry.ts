// editing/crop-geometry.ts — S2.15: the arithmetic of crop mode, pure (ed-img: "drag it, or its corners").
//
// A cropped picture is `object-fit: cover` + `object-position: X% Y%` and, past 100 %, `scale(Z)` about the same point
// (edit-ops/crop.ts). Because the scale is about the point the position pins, the picture's rectangle inside its box is
// exactly object-position's rule applied to the zoomed size:
//
//     left = (boxW − pictureW) · X / 100        top = (boxH − pictureH) · Y / 100
//     pictureW = coverW · Z                     (coverW × coverH = the picture at 100 %, big enough to cover the box)
//
// so a drag only ever needs to turn a wanted left / top back into X / Y, and a corner drag a wanted width back into Z.
// Everything is in one unit (screen px); X and Y come out as percentages, Z as a factor, so scale does not matter.

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;

export interface Size {
  w: number;
  h: number;
}
export interface Rect extends Size {
  left: number;
  top: number;
}
export interface Crop {
  zoom: number;
  /** 0–100: the point of the picture that stays put */
  x: number;
  y: number;
}
export type Corner = 'nw' | 'ne' | 'se' | 'sw';

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round = (n: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/** The picture at 100 %: the smallest size with its own ratio that covers the box. */
export function coverSize(box: Size, nat: Size): Size {
  const s = Math.max(box.w / nat.w, box.h / nat.h);
  return { w: nat.w * s, h: nat.h * s };
}

/** The picture's rectangle inside the box (box-relative) for a crop. */
export function pictureRect(box: Size, nat: Size, c: Crop): Rect {
  const base = coverSize(box, nat);
  const w = base.w * c.zoom;
  const h = base.h * c.zoom;
  return { left: ((box.w - w) * c.x) / 100, top: ((box.h - h) * c.y) / 100, w, h };
}

/** X / Y for a wanted left / top of a picture of `size`; an axis with no room to move keeps `keep`. */
export function positionFor(
  box: Size,
  size: Size,
  left: number,
  top: number,
  keep: { x: number; y: number }
): { x: number; y: number } {
  const roomX = box.w - size.w; // ≤ 0 : the picture is wider than the box
  const roomY = box.h - size.h;
  return {
    x: Math.abs(roomX) < 0.01 ? keep.x : round(clamp((left / roomX) * 100, 0, 100), 1),
    y: Math.abs(roomY) < 0.01 ? keep.y : round(clamp((top / roomY) * 100, 0, 100), 1),
  };
}

/** Drag the picture by (dx, dy) screen px. */
export function pan(box: Size, nat: Size, from: Crop, dx: number, dy: number): Crop {
  const r = pictureRect(box, nat, from);
  const p = positionFor(box, r, r.left + dx, r.top + dy, from);
  return { zoom: from.zoom, x: p.x, y: p.y };
}

/** The corner of a rectangle, as a point. */
export function cornerPoint(r: Rect, c: Corner): { x: number; y: number } {
  return {
    x: c === 'nw' || c === 'sw' ? r.left : r.left + r.w,
    y: c === 'nw' || c === 'ne' ? r.top : r.top + r.h,
  };
}

const OPPOSITE: Record<Corner, Corner> = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' };

/**
 * Drag a corner of the picture to (px, py): the opposite corner stays where it is, the picture keeps its ratio, and the
 * zoom stays between 100 % and 800 %. Box-relative coordinates throughout.
 */
export function dragCorner(
  box: Size,
  nat: Size,
  from: Crop,
  corner: Corner,
  px: number,
  py: number
): Crop {
  const base = coverSize(box, nat);
  const r = pictureRect(box, nat, from);
  const fixed = cornerPoint(r, OPPOSITE[corner]);
  // the width the pointer asks for: from the fixed corner, along whichever axis it has travelled further
  const wantW = Math.max(Math.abs(px - fixed.x), (Math.abs(py - fixed.y) * base.w) / base.h);
  const zoom = round(clamp(wantW / base.w, ZOOM_MIN, ZOOM_MAX), 2);
  const w = base.w * zoom;
  const h = base.h * zoom;
  const left = corner === 'nw' || corner === 'sw' ? fixed.x - w : fixed.x;
  const top = corner === 'nw' || corner === 'ne' ? fixed.y - h : fixed.y;
  const p = positionFor(box, { w, h }, left, top, from);
  return { zoom, x: p.x, y: p.y };
}

/** The crop the op takes: zoom to two places, a point to one. */
export const cropParams = (c: Crop): { fit: 'crop'; zoom: number; x: number; y: number } => ({
  fit: 'crop',
  zoom: round(c.zoom, 2),
  x: round(c.x, 1),
  y: round(c.y, 1),
});

/** `object-position` / `scale()` back out of an element's inline style (what the file wrote), for the starting crop. */
export function cropFromStyle(style: { objectPosition?: string; transform?: string }): Crop {
  const pos = /^(-?[\d.]+)%\s+(-?[\d.]+)%$/.exec((style.objectPosition ?? '').trim());
  const scale = /^scale\(([\d.]+)\)$/.exec((style.transform ?? '').trim());
  return {
    zoom: scale ? clamp(Number(scale[1]), ZOOM_MIN, ZOOM_MAX) : 1,
    x: pos ? clamp(Number(pos[1]), 0, 100) : 50,
    y: pos ? clamp(Number(pos[2]), 0, 100) : 50,
  };
}
