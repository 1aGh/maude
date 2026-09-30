// tree-state.ts — the Files panel's remembered disclosure (issue #124).
//
// `dirs` are the repo-relative folder paths the user left expanded (the same
// `dirPath` the tree rows carry); `sections` maps a section label (PROJECT /
// UI CANVASES / …) to open/closed. Anything absent is CLOSED — that default is
// the point of the issue. Stored per project + per member by api.ts under
// `_canvas-state/`; this module only owns the shape and its bounds, so a
// hostile or corrupt body can neither grow the file without limit nor smuggle
// a non-string into a path the client later splits.

export interface TreeState {
  dirs: string[];
  sections: Record<string, boolean>;
}

export const TREE_STATE_MAX_DIRS = 2000;
export const TREE_STATE_MAX_PATH = 1024;
export const TREE_STATE_MAX_SECTIONS = 64;
const MAX_LABEL = 128;

/** Coerce anything into a bounded, de-duplicated TreeState. Never throws. */
export function normalizeTreeState(raw: unknown): TreeState {
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const dirs = new Set<string>();
  if (Array.isArray(o.dirs)) {
    for (const d of o.dirs) {
      if (dirs.size >= TREE_STATE_MAX_DIRS) break;
      if (typeof d !== 'string' || !d || d.length > TREE_STATE_MAX_PATH || d.includes('\0'))
        continue;
      dirs.add(d);
    }
  }
  const sections: Record<string, boolean> = {};
  if (o.sections && typeof o.sections === 'object' && !Array.isArray(o.sections)) {
    let n = 0;
    for (const [k, v] of Object.entries(o.sections as Record<string, unknown>)) {
      if (n >= TREE_STATE_MAX_SECTIONS) break;
      if (typeof v !== 'boolean' || !k || k.length > MAX_LABEL || k === '__proto__') continue;
      sections[k] = v;
      n++;
    }
  }
  return { dirs: [...dirs].sort(), sections };
}
