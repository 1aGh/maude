// hook-state.mjs — where the design hooks keep state that must NOT live in the project (#164 B1,
// contract apps/studio/client/v2/contracts/164-hash-diff-attribution.md §5).
//
// The pre/post-bash lane manifest (a stat key + sha256 per canvas-lane file) and the hash cache used
// to sit under `<designRoot>/_runs`, which is project state: a synced or cloned project would carry
// them, and an AI that can write the project could rewrite them. They live under
//
//   $MAUDE_HOOK_STATE_HOME || ~/.claude/maude-hook   /<rootIdentity(root)>/
//     lanes.json                      the root's hash cache (non-authoritative)
//     <session>/bash/<toolUseId>.json one call's {v, at, mode, files, bg?, verbOnly?, snaps, manifest}
//
// Directories 0700, files 0600, written tmp + rename (a torn file reads as "no state"). The precedent
// is `~/.claude/flow-runs`. A test MUST set MAUDE_HOOK_STATE_HOME to a temp dir.
//
// Leaf module: node built-ins + studio-locate.mjs.

import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';

import { rootIdentity } from './studio-locate.mjs';

const SEG_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** The folder every root's hook state sits in. */
export function hookStateHome(env = process.env) {
  const o = env.MAUDE_HOOK_STATE_HOME;
  return typeof o === 'string' && o ? o : join(homedir(), '.claude', 'maude-hook');
}

/** This project's hook state folder. */
export function hookStateDir(root, env = process.env) {
  return join(hookStateHome(env), rootIdentity(root));
}

/** The state file of one call, or null when `session` / `toolUseId` is not a safe segment. */
export function bashStatePath(root, session, toolUseId, env = process.env) {
  if (!SEG_RE.test(session ?? '') || !SEG_RE.test(toolUseId ?? '')) return null;
  return join(hookStateDir(root, env), session, 'bash', `${toolUseId}.json`);
}

/** The root's non-authoritative hash cache. */
export const lanesCachePath = (root, env = process.env) =>
  join(hookStateDir(root, env), 'lanes.json');

/**
 * Tighten the folders the state lives in to 0700 on every open: `mkdir -p`'s mode only applies to a
 * folder it creates, so one an older build or a looser umask made would stay readable (#164 D7).
 */
function tighten(abs, env) {
  const home = hookStateHome(env);
  if (!abs.startsWith(home + sep)) return;
  const rootDir = join(home, abs.slice(home.length + 1).split(sep)[0]);
  for (const d of [home, rootDir]) {
    try {
      chmodSync(d, 0o700);
    } catch {
      /* not ours to change: the write still fails closed if it cannot happen */
    }
  }
}

/**
 * Write JSON atomically: dirs 0700, file 0600. Throws on failure (the caller fails closed). The temp
 * file is created exclusively (`wx`), so a link planted at its name is replaced, never followed, and a
 * target that is itself a symlink is refused (#164 F8).
 */
export function writeState(abs, value, env = process.env) {
  mkdirSync(dirname(abs), { recursive: true, mode: 0o700 });
  tighten(abs, env);
  let target = null;
  try {
    target = lstatSync(abs);
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
  if (target?.isSymbolicLink()) throw new Error('hook state: refusing a symlinked state file');
  const tmp = `${abs}.${process.pid}.tmp`;
  const body = JSON.stringify(value);
  try {
    writeFileSync(tmp, body, { mode: 0o600, flag: 'wx' });
  } catch (e) {
    if (e?.code !== 'EEXIST') throw e;
    rmSync(tmp, { force: true }); // unlinks a leftover (or a planted link) without following it
    writeFileSync(tmp, body, { mode: 0o600, flag: 'wx' });
  }
  renameSync(tmp, abs);
}

/** Read JSON, or `dflt` for a missing / unreadable / torn file. */
export function readState(abs, dflt = null) {
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch {
    return dflt;
  }
}

export function removeState(abs) {
  rmSync(abs, { force: true });
}

/** An empty folder is only removed once it has been idle this long (a writer may be about to fill it). */
const EMPTY_DIR_GRACE_MS = 60_000;

/**
 * Drop call states nobody settled (a killed call sends no PostToolUse) once they are older than
 * `maxAgeMs`, so a manifest never outlives its turn by long; then the session folders that are left
 * empty and a lane cache nobody has refreshed in as long (#164 D7). Best effort, never throws.
 */
export function pruneStates(root, maxAgeMs = 24 * 3_600_000, env = process.env) {
  try {
    const base = hookStateDir(root, env);
    const now = Date.now();
    // how long a folder has been idle, read before this pass touches it
    const idle = (d) => {
      try {
        return now - statSync(d).mtimeMs > EMPTY_DIR_GRACE_MS;
      } catch {
        return false;
      }
    };
    for (const s of readdirSync(base, { withFileTypes: true })) {
      if (!s.isDirectory()) continue;
      const sessionDir = join(base, s.name);
      const dir = join(sessionDir, 'bash');
      const dirIdle = idle(dir);
      const sessionIdle = idle(sessionDir);
      let names = [];
      try {
        names = readdirSync(dir);
      } catch {
        /* no bash folder */
      }
      let left = names.length;
      for (const n of names) {
        try {
          if (now - statSync(join(dir, n)).mtimeMs > maxAgeMs) {
            rmSync(join(dir, n), { force: true });
            left--;
          }
        } catch {
          left--; // gone
        }
      }
      // rmdir only succeeds on an empty folder, so a refill in between is safe
      if (left === 0 && dirIdle) {
        try {
          rmdirSync(dir);
        } catch {
          /* refilled, or gone */
        }
      }
      if (sessionIdle) {
        try {
          rmdirSync(sessionDir);
        } catch {
          /* not empty */
        }
      }
    }
    try {
      const lanes = lanesCachePath(root, env);
      if (now - statSync(lanes).mtimeMs > maxAgeMs) rmSync(lanes, { force: true });
    } catch {
      /* no cache */
    }
  } catch {
    /* nothing to prune */
  }
}
