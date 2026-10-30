// studio-locate.mjs — find a project's design root and its running studio, for the in-process
// `maude design` verbs that talk to it (`open`, `hook`, `check`; contract V2-1.11 §5.3, §5.4).
//
// Studio reachability (§5.4): `<designRoot>/_server.json` → its PORT only, always on 127.0.0.1 —
// never the file's `url`, so a planted or synced `_server.json` can't turn a verb into a fetch of
// another host. A dead pid's file is ignored, and `/_health` must name THIS root (`rootId` =
// sha256(realpath(root))[:12], http.ts rootIdentity) — a reused port may be another project's.
// Any failure → null: callers fail open.
//
// Leaf module: node built-ins only.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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

/** http.ts rootIdentity, verbatim. */
export function rootIdentity(root) {
  let resolved = root;
  try {
    resolved = realpathSync(root);
  } catch {
    /* hash what we were told */
  }
  return createHash('sha256').update(resolved, 'utf8').digest('hex').slice(0, 12);
}

/** `{ port, base }` of the studio serving `root`, or null. Never throws. */
export async function locateStudio(root, { timeoutMs = 300 } = {}) {
  try {
    const info = JSON.parse(readFileSync(join(root, DESIGN_REL, '_server.json'), 'utf8'));
    const port = Number(info?.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    if (Number.isInteger(info?.pid)) {
      try {
        process.kill(info.pid, 0);
      } catch (e) {
        if (e?.code !== 'EPERM') return null; // a dead server's file
      }
    }
    const base = `http://127.0.0.1:${port}`;
    const res = await fetch(`${base}/_health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const health = await res.json();
    if (health?.app !== 'design' || health.rootId !== rootIdentity(root)) return null;
    return { port, base, health };
  } catch {
    return null;
  }
}

/** POST JSON to a located studio. `{ status, body }`, or null on any transport failure. */
export async function postStudio(studio, route, payload, { timeoutMs = 1500 } = {}) {
  try {
    const res = await fetch(`${studio.base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
