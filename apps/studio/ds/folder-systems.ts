// 2.0.7 — the design systems a project has: the configured ones, then the folder-owned ones.
//
// A cell's `config.json` never travels on the file plane (file-membership `never`) and is filled in
// only when the owner's desktop pushes its systems, so a system converted on a desktop can reach the
// cell as files alone: `system/<ds>/` with its own Design system canvas (`design-system.tsx`). Such a
// folder owns its canvases (`folderSystemOf`), and it is a system in every list too — `/_api/ds/*`,
// `/_config` (the Design system panel, the left panel's rows), the usage index — and a `ui/` canvas
// whose `.meta.json` names it renders with it.
//
// One merged list, one order: the configured systems first, exactly as configured, then the folder
// systems by name. So the default (the configured `defaultDesignSystem`, else the first configured
// system) never changes while the config lists a system. A name never invents a path: a folder system
// exists only where `system/<name>/design-system.tsx` is a real file in a real folder; a pin to any
// other name the config does not list stays at the default.
//
// A leaf: node built-ins only, so `context.ts` (loadConfig) can merge with it.

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** What a folder name must look like to be a system (the hub door's `designSystems[].name` rule). */
const FOLDER_NAME = /^[\w .-]{1,64}$/;

/**
 * The system folder a designRoot-relative path sits in when the config lists no system for it:
 * `system/<ds>/…` whose folder holds its own Design system canvas (`design-system.tsx`). `hasFile`
 * is the caller's reader (the disk, the closure's listing). A name the config already gives another
 * folder is never taken over. One rule for the build (`canvasSystemFor`), the closure
 * (`access/closure.ts`), the tree's map (`api.ts`) and the merged list below.
 */
export function folderSystemOf(
  rel: string,
  configured: ReadonlyArray<{ name: string; path: string }>,
  hasFile: (rel: string) => boolean
): { name: string; path: string } | null {
  const m = /^system\/([^/]+)\//.exec(rel);
  const seg = m?.[1];
  if (!seg || seg.startsWith('_') || seg.startsWith('.') || !FOLDER_NAME.test(seg)) return null;
  const dir = `system/${seg}`;
  if (configured.some((s) => s.path === dir || s.name === seg)) return null;
  return hasFile(`${dir}/design-system.tsx`) ? { name: seg, path: dir } : null;
}

/**
 * The folder system a canvas's `meta.designSystem` pin names, or null. Only a plain folder name
 * counts (no `/`, never a path), so a pin can reach `system/<name>/` and nothing else.
 */
export function pinnedFolderSystem(
  declared: unknown,
  configured: ReadonlyArray<{ name: string; path: string }>,
  hasFile: (rel: string) => boolean
): { name: string; path: string } | null {
  if (typeof declared !== 'string' || !declared || /[/\\]/.test(declared)) return null;
  const f = folderSystemOf(`system/${declared}/design-system.tsx`, configured, hasFile);
  return f && f.name === declared ? f : null;
}

/** A folder system's config entry: its tokens CSS, and its themes + root class guessed from it. */
export interface FolderSystemEntry {
  name: string;
  path: string;
  tokensCssRel: string;
  themes?: string[];
  themeDefault?: string;
  rootClass?: string;
  /** Not in the config: discovered from its folder. Never written back to config.json. */
  folderOwned: true;
}

export function folderSystemEntry(
  designRoot: string,
  folder: { name: string; path: string }
): FolderSystemEntry {
  const tokensCssRel = `${folder.path}/colors_and_type.css`;
  let css = '';
  try {
    css = readFileSync(path.join(designRoot, ...tokensCssRel.split('/')), 'utf8');
  } catch {
    /* no tokens yet: the defaults */
  }
  const themes: string[] = [];
  for (const m of css.matchAll(/\[data-theme\s*=\s*["']?([a-z][a-z0-9-]*)["']?\s*\]/gi))
    if (!themes.includes(m[1] as string)) themes.push(m[1] as string);
  const esc = folder.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rootClass = new RegExp(`\\.${esc}\\[data-theme`).test(css) ? folder.name : null;
  return {
    name: folder.name,
    path: folder.path,
    tokensCssRel,
    ...(themes.length
      ? { themes, themeDefault: themes.includes('light') ? 'light' : (themes[0] as string) }
      : {}),
    ...(rootClass ? { rootClass } : {}),
    folderOwned: true,
  };
}

/** `rel` (designRoot-relative) is a regular file on disk — a symlink never counts. */
export function isRealFile(designRoot: string, rel: string): boolean {
  try {
    return lstatSync(path.join(designRoot, ...rel.split('/'))).isFile();
  } catch {
    return false;
  }
}

/** The folder-owned systems on disk under `<designRoot>/system/`, by name. */
export function folderOwnedSystems(
  designRoot: string,
  configured: ReadonlyArray<{ name: string; path: string }>
): FolderSystemEntry[] {
  let dirs: string[];
  try {
    dirs = readdirSync(path.join(designRoot, 'system'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
  const out: FolderSystemEntry[] = [];
  for (const seg of dirs) {
    const f = folderSystemOf(`system/${seg}/design-system.tsx`, configured, (r) =>
      isRealFile(designRoot, r)
    );
    if (f) out.push(folderSystemEntry(designRoot, f));
  }
  return out;
}

function configuredOf(config: Record<string, unknown>): Array<{ name: string; path: string }> {
  const list = Array.isArray(config.designSystems) ? config.designSystems : [];
  return (list as Array<Record<string, unknown> | null>)
    .filter((e) => !!e && typeof e.name === 'string' && typeof e.path === 'string')
    .map((e) => ({
      name: (e as { name: string }).name,
      path: (e as { path: string }).path.replace(/^\/+|\/+$/g, ''),
    }));
}

/**
 * `config` with its `designSystems` extended by the folder-owned systems on disk (after the
 * configured ones). The same object back when there are none. For READING only: a writer of
 * `config.json` reads the file itself, so a folder system is never persisted into it.
 */
export function withFolderSystems<T extends Record<string, unknown>>(
  config: T,
  designRoot: string
): T {
  const folders = folderOwnedSystems(designRoot, configuredOf(config));
  if (!folders.length) return config;
  const list = Array.isArray(config.designSystems) ? (config.designSystems as unknown[]) : [];
  return { ...config, designSystems: [...list, ...folders] };
}

/**
 * The `config.json` entry that adopts folder system `ds`: what the merged list shows for it (name,
 * path, the themes and root class guessed from its tokens), without the `folderOwned` mark — so
 * the system reads the same once it is configured. Null when `ds` is not a folder system here.
 */
export function adoptionEntry(
  designRoot: string,
  config: Record<string, unknown>,
  ds: string
): Record<string, unknown> | null {
  const f = folderOwnedSystems(designRoot, configuredOf(config)).find((s) => s.name === ds);
  if (!f) return null;
  const { folderOwned: _mark, tokensCssRel, ...entry } = f;
  // the tokens CSS is the default one (`<path>/colors_and_type.css`): no key, as a made system has
  return tokensCssRel === `${f.path}/colors_and_type.css` ? entry : { ...entry, tokensCssRel };
}

/**
 * A DS write that edits a system's `config.json` entry (default, rename, the schema flag) on a
 * folder-owned system adopts it first: its entry is appended to `config.designSystems` (mutated in
 * place, the caller writes the file as for a configured system). True when it adopted one.
 */
export function adoptFolderSystem(
  designRoot: string,
  config: Record<string, unknown>,
  ds: string
): boolean {
  if (configuredOf(config).some((s) => s.name === ds)) return false;
  const entry = adoptionEntry(designRoot, config, ds);
  if (!entry) return false;
  const list = Array.isArray(config.designSystems) ? (config.designSystems as unknown[]) : [];
  config.designSystems = [...list, entry];
  return true;
}

/** The files whose change can add, drop or retheme a folder system. */
export function isFolderSystemFile(rel: unknown): boolean {
  return (
    typeof rel === 'string' &&
    /^system\/[^/]+\/(design-system\.tsx|colors_and_type\.css)$/.test(
      rel.replace(/\\/g, '/').replace(/^\/+/, '')
    )
  );
}
