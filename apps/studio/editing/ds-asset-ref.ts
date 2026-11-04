// editing/ds-asset-ref.ts — a design system's own picture as a canvas reference (2.0.2, the Assets tab's
// "Design system" source).
//
// A project upload is `assets/<flat name>` (content-addressed, edit-ops/image-fit.ts `ASSET_SRC_RE`). A design
// system keeps its library in folders under `system/<ds>/assets/` (photos-cut/, logos/, …), so its pictures are
// placed by a LITERAL, root-absolute designRoot path:
//
//   src="/.design/system/alligators/assets/photos-cut/IMG_2231.jpg"
//
// — the form a DS's own specimens already write (`system/maude-v2/preview/textures.tsx`) and the one the canvas
// build rewrites a DS stylesheet's `url(../system/<ds>/assets/…)` into (canvas-build.ts). It is a static string the
// canvas closure can read (access/closure.ts) and the canvas origin serves through its designRel lane.
//
// Pure: no DOM, no server import (the shell and the canvas bundle import this; the edit op re-checks on the server
// against ITS designRel and the disk).

/** The pictures and clips a DS reference may name — what the canvas origin serves and `image.place` writes. */
export const DS_PLACEABLE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|mp4|mov|m4v|webm)$/i;

/**
 * One path segment a reference may carry. Never empty, `.`/`..`, a runtime (`_…`) or hidden (`.…`) name, and none of
 * the characters that would change what a JSX attribute, a CSS `url("…")` or a URL means: quotes, `<>{}`, `\`, `&`
 * (a JSX entity), `%` (an escape), `?`/`#` (a query, a fragment), or a control character.
 */
const SEGMENT_RE = /^(?![._])[^/"'`<>{}\\&%?#]{1,200}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const safeSegment = (s: string) => SEGMENT_RE.test(s) && !CONTROL_RE.test(s);

const MAX_REF = 600;

/** `system/<ds>/assets/<…>/<name.ext>` (designRoot-relative) when every segment is safe, else null. */
export function dsAssetRel(rel: unknown): string | null {
  if (typeof rel !== 'string' || rel.length > MAX_REF) return null;
  const parts = rel.split('/');
  if (parts.length < 4 || parts[0] !== 'system' || parts[2] !== 'assets') return null;
  if (!safeSegment(parts[1] as string)) return null;
  if (!parts.slice(3).every(safeSegment)) return null;
  return DS_PLACEABLE_EXT_RE.test(rel) ? rel : null;
}

/** The literal `src` a placed DS picture gets: `/<designRel>/system/<ds>/assets/…`, or null when it may not be one. */
export function dsAssetSrc(rel: unknown, designRel: string): string | null {
  const r = dsAssetRel(rel);
  const d = String(designRel ?? '').replace(/^\/+|\/+$/g, '');
  if (!r || !d || d.split('/').some((s) => !s || s === '..' || s === '.')) return null;
  return `/${d}/${r}`;
}

/**
 * The designRoot-relative path a literal DS reference names, or null. `designRel` given: the prefix must be exactly it
 * (the server's check). Without it (the shell's drag, which only gates shape): any one-or-more-segment prefix.
 */
export function dsAssetRelOfSrc(src: unknown, designRel?: string): string | null {
  if (typeof src !== 'string' || !src.startsWith('/') || src.length > MAX_REF) return null;
  const at = src.indexOf('/system/');
  if (at <= 0) return null;
  const prefix = src.slice(1, at);
  if (prefix.split('/').some((s) => !s || s === '..' || s === '.')) return null;
  if (designRel !== undefined && prefix !== String(designRel).replace(/^\/+|\/+$/g, ''))
    return null;
  return dsAssetRel(src.slice(at + 1));
}

/** A literal DS reference by shape (no designRel known): what the shell lets a tile drag carry. */
export const isDsAssetSrc = (v: unknown): v is string => dsAssetRelOfSrc(v) !== null;
