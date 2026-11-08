// sec-loopback-bearer §7 — a sidecar the app starts requires its per-spawn API key from every caller on
// its main origin. A scenario's own Node-side request (not the page's — the page holds the session
// cookie) reads the key the way the CLI does: from the e2e app's registry (`servers.json`, 0600, app
// data dir of the e2e bundle id), for the entry whose port is the one being called. Any other server (a
// peer studio a harness started, a cell behind its hub) is not in that registry and gets no key.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const E2E_BUNDLE_ID = 'com.maude.app.e2e';

/** The registry the e2e debug app writes (the same default wdio.cli-reuse.conf.ts names). */
export function e2eRegistryPath(): string {
  if (process.env.MAUDE_E2E_APP_REGISTRY) return process.env.MAUDE_E2E_APP_REGISTRY;
  return process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', E2E_BUNDLE_ID, 'servers.json')
    : join(
        process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'),
        E2E_BUNDLE_ID,
        'servers.json'
      );
}

type Entry = { state?: string; port?: number; apiKey?: string };

/** The API key of the app's running sidecar on `port`, or null. */
export function sidecarKey(port: number, file = e2eRegistryPath()): string | null {
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { servers?: Entry[] };
    const e = (doc.servers ?? []).find((s) => s.state === 'running' && s.port === port);
    return typeof e?.apiKey === 'string' && /^[0-9a-f]{64}$/i.test(e.apiKey) ? e.apiKey : null;
  } catch {
    return null;
  }
}

/** `extra` plus `x-maude-api-key` when `origin` (or a full URL) is one of the app's sidecars. */
export function sidecarHeaders(
  origin: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  let port = Number.NaN;
  try {
    port = Number(new URL(origin).port);
  } catch {
    /* not a URL: no key */
  }
  const key = Number.isInteger(port) && port > 0 ? sidecarKey(port) : null;
  return key ? { ...extra, 'x-maude-api-key': key } : { ...extra };
}
