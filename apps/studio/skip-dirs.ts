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
