// `<designRoot>/_server.json` — one writer at a time (#206, DDR-250 decision 7; contract
// `client/v2/contracts/206-cli-reuses-desktop.md` §6 "Handover" step 2).
//
// The slash commands and `maude design` helpers find a live server through this file. Two
// servers can serve one root for a while (a terminal `server-up` server and the desktop's
// sidecar), and both used to treat the file as theirs: the one stopping unlinked it blindly, so
// the survivor ran with no file and the next `server-up` started a third server. Now:
//   • a server writes it atomically (tmp + rename), so a reader never sees half a file;
//   • a server removes it on shutdown ONLY while it still names that server — the same pid AND
//     the same `started` stamp (a recycled pid is a different server). Same shape as the store
//     lock's stale-holder check (sync/local-kernel.ts `acquireStoreLock`): read, compare, unlink.
//     Residual: a write landing between the read and the unlink is lost (a millisecond window,
//     and the newer server rewrites nothing until its next boot) — named, not closed.
//
// The file stays a hint for helpers on a machine without the app. It is never a trust input
// when the app's registry names the root (contract §3): nothing here makes it one.

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ServerJson {
  pid: number;
  port: number;
  url: string;
  canvasOrigin?: string;
  canvasPort?: number;
  started: string;
  project?: string;
  config_source?: string;
}

/** Write `info` to `file` atomically. Mode 0644, as before: it holds a pid and a port, no secret. */
export function writeServerJson(file: string, info: ServerJson): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${randomBytes(8).toString('hex')}`;
  try {
    writeFileSync(tmp, JSON.stringify(info, null, 2), { mode: 0o644, flag: 'wx' });
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/**
 * Remove `file` only while it names `me` (pid + started). True when it removed it. A missing,
 * empty or unparsable file, or one naming another server, is left exactly as it is.
 */
export function removeServerJsonIfOurs(
  file: string,
  me: { pid: number; started: string }
): boolean {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  let cur: Partial<ServerJson> | null = null;
  try {
    cur = JSON.parse(raw) as Partial<ServerJson>;
  } catch {
    return false;
  }
  if (!cur || cur.pid !== me.pid || cur.started !== me.started) return false;
  // still the bytes we judged (a rewrite in between is the other server's)
  try {
    if (readFileSync(file, 'utf8') !== raw) return false;
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}
