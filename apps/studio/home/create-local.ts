// home/create-local.ts — "Just a local project" from Home (V2-1.1 §5.3, C4 naming).
//
// `~/Maude/<name>` (base overridable by $MAUDE_HOME_PROJECTS_DIR, for tests and for a person who
// keeps projects elsewhere), " 2", " 3" … on a collision, scaffolded by the same
// `scaffold-design.ts` every new project uses. The folder is CLAIMED with a non-recursive mkdir, so
// two creates racing for one name get two folders, never one shared one.

import { existsSync, mkdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { scaffoldDesign } from '../scaffold-design.ts';
import { pidOf } from './pid.ts';

export const UNTITLED_PROJECT = 'Untitled project';
const MAX_NAME = 80;
const MAX_SUFFIX = 999;

export function projectsBaseDir(): string {
  return process.env.MAUDE_HOME_PROJECTS_DIR || path.join(homedir(), 'Maude');
}

/** The folder name for a person's project name: their words, minus what a path cannot hold. */
export function projectFolderName(raw: unknown): string {
  const s = (typeof raw === 'string' ? raw : '')
    .normalize('NFC')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it strips
    .replace(/[/\\:\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .slice(0, MAX_NAME)
    .trim();
  return s || UNTITLED_PROJECT;
}

/** What `create-local` says when a picked folder is not one it will make a project in. */
export const LOCATION_REFUSED =
  'Choose a folder inside your home folder, or on a drive attached to this Mac.';
/** V2-8.9 r2 C2 — a picked folder inside another project or repository: it would inherit that tree's
 *  `.git/config` (a `core.fsmonitor` command), `CLAUDE.md` (instructions to the AI) and `.design/`. */
export const LOCATION_IN_PROJECT =
  'This folder is inside another project or a git repository. Choose a folder outside it.';
const MAX_LOCATION = 1024;
/**
 * What makes a folder part of somebody's tree: a repository, a Maude project, AI instructions. Claude Code reads
 * every instruction file below from a parent folder, not just `CLAUDE.md` (#168).
 */
const TREE_MARKERS = [
  '.git',
  '.design',
  'CLAUDE.md',
  'CLAUDE.local.md',
  path.join('.claude', 'CLAUDE.md'),
  'AGENTS.md',
] as const;

/** `dir` and each parent up to `stop` (exclusive) — or up to and including `stop` when `inclusive`. */
function holdsTreeMarker(dir: string, stop: string, inclusive: boolean): boolean {
  let at = dir;
  for (;;) {
    if (at === stop && !inclusive) return false;
    if (TREE_MARKERS.some((m) => existsSync(path.join(at, m)))) return true;
    if (at === stop) return false;
    const up = path.dirname(at);
    if (up === at) return false;
    at = up;
  }
}

/**
 * r1 (img 6) — New project › Advanced › "Choose another folder…": the folder the person picked in the
 * native picker, re-checked here because the page hands it over. It must be an existing folder (the
 * picker only answers those), given as an absolute path; after every symlink is resolved it sits inside
 * the home folder or on an attached drive (`/Volumes/<drive>/…`), and none of its parts inside the home
 * folder is hidden (`~/.config`, `~/.ssh`) or `~/Library` (the app's own data). Answers the resolved
 * folder, or null.
 */
export function checkLocation(raw: unknown, home = homedir()): string | null {
  const r = checkLocationReason(raw, home);
  return r.ok ? r.path : null;
}

/**
 * `checkLocation` with the reason. V2-8.9 r2 C2: the folder, and every parent of it up to the home folder
 * (the home folder itself is not asked — a dotfiles `~/.git` would refuse every place) or up to the drive
 * root (asked), must hold no `.git`, `.design` or `CLAUDE.md`: LOCATION_IN_PROJECT. `Library` is compared
 * case-folded (APFS is case-insensitive; a runtime whose realpath keeps the typed case must not pass).
 */
export function checkLocationReason(
  raw: unknown,
  home = homedir()
): { ok: true; path: string } | { ok: false; error: string } {
  const refused = { ok: false as const, error: LOCATION_REFUSED };
  const real = resolveLocation(raw, home);
  if (!real) return refused;
  const rel = path.relative(real.home, real.path);
  const inHome = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (inHome) {
    if (holdsTreeMarker(real.path, real.home, false))
      return { ok: false, error: LOCATION_IN_PROJECT };
    return { ok: true, path: real.path };
  }
  const vol = real.path.split(path.sep);
  const drive = path.sep + path.join(vol[1] ?? '', vol[2] ?? '');
  if (holdsTreeMarker(real.path, drive, true)) return { ok: false, error: LOCATION_IN_PROJECT };
  return { ok: true, path: real.path };
}

/** The location policy without the tree check: the resolved folder and home, or null. */
function resolveLocation(raw: unknown, home: string): { path: string; home: string } | null {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_LOCATION || raw.includes('\u0000'))
    return null;
  if (!path.isAbsolute(raw)) return null;
  let real: string;
  let realHome: string;
  try {
    real = realpathSync(raw);
    realHome = realpathSync(home);
  } catch {
    return null;
  }
  try {
    if (!statSync(real).isDirectory()) return null;
  } catch {
    return null;
  }
  const rel = path.relative(realHome, real);
  const inHome = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (inHome) {
    const parts = rel ? rel.split(path.sep) : [];
    if (parts.some((p) => p.startsWith('.'))) return null;
    if (parts[0]?.toLowerCase() === 'library') return null;
    return { path: real, home: realHome };
  }
  const vol = real.split(path.sep);
  // ['', 'Volumes', '<drive>', …] — a drive's own folders, never /Volumes itself
  if (process.platform === 'darwin' && vol[1] === 'Volumes' && vol.length >= 3 && vol[2]) {
    if (vol.slice(2).some((p) => p.startsWith('.'))) return null;
    return { path: real, home: realHome };
  }
  return null;
}

export type CreateLocalResult =
  | { ok: true; root: string; pid: string; name: string }
  | { ok: false; status: number; error: string };

/**
 * `recheck` (#168): a folder the person picked was checked by `checkLocationReason` a moment ago, but a synced
 * parent can receive a `.git` or an instruction file between that check and the create. It is called once the
 * project folder is claimed and again after the scaffold; a `false` removes what this call made and refuses with
 * LOCATION_IN_PROJECT, so nothing is left in a tree the check would now refuse.
 */
export function createLocalProject(
  name: unknown,
  baseDir = projectsBaseDir(),
  opts: { recheck?: () => boolean } = {}
): CreateLocalResult {
  const base = projectFolderName(name);
  try {
    mkdirSync(baseDir, { recursive: true });
  } catch {
    return { ok: false, status: 500, error: `Could not create ${baseDir}.` };
  }
  for (let i = 1; i <= MAX_SUFFIX; i++) {
    const folder = i === 1 ? base : `${base} ${i}`;
    const target = path.join(baseDir, folder);
    try {
      mkdirSync(target); // the claim: EEXIST means somebody has this name
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      return { ok: false, status: 500, error: 'Could not create the project folder.' };
    }
    const lateTree = (): CreateLocalResult | null => {
      if (!opts.recheck || opts.recheck()) return null;
      rmSync(target, { recursive: true, force: true }); // ours: claimed above
      return { ok: false, status: 400, error: LOCATION_IN_PROJECT };
    };
    const early = lateTree();
    if (early) return early;
    const s = scaffoldDesign(target, folder);
    if (!s.ok) {
      rmSync(target, { recursive: true, force: true }); // ours: created three lines up
      return { ok: false, status: 500, error: s.error ?? 'Could not set up the project.' };
    }
    const late = lateTree();
    if (late) return late;
    const root = realpathSync(target);
    return { ok: true, root, pid: pidOf(root), name: folder };
  }
  return { ok: false, status: 409, error: `Too many projects named “${base}”.` };
}
