// editing/asset-drag.ts — S2.15: what an Assets tile carries when it is dragged onto the canvas.
//
// The Assets tab (shell) starts the drag; the canvas (an untrusted origin, DDR-054) receives the drop. The payload is a
// path, never bytes: `{asset: 'assets/<flat name>', w?, h?}` under its own MIME type. The canvas does NOT trust it — it
// asks for `image.place`, and the server re-checks the path against `assets/<flat name>` (edit-ops/image-fit.ts).
// Pure: no DOM, no React, no server import (the canvas bundle imports this).

export const ASSET_DRAG_MIME = 'application/x-maude-asset';

/** The same allowlist the server applies: `assets/<flat name>`, no `..`, no scheme. */
const ASSET_RE = /^assets\/[A-Za-z0-9._-]+$/;
const MAX_PX = 100_000;

export interface AssetDrag {
  asset: string;
  /** natural size, when the tile knew it */
  w?: number;
  h?: number;
}

export const isAssetPath = (v: unknown): v is string =>
  typeof v === 'string' && ASSET_RE.test(v) && !v.includes('..');

/** The string a tile puts under {@link ASSET_DRAG_MIME}. */
export function assetDragData(a: AssetDrag): string {
  const out: AssetDrag = { asset: a.asset };
  if (
    typeof a.w === 'number' &&
    typeof a.h === 'number' &&
    a.w > 0 &&
    a.h > 0 &&
    a.w <= MAX_PX &&
    a.h <= MAX_PX
  ) {
    out.w = Math.round(a.w);
    out.h = Math.round(a.h);
  }
  return JSON.stringify(out);
}

/** The drag a drop carried, or null for anything that is not a well-formed asset (a file, a link, a forged payload). */
export function parseAssetDrag(raw: string | null | undefined): AssetDrag | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!isAssetPath(o.asset)) return null;
  const out: AssetDrag = { asset: o.asset };
  if (
    typeof o.w === 'number' &&
    typeof o.h === 'number' &&
    Number.isFinite(o.w) &&
    Number.isFinite(o.h) &&
    o.w > 0 &&
    o.h > 0 &&
    o.w <= MAX_PX &&
    o.h <= MAX_PX
  ) {
    out.w = Math.round(o.w);
    out.h = Math.round(o.h);
  }
  return out;
}

/** Does a drag in flight carry an asset? (Readable during dragover: only the type list is.) */
export const dragHasAsset = (
  types: readonly string[] | DOMStringList | null | undefined
): boolean => !!types && Array.from(types as ArrayLike<string>).includes(ASSET_DRAG_MIME);
