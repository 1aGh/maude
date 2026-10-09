// Pure grouping helpers for the Changes panel (GitPanel.jsx) — framework-free so
// they unit-test without a DOM. DDR-115 follow-up: group changed files by parent
// canvas + its supporting sidecars (same-stem `.meta.json`, slug-matched
// `.annotations.json`), mirroring the server's `expandSidecars` notion of "travels
// with the canvas" so the visual grouping is honest with what a unit commits.

export const CANVAS_RE = /\.(tsx|html)$/i;
export const META_RE = /\.meta\.json$/i;
export const ANNOT_RE = /\.annotations\.(?:svg|json)$/i;

/** Display name for a file (last path segment, sidecar/canvas extension stripped). */
export function baseName(p) {
  const s = (String(p).split('/').pop() || String(p)).replace(ANNOT_RE, '').replace(META_RE, '');
  return s.replace(/\.(tsx|html|css|svg|json)$/i, '');
}

/** Friendly label for a collapsed supporting file under a canvas. */
export function supportLabel(p) {
  if (META_RE.test(p)) return 'Layout & settings';
  if (ANNOT_RE.test(p)) return 'Annotations';
  return baseName(p);
}

export function stripDesignRel(p, designRel) {
  const s = String(p).replace(/^\/+|\/+$/g, '');
  const prefix = `${(designRel || '.design').replace(/^\/+|\/+$/g, '')}/`;
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

/** Mirror api.ts `fileSlug`: repo-relative canvas path → annotation slug, so the
 *  slug-named `<slug>.annotations.svg` (which is NOT a same-stem sibling) can be
 *  attached to its parent canvas. */
export function canvasSlug(p, designRel) {
  return stripDesignRel(p, designRel)
    .replace(/\//g, '-')
    .replace(/\s+/g, '_')
    .replace(CANVAS_RE, '')
    .replace(/^\.+/, '')
    .toLowerCase();
}

/**
 * Group changed files into canvas "units" — a parent canvas + its supporting
 * sidecars. Files with no parent canvas in the changeset become standalone
 * "other" units (config, DS tokens, an orphan sidecar).
 *
 * @param {{path: string, status: string}[]} files
 * @param {string} designRel
 * @returns {{ canvasUnits: Unit[], otherUnits: Unit[] }}
 *   where Unit = { key, kind: 'canvas'|'other', primary, supporting: file[] }
 */
export function buildUnits(files, designRel) {
  const canvases = files.filter((f) => CANVAS_RE.test(f.path));
  const canvasByBase = new Map(); // base path (no ext) → canvas file
  const canvasBySlug = new Map(); // annotation slug → canvas file
  for (const c of canvases) {
    canvasByBase.set(c.path.replace(CANVAS_RE, ''), c);
    canvasBySlug.set(canvasSlug(c.path, designRel), c);
  }
  const supporting = new Map(); // canvas.path → sidecar[]
  const consumed = new Set(); // sidecar paths attached to a canvas
  const attach = (canvas, f) => {
    const arr = supporting.get(canvas.path);
    if (arr) arr.push(f);
    else supporting.set(canvas.path, [f]);
    consumed.add(f.path);
  };
  for (const f of files) {
    if (META_RE.test(f.path)) {
      const c = canvasByBase.get(f.path.replace(META_RE, ''));
      if (c) attach(c, f);
    } else if (ANNOT_RE.test(f.path)) {
      const c = canvasBySlug.get(
        stripDesignRel(f.path, designRel).replace(ANNOT_RE, '').toLowerCase()
      );
      if (c) attach(c, f);
    }
  }
  const byName = (a, b) => baseName(a.primary.path).localeCompare(baseName(b.primary.path));
  const canvasUnits = canvases
    .map((c) => ({
      key: c.path,
      kind: 'canvas',
      primary: c,
      supporting: supporting.get(c.path) ?? [],
    }))
    .sort(byName);
  const otherUnits = files
    .filter((f) => !CANVAS_RE.test(f.path) && !consumed.has(f.path))
    .map((f) => ({ key: f.path, kind: 'other', primary: f, supporting: [] }))
    .sort(byName);
  return { canvasUnits, otherUnits };
}
