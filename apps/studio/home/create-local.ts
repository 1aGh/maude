// home/create-local.ts — "Just a local project" from Home (V2-1.1 §5.3, C4 naming).
//
// `~/Maude/<name>` (base overridable by $MAUDE_HOME_PROJECTS_DIR, for tests and for a person who
// keeps projects elsewhere), " 2", " 3" … on a collision, scaffolded by the same
// `scaffold-design.ts` every new project uses. The folder is CLAIMED with a non-recursive mkdir, so
// two creates racing for one name get two folders, never one shared one.

import { mkdirSync, realpathSync, rmSync } from 'node:fs';
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
