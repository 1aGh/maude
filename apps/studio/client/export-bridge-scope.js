// gate-b-c4b — what an export asked over the canvas bridge may name (lead's pick, item 3).
//
// The in-canvas Export dialog runs inside the untrusted canvas frame (DDR-054); the shell runs
// the export with the OPENER's rights. So a bridged export is held to the frame's own canvas: the
// "This canvas" / "Selection" scopes, with the canvas pinned to the active one. Folder and Whole
// project (and another canvas) stay reachable from the shell's own Export sheet only. The same
// rule answers the dialog's Recent tab: only the active canvas's own exports.

const strip = (activePath, designRel) => {
  const pre = `${String(designRel || '.design').replace(/^\/+|\/+$/g, '')}/`;
  return activePath.startsWith(pre) ? activePath.slice(pre.length) : activePath;
};

/** v1 scopes that render ONE canvas (or part of it); `project-raw` is the Folder / Whole-project zip. */
const V1_CANVAS_SCOPES = new Set(['canvas-whole', 'selection-bounds', 'selection', 'artboard']);
const V2_CANVAS_SCOPES = new Set(['canvas', 'selection']);
const REFUSED = Object.freeze({
  ok: false,
  error:
    'From here you can export this canvas. To export a folder or the whole project, use Export in the toolbar.',
});

/**
 * The payload the shell may send for a bridged export, or a refusal. Never mutates `payload`.
 * @returns {{ ok: true, payload: object } | { ok: false, error: string }}
 */
export function bridgedExportPayload(payload, activePath, designRel) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return REFUSED;
  if (typeof activePath !== 'string' || !activePath) return REFUSED;
  if (payload.v === 2) {
    const spec = payload.spec;
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return REFUSED;
    if (!V2_CANVAS_SCOPES.has(spec.scope) || spec.folder !== undefined) return REFUSED;
    return {
      ok: true,
      payload: { ...payload, spec: { ...spec, canvas: strip(activePath, designRel) } },
    };
  }
  if (!V1_CANVAS_SCOPES.has(payload.scope)) return REFUSED;
  const options =
    payload.options && typeof payload.options === 'object' && !Array.isArray(payload.options)
      ? { ...payload.options }
      : {};
  delete options.folder;
  options.canvasFile = activePath;
  return { ok: true, payload: { ...payload, options } };
}

/** The Recent-tab entries the frame may see: exports of the active canvas only. */
export function bridgedHistory(history, activePath, designRel) {
  if (!Array.isArray(history) || typeof activePath !== 'string' || !activePath) return [];
  const rel = strip(activePath, designRel);
  return history.filter((h) => {
    const o = h && typeof h === 'object' ? h.options : null;
    if (!o || typeof o !== 'object') return false;
    return (
      o.canvasFile === activePath ||
      o.canvas === rel ||
      o.canvas === activePath ||
      (o.spec && typeof o.spec === 'object' && o.spec.canvas === rel)
    );
  });
}
