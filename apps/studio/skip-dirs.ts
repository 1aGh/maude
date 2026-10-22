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

/** The `newComponentDir` a config that names none gets (context.ts DEFAULT_CONFIG). */
export const DEFAULT_COMPONENT_DIR = 'ui/components';

/**
 * gate-b-c4j (M1) — THE component predicate on a path alone (designRoot-relative): a `.tsx` under
 * the config's `newComponentDir`, under any directory named `components`, or under `system/**`
 * outside `preview/` and `ui_kits/` — except the design-system board `design-system.tsx`, a canvas.
 * A component is a module a canvas imports, never a canvas: the index lists none, and a frame's
 * closure (access/closure.ts) admits one through an import whoever opens it. Pure — the hub loads
 * it under Node through the closure.
 */
export function isComponentRel(rel: string, componentDir?: string | null): boolean {
  if (!/\.tsx$/i.test(rel)) return false;
  const segs = rel.split('/');
  const dirs = segs.slice(0, -1);
  if (dirs.includes('components')) return true;
  const dir = String(componentDir || DEFAULT_COMPONENT_DIR).replace(/^\.?\/+|\/+$/g, '');
  if (dir !== '' && rel.startsWith(`${dir}/`)) return true;
  return (
    segs[0] === 'system' &&
    !dirs.includes('preview') &&
    !dirs.includes('ui_kits') &&
    segs[segs.length - 1] !== 'design-system.tsx'
  );
}

/**
 * gate-b-c4g — THE canvas predicate on a path alone (`index/extract.ts` `listCanvases` /
 * `isCanvasRel`, and the access closure): a `.tsx` under the first canvas group (a
 * designRoot-relative path) it falls in, with no `_`-prefixed, skipped or hidden segment below
 * that group — and (gate-b-c4j) not a component (`isComponentRel`). Whether the file exists is
 * the caller's to ask. Pure — the hub loads it under Node.
 */
export function isCanvasRelInGroups(
  groups: readonly string[],
  rel: string,
  componentDir?: string | null
): boolean {
  if (!rel.endsWith('.tsx')) return false;
  const base = groups
    .map((g) => g.replace(/\/+$/, ''))
    .find((g) => g !== '' && rel.startsWith(`${g}/`));
  if (base === undefined) return false;
  for (const seg of rel.slice(base.length + 1).split('/')) {
    if (seg.startsWith('.') && !HIDDEN_OK.has(seg)) return false;
    if (seg.startsWith('_') || SKIP_DIRS.has(seg)) return false;
  }
  return !isComponentRel(rel, componentDir);
}
