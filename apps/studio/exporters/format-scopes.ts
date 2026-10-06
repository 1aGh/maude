// format-scopes.ts — which export scopes a format can actually render.
//
// DDR-231 Phase 2 T4. This map existed in THREE places and was checked in
// none of them: `client/app.jsx` (`EXPORT_VALID_SCOPES`, the shell dialog),
// `export-dialog.tsx` (`VALID_SCOPES_PER_FORMAT`, the in-canvas dialog) — and
// nowhere on the server, which accepted whatever pair a client sent.
//
// That gap is the "PDF nefunguje vubec — invalid render job" the first live
// cloud export hit, reproduced locally: `POST /_api/export-jobs
// {format:'pdf', scope:'project-raw'}` is accepted, `resolveScope` returns a
// `file-tree` target (correct for that scope — it IS the whole project), and
// the render service's `validBody` rejects it with an opaque `invalid render
// job` because a file-tree target names repo paths that process must never
// read. Every layer behaved as specified; the pair was never legal, and
// nothing said so.
//
// The two dialogs keep the scope pickers honest for a user who is looking;
// this module is what makes the pair unrepresentable for one who is not (a
// stale scope carried across a format switch, a re-run of a history entry, a
// context-menu hint, a direct POST).
//
// PURE DATA, NO IMPORTS — `http.ts` (Bun), `apps/render/server.ts` (Bun) and
// both browser bundles all consume it, so it must not reach for `node:*`.

/** Every format the export pipeline knows. Mirrors `index.ts`'s `Format`. */
export type ExportFormatName =
  | 'png'
  | 'pdf'
  | 'svg'
  | 'html'
  | 'pptx'
  | 'canva'
  | 'zip'
  | 'mp4'
  | 'webm'
  | 'gif';

/** Mirrors `scope.ts`'s `Scope`. */
export type ExportScopeName =
  | 'selection'
  | 'artboard'
  | 'canvas-as-separate'
  | 'canvas-whole'
  | 'selection-bounds'
  | 'project-raw';

/**
 * Scopes each format accepts, in the order a picker should offer them — the
 * FIRST entry is that format's default.
 *
 * The shape rules behind the table:
 *   - `project-raw` resolves to a `file-tree` target, which only `zip`
 *     consumes; every rendering format must therefore exclude it.
 *   - `pptx` is a deck: one slide per artboard, so canvas-wide only.
 *   - video renders one temporal artboard, so `artboard` only.
 *   - `canvas-whole` / `selection-bounds` capture a world-plane REGION as one
 *     image or page (issue #125) — raster/page formats only.
 *   - `html` has no meaningful "selection" unit (it emits a page per artboard).
 */
export const VALID_SCOPES_BY_FORMAT: Readonly<
  Record<ExportFormatName, readonly ExportScopeName[]>
> = Object.freeze({
  png: ['selection', 'artboard', 'canvas-as-separate', 'canvas-whole', 'selection-bounds'],
  pdf: ['selection', 'artboard', 'canvas-as-separate', 'canvas-whole', 'selection-bounds'],
  svg: ['selection', 'artboard', 'canvas-as-separate'],
  html: ['artboard', 'canvas-as-separate'],
  pptx: ['canvas-as-separate'],
  canva: ['canvas-as-separate'],
  zip: ['project-raw'],
  mp4: ['artboard'],
  webm: ['artboard'],
  gif: ['artboard'],
});

/** The scope a picker should select when the format changes. */
export function defaultScopeForFormat(format: string): ExportScopeName {
  return VALID_SCOPES_BY_FORMAT[format as ExportFormatName]?.[0] ?? 'artboard';
}

export function validScopesForFormat(format: string): readonly ExportScopeName[] {
  return VALID_SCOPES_BY_FORMAT[format as ExportFormatName] ?? ['artboard'];
}

export function isScopeValidForFormat(format: string, scope: string): boolean {
  return validScopesForFormat(format).includes(scope as ExportScopeName);
}

/**
 * The refusal a caller sees for an incoherent pair. Written for a person and
 * naming the way out, because it surfaces in the export dialog — the old
 * `invalid render job` named neither the field nor the remedy.
 */
export function scopeRefusalMessage(format: string, scope: string): string {
  const offered = validScopesForFormat(format).join(', ');
  return `${format.toUpperCase()} can't export the "${scope}" scope — it supports: ${offered}.`;
}
