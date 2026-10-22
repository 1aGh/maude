// Directories that never hold user-facing canvases. One source for the tree
// (`api.ts`), the external-canvas watcher (`canvas-list-watch.ts`) and the
// project index (`index/extract.ts`). (activity.ts still carries its own
// historical mirror.) A leaf module on purpose: the `maude design index`
// helper imports the index, and everything a helper imports is staged into the
// packaged app (apps/desktop/scripts/helper-deps.mjs) — reaching this list
// through api.ts pulled the whole studio API into the helper.
export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'build',
  '.expo',
  'coverage',
  'dev-server',
  '_history',
]);

/** Dot-directories a canvas group may still hold canvases under. */
export const HIDDEN_OK = new Set(['.ai', '.claude', '.design']);

/**
 * gate-b-c4g — THE canvas predicate on a path alone (`index/extract.ts` `listCanvases` /
 * `isCanvasRel`, and the access closure): a `.tsx` under the first canvas group (a
 * designRoot-relative path) it falls in, with no `_`-prefixed, skipped or hidden segment below
 * that group. Whether the file exists is the caller's to ask. Pure — the hub loads it under Node.
 */
export function isCanvasRelInGroups(groups: readonly string[], rel: string): boolean {
  if (!rel.endsWith('.tsx')) return false;
  const base = groups
    .map((g) => g.replace(/\/+$/, ''))
    .find((g) => g !== '' && rel.startsWith(`${g}/`));
  if (base === undefined) return false;
  for (const seg of rel.slice(base.length + 1).split('/')) {
    if (seg.startsWith('.') && !HIDDEN_OK.has(seg)) return false;
    if (seg.startsWith('_') || SKIP_DIRS.has(seg)) return false;
  }
  return true;
}
