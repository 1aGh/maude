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
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

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

/** Write JSON atomically: dirs 0700, file 0600. Throws on failure (the caller fails closed). */
export function writeState(abs, value) {
  mkdirSync(dirname(abs), { recursive: true, mode: 0o700 });
  const tmp = `${abs}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
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

/**
 * Drop call states nobody settled (a killed call sends no PostToolUse) once they are older than
 * `maxAgeMs`, so a manifest never outlives its turn by long. Best effort, never throws.
 */
export function pruneStates(root, maxAgeMs = 24 * 3_600_000, env = process.env) {
  try {
    const base = hookStateDir(root, env);
    const now = Date.now();
    for (const s of readdirSync(base, { withFileTypes: true })) {
      if (!s.isDirectory()) continue;
      const dir = join(base, s.name, 'bash');
      let names = [];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const n of names) {
        try {
          if (now - statSync(join(dir, n)).mtimeMs > maxAgeMs)
            rmSync(join(dir, n), { force: true });
        } catch {
          /* gone */
        }
      }
    }
  } catch {
    /* nothing to prune */
  }
}
