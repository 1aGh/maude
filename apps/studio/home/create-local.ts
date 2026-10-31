// home/create-local.ts — "Just a local project" from Home (V2-1.1 §5.3, C4 naming).
//
// `~/Maude/<name>` (base overridable by $MAUDE_HOME_PROJECTS_DIR, for tests and for a person who
// keeps projects elsewhere), " 2", " 3" … on a collision, scaffolded by the same
// `scaffold-design.ts` every new project uses. The folder is CLAIMED with a non-recursive mkdir, so
// two creates racing for one name get two folders, never one shared one.

import { mkdirSync, realpathSync, rmSync, statSync } from 'node:fs';
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
const MAX_LOCATION = 1024;

/**
 * r1 (img 6) — New project › Advanced › "Choose another folder…": the folder the person picked in the
 * native picker, re-checked here because the page hands it over. It must be an existing folder (the
 * picker only answers those), given as an absolute path; after every symlink is resolved it sits inside
 * the home folder or on an attached drive (`/Volumes/<drive>/…`), and none of its parts inside the home
 * folder is hidden (`~/.config`, `~/.ssh`) or `~/Library` (the app's own data). Answers the resolved
 * folder, or null.
 */
export function checkLocation(raw: unknown, home = homedir()): string | null {
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
    if (parts[0] === 'Library') return null;
    return real;
  }
  const vol = real.split(path.sep);
  // ['', 'Volumes', '<drive>', …] — a drive's own folders, never /Volumes itself
  if (process.platform === 'darwin' && vol[1] === 'Volumes' && vol.length >= 3 && vol[2]) {
    if (vol.slice(2).some((p) => p.startsWith('.'))) return null;
    return real;
  }
  return null;
}

export type CreateLocalResult =
  | { ok: true; root: string; pid: string; name: string }
  | { ok: false; status: number; error: string };

export function createLocalProject(name: unknown, baseDir = projectsBaseDir()): CreateLocalResult {
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
    const s = scaffoldDesign(target, folder);
    if (!s.ok) {
      rmSync(target, { recursive: true, force: true }); // ours: created three lines up
      return { ok: false, status: 500, error: s.error ?? 'Could not set up the project.' };
    }
    const root = realpathSync(target);
    return { ok: true, root, pid: pidOf(root), name: folder };
  }
  return { ok: false, status: 409, error: `Too many projects named “${base}”.` };
}
