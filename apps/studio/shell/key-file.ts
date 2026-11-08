// The terminal-started server's key file — contract `client/v2/contracts/sec-loopback-bearer.md` §7.5.
//
// A server started from a terminal (`maude design serve`, `maude design server-up`: role `cli`,
// shell/cli-yield.ts) mints its own API key (shell/api-key.ts) and is in required mode, like a
// desktop spawn. The CLI on this machine needs that key to reach it, so the server writes
// `{ v:1, port, pid, rootId, apiKey }` to `<state>/maude/servers/<rootId>.json`:
//   • `<state>` is `$XDG_STATE_HOME` when absolute, else `~/.local/state` — a per-user directory
//     OUTSIDE the project, so nothing in the design root (synced, committed, readable by the AI
//     through ordinary file tools) ever holds it;
//   • the directory is 0700 and the file 0600 (atomic tmp + rename, sync/atomic-write.ts);
//   • the server removes the file on shutdown when it still names this process.
// Only the CLI reads it (cli/lib/desktop-locate.mjs `terminalKeyFor`), and only for a port the
// project's own `/_health` check already tied to this root.

import { chmodSync, lstatSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { atomicWrite } from '../sync/atomic-write.ts';

export interface ServerKeyRecord {
  v: 1;
  port: number;
  pid: number;
  rootId: string;
  apiKey: string;
}

/** `<state>/maude/servers` for this user (the CLI's copy is desktop-locate.mjs `serverKeyDir`). */
export function serverKeyDir(env: Record<string, string | undefined> = process.env): string {
  const s = env.XDG_STATE_HOME;
  const state = s && isAbsolute(s) ? s : join(env.HOME || homedir(), '.local', 'state');
  return join(state, 'maude', 'servers');
}

const ROOT_ID_RE = /^[0-9a-f]{12}$/;

/**
 * Write the record; returns its path, or null when it could not be written (logged — the server
 * still serves, and its printed link still opens it; the CLI then reports no studio).
 */
export function writeServerKeyFile(
  rec: Omit<ServerKeyRecord, 'v'>,
  env: Record<string, string | undefined> = process.env
): string | null {
  if (!ROOT_ID_RE.test(rec.rootId)) return null;
  const dir = serverKeyDir(env);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = lstatSync(dir);
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (!st.isDirectory() || (uid !== null && st.uid !== uid)) {
      console.warn(
        '[maude] the server key directory is not a directory of this user; not written.'
      );
      return null;
    }
    if ((st.mode & 0o077) !== 0) chmodSync(dir, 0o700);
    const path = join(dir, `${rec.rootId}.json`);
    atomicWrite(path, `${JSON.stringify({ v: 1, ...rec })}\n`);
    return path;
  } catch (e) {
    console.warn(`[maude] could not write the server key file: ${(e as Error).message}`);
    return null;
  }
}

/** Remove `path` when it still names `pid` (a newer server for the same root keeps its own). */
export function removeServerKeyFile(path: string | null, pid = process.pid): void {
  if (!path) return;
  try {
    const rec = JSON.parse(readFileSync(path, 'utf8')) as Partial<ServerKeyRecord>;
    if (rec.pid === pid) unlinkSync(path);
  } catch {
    /* gone already, or not ours */
  }
}
