// studio-locate.mjs — find a project's design root and its running studio, for the in-process
// `maude design` verbs that talk to it (`open`, `hook`, `check`; contract V2-1.11 §5.3, §5.4).
//
// Studio reachability (§5.4): `<designRoot>/_server.json` → its PORT only, always on 127.0.0.1 —
// never the file's `url`, so a planted or synced `_server.json` can't turn a verb into a fetch of
// another host. A dead pid's file is ignored, and `/_health` must name THIS root (`rootId` =
// sha256(realpath(root))[:12], http.ts rootIdentity) — a reused port may be another project's.
// Any failure → null: callers fail open.
//
// #206 T6.3d — the desktop app first (desktop-locate.mjs): while the app runs and its registry names
// this root as running, ITS attested server is the studio and `_server.json` is never read; a server
// there that does not attest means no studio (fail closed), not a fallback to the project file.
//
// sec-loopback-bearer §7 — an app server requires its per-spawn API key from every caller: the attested
// app studio carries `apiKey` (from the app's registry, never from a project file), and every request a
// verb or hook sends goes through `studioHeaders`. A terminal-started studio (§7.5) carries the key it
// wrote to its per-user key file (desktop-locate.mjs `terminalKeyFor`), read only after `/_health`
// named this root.
//
// Node built-ins + desktop-locate.mjs (itself a leaf).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { probeDesktop, rootIdentity, serverKeyFor, terminalKeyFor } from './desktop-locate.mjs';

export { rootIdentity };

export const DESIGN_REL = '.design';

/** The nearest directory at or above `start` holding `.design/config.json`, or null. */
export function findProjectRoot(start) {
  let cur = resolve(start);
  for (;;) {
    if (existsSync(join(cur, DESIGN_REL, 'config.json'))) return cur;
    const up = dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}

/** `{ port, base }` of the studio serving `root`, or null. Never throws. */
export async function locateStudio(root, { timeoutMs = 300 } = {}) {
  return (await probeStudio(root, { timeoutMs })).studio ?? null;
}

/**
 * fix/ds-convert-hooks-cli #13 — `locateStudio` that tells "not running" from "busy": a live
 * server whose `/_health` did not answer within `timeoutMs` is retried (`attempts` in all, with
 * `retryDelayMs` between) and, still silent, reported `{ state: 'busy' }` — a studio under load
 * (an export, a big sync) is not "no studio". `{ studio }`, `{ state: 'none' }` or
 * `{ state: 'busy' }`. Never throws.
 */
export async function probeStudio(
  root,
  { timeoutMs = 300, attempts = 1, retryDelayMs = 250 } = {}
) {
  const app = await probeDesktop(root, { timeoutMs: Math.max(timeoutMs, 300) });
  if (app.state === 'unverified') return { state: 'none' };
  if (app.state === 'running') {
    const base = `http://127.0.0.1:${app.port}`;
    let health = null;
    try {
      const res = await fetch(`${base}/_health`, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) health = await res.json();
    } catch {
      /* attested already; /_health is only informative here */
    }
    return {
      studio: {
        port: app.port,
        base,
        health,
        owner: 'app',
        label: app.label,
        ...(app.apiKey ? { apiKey: app.apiKey } : {}),
      },
    };
  }
  let port;
  try {
    const info = JSON.parse(readFileSync(join(root, DESIGN_REL, '_server.json'), 'utf8'));
    port = Number(info?.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { state: 'none' };
    if (Number.isInteger(info?.pid)) {
      try {
        process.kill(info.pid, 0);
      } catch (e) {
        if (e?.code !== 'EPERM') return { state: 'none' }; // a dead server's file
      }
    }
  } catch {
    return { state: 'none' };
  }
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < Math.max(1, attempts); i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    try {
      const res = await fetch(`${base}/_health`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return { state: 'none' };
      const health = await res.json();
      if (health?.app !== 'design' || health.rootId !== rootIdentity(root))
        return { state: 'none' };
      // §7.5 — a terminal-started server's own key, from its per-user key file (never the project)
      const apiKey = terminalKeyFor(root, port);
      return { studio: { port, base, health, ...(apiKey ? { apiKey } : {}) } };
    } catch (e) {
      // only a timeout is "busy": a refused connection is no server on that port
      if (e?.name !== 'TimeoutError' && e?.name !== 'AbortError') return { state: 'none' };
    }
  }
  return { state: 'busy' };
}

export const API_KEY_HEADER = 'x-maude-api-key';

/** The headers every request to `studio` carries (the app server's API key), merged over `extra`. */
export function studioHeaders(studio, extra = {}) {
  return studio?.apiKey ? { ...extra, [API_KEY_HEADER]: studio.apiKey } : { ...extra };
}

/**
 * The same headers for a helper that holds only a PORT (read from `_server.json` by a bash caller):
 * the key of the server serving `root` there — the app's attested one, else a terminal-started one
 * whose `/_health` names `root`. A port that is neither gets no key. Never throws.
 */
export async function studioHeadersFor(root, port, extra = {}) {
  const r = await serverKeyFor(root, Number(port));
  return r.key ? { ...extra, [API_KEY_HEADER]: r.key } : { ...extra };
}

/** POST JSON to a located studio. `{ status, body }`, or null on any transport failure. */
export async function postStudio(studio, route, payload, { timeoutMs = 1500 } = {}) {
  try {
    const res = await fetch(`${studio.base}${route}`, {
      method: 'POST',
      headers: studioHeaders(studio, { 'content-type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    return { status: res.status, body };
  } catch {
    return null;
  }
}
