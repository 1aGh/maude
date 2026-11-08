// client/v2/diagnostics/sync-details/unsynced-refs.js — #158: the files a linked canvas uses that will
// not reach the workspace, as Sync details reads them.
//
// `GET /_api/sync/unsynced-refs` answers { linked, syncFiles, canvases, refs[] }; each ref carries the
// canvas, the file, the reason code and two server-written sentences (`detail`: why, `fix`: the way
// out). This module only fetches and groups — the words are the server's, so the panel, the terminal
// (`maude design status`) and the smoke report cannot disagree.

import { cleanName } from './sync-details-model.js';

/** Canvases shown before "and N more" — an issue row each. */
export const UNSYNCED_SHOWN = 5;

/** GET /_api/sync/unsynced-refs → the refs, or [] (not linked, nothing out, unreachable, or unreadable). */
export async function readUnsyncedRefs(fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl('/_api/sync/unsynced-refs', { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json();
    if (j?.linked !== true || !Array.isArray(j.refs)) return [];
    return j.refs.filter(
      (x) =>
        x &&
        typeof x.canvas === 'string' &&
        typeof x.file === 'string' &&
        typeof x.detail === 'string'
    );
  } catch {
    return [];
  }
}

/** "ui/x/Pricing page.tsx" → "Pricing page". */
export function canvasTitle(rel) {
  const name = cleanName(String(rel).split('/').pop() ?? rel, String(rel));
  return name.replace(/\.tsx$/i, '');
}

/** refs → [{ canvas, title, files: [{ file, detail, fix }] }] in the order the server sent them. */
export function groupByCanvas(refs) {
  const by = new Map();
  for (const r of refs) {
    let g = by.get(r.canvas);
    if (!g) {
      g = { canvas: r.canvas, title: canvasTitle(r.canvas), files: [] };
      by.set(r.canvas, g);
    }
    g.files.push({
      file: cleanName(r.file),
      detail: cleanName(r.detail, '', 240),
      fix: cleanName(r.fix ?? '', '', 240),
    });
  }
  return [...by.values()];
}
