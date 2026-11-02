// The app-owned shell info file — V2-1.1 decision 8 (authenticated shell ↔ server probes).
//
// The desktop shell passes each spawn `MAUDE_SHELL_INFO_FILE` (a path it owns, outside the
// project) and a per-spawn `MAUDE_SHELL_TOKEN`. The server writes where it is listening HERE as
// well as to `<designRoot>/_server.json`, which keeps being written unchanged for the slash
// commands and helpers. Rust's probes read only this file and then call
// `GET /_api/shell/status` with the token (routes/shell.ts), so a planted `_server.json` — or a
// fake responder at the address it names — is never believed.
//
// Atomic (tmp + rename) and 0600 via sync/atomic-write.ts: a reader never sees half a file, and
// no other local user can read which port the project is on. No token is ever written here.

import { isAbsolute } from 'node:path';

import { atomicWrite } from '../sync/atomic-write.ts';

export interface ShellInfo {
  pid: number;
  port: number;
  url: string;
  canvasOrigin?: string;
  started: string;
  mode: 'project' | 'home';
}

/** The info-file path the shell asked for, or null (no shell / not an absolute path). */
export function shellInfoFilePath(env: Record<string, string | undefined> = process.env) {
  const p = env.MAUDE_SHELL_INFO_FILE;
  return p && isAbsolute(p) ? p : null;
}

/**
 * Write `info` to `MAUDE_SHELL_INFO_FILE` when the shell set one. Returns the path written, or
 * null when there is none. A write failure is logged, never thrown: the server still serves,
 * and the shell's probe simply fails closed (it never falls back to `_server.json`).
 */
export function writeShellInfoFile(
  info: ShellInfo,
  env: Record<string, string | undefined> = process.env
): string | null {
  const p = shellInfoFilePath(env);
  if (!p) {
    if (env.MAUDE_SHELL_INFO_FILE)
      console.warn('[maude] MAUDE_SHELL_INFO_FILE is not an absolute path; not written.');
    return null;
  }
  try {
    atomicWrite(p, `${JSON.stringify(info, null, 2)}\n`);
    return p;
  } catch (e) {
    console.warn(`[maude] could not write the shell info file: ${(e as Error).message}`);
    return null;
  }
}
