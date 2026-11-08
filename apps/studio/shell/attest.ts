// The per-spawn attest key — #206 (DDR-250 decision 2; contract
// `client/v2/contracts/206-cli-reuses-desktop.md` §3).
//
// The desktop app mints `MAUDE_SHELL_ATTEST_KEY` for every sidecar spawn and writes the same key
// into its own registry (`<app_data_dir>/servers.json`). A terminal `maude design` verb (or a
// CLI-role server deciding whether to step down, shell/cli-yield.ts) believes a port only after
// the server there answers a fresh nonce with
//
//     mac = HMAC-SHA256(key, "maude-attest/1\n" + nonce + "\n" + rootId + "\n" + port)   (hex)
//
// The key is the registry's `attestKey` string as written (64 hex characters), used as its UTF-8
// bytes. `rootId` is http.ts `rootIdentity` of the server's repo root; `port` is the port the
// server itself BOUND (never the request's Host), so a listener relaying a challenge to a real
// sidecar answers for the sidecar's port and not its own.
//
// The key is read once, at first import, and deleted from `process.env`: nothing this server
// spawns inherits it (scrubAgentEnv drops every `MAUDE_SHELL_*` as well, acp/env.ts).

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const ATTEST_ENV = 'MAUDE_SHELL_ATTEST_KEY';
export const ATTEST_KEY_RE = /^[0-9a-fA-F]{64}$/;
export const ATTEST_NONCE_RE = /^[0-9a-fA-F]{32}$/;
export const ATTEST_DOMAIN = 'maude-attest/1';

/** Read the key from `env` and delete it there. A malformed key reads as none (fail closed). */
export function takeAttestKey(
  env: Record<string, string | undefined> = process.env
): string | null {
  const v = env[ATTEST_ENV];
  delete env[ATTEST_ENV];
  if (!v) return null;
  if (!ATTEST_KEY_RE.test(v)) {
    console.warn(`[maude] ${ATTEST_ENV} is not 64 hex characters; this server is not attestable.`);
    return null;
  }
  return v;
}

const BOOT_KEY = takeAttestKey(process.env);

/** The key this process was spawned with (null: not an app sidecar, so never attestable). */
export function bootAttestKey(): string | null {
  return BOOT_KEY;
}

export function attestMac(key: string, nonce: string, rootId: string, port: number): string {
  return createHmac('sha256', key)
    .update(`${ATTEST_DOMAIN}\n${nonce}\n${rootId}\n${port}`)
    .digest('hex');
}

/** Constant-time compare of two MACs (hashed first, so a length difference leaks nothing). */
export function macMatches(got: unknown, want: string): boolean {
  if (typeof got !== 'string' || !got) return false;
  const a = createHash('sha256').update(got).digest();
  const b = createHash('sha256').update(want).digest();
  return timingSafeEqual(a, b);
}
