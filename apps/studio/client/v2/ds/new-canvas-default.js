// client/v2/ds/new-canvas-default.js — S10.13: which design system a NEW canvas starts on (13 · ds-multi-menu).
//
//   "⌘N uses the default — inside a folder whose canvases all use one system, that one. A mixed folder falls back
//    to the default." (CONTRACT § Several systems in one project)
//
// Pure: the folder, the index's `canvasDesignSystems` (canvas → system, from /_index-data) and the project's
// systems in. The server validates the name it is sent (api.ts `createCanvas`: a name it does not hold falls back
// to the default), so this is a hint the person can see, never a place a rule could be bypassed.

const strip = (p, designRel) => {
  let s = String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  const root = String(designRel || '.design').replace(/^\/+|\/+$/g, '');
  if (s === root) return '';
  if (s.startsWith(`${root}/`)) s = s.slice(root.length + 1);
  return s;
};

/** The project's default system: the configured one when it exists, else the first. */
export function defaultSystemName(designSystems, defaultDs) {
  const list = Array.isArray(designSystems) ? designSystems : [];
  if (defaultDs && list.some((d) => d?.name === defaultDs)) return defaultDs;
  return list[0]?.name ?? null;
}

/** The folder a canvas path sits in (design-root-relative), '' for one at the root of the design root. */
export function folderOfCanvas(path, designRel = '.design') {
  const rel = strip(path, designRel);
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

/**
 * @param {{ folder?: string | null, canvasDesignSystems?: Record<string, string>,
 *           designSystems?: { name: string, path?: string }[], defaultDs?: string | null,
 *           designRel?: string }} a
 * @returns {string | null} the system a new canvas in `folder` follows (null = the project has none)
 */
export function newCanvasDesignSystem({
  folder = null,
  canvasDesignSystems = {},
  designSystems = [],
  defaultDs = null,
  designRel = '.design',
} = {}) {
  const fallback = defaultSystemName(designSystems, defaultDs);
  const dir = strip(folder, designRel);
  if (!dir) return fallback;
  const owned = (Array.isArray(designSystems) ? designSystems : [])
    .map((d) => strip(d?.path, designRel))
    .filter(Boolean);
  const names = new Set();
  for (const [file, name] of Object.entries(canvasDesignSystems ?? {})) {
    const rel = strip(file, designRel);
    if (!rel.startsWith(`${dir}/`) || !rel.endsWith('.tsx')) continue;
    // a system's own folder (its Design system canvas, its specimens) is not a canvas the folder "uses"
    if (owned.some((o) => rel === o || rel.startsWith(`${o}/`))) continue;
    if (typeof name === 'string' && name) names.add(name);
  }
  if (names.size !== 1) return fallback;
  const only = [...names][0];
  return (Array.isArray(designSystems) ? designSystems : []).some((d) => d?.name === only)
    ? only
    : fallback;
}

// ── the shell's answer for a canvas made from ⌘N ────────────────────────────────────────────────────────────
// Three doors make a blank canvas (the key, the menu row, ⌘K) and the first-draft / intent doors reuse the same
// function (client/v2/create/new-canvas.js). The shell registers ONE provider that knows the open canvas's
// folder and the index; the function asks it, so no door can forget.
let provider = null;

/** @returns {() => void} unregister */
export function setNewCanvasDsProvider(fn) {
  provider = typeof fn === 'function' ? fn : null;
  return () => {
    if (provider === fn) provider = null;
  };
}

/** The system a canvas made now should start on, or null (the project has one system, or no shell answered). */
export function currentNewCanvasDs() {
  try {
    return provider?.() ?? null;
  } catch {
    return null;
  }
}
