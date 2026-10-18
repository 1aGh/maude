// _annotate-post.mjs — send a batch of annotation ops to the live studio (internal; no verb of its own).
//
// Shared by `annotate` and `import-figma --board --into`: with a live dev-server
// (`<designRoot>/_server.json`, loopback only) the ops go through
// `POST /_api/annotations/ops` — merged under the one merge rule and broadcast to every open
// canvas. Lifted out of bin/annotate.mjs (S4.5) so both callers apply the same egress allowlist and
// the same "never bypass a server that is there" rule. Throws `PostOpsError` (the caller decides
// the exit code); returns `null` when the caller should write the board file itself.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export class PostOpsError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

/**
 * Wave H F2 — the egress allowlist. The dev-server is loopback-only (DDR-054); a POST target that
 * is not a loopback http(s) origin is refused so a poisoned `_server.json.url` can't exfiltrate the
 * board off-box.
 */
export function isLoopbackHttpUrl(base) {
  let u;
  try {
    u = new URL(base);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
}

/**
 * POST the ops to a live, loopback dev-server. Returns the parsed response, `null` when no server
 * answers or it predates the op route (then the caller writes the file), and throws on any other
 * refusal or a timeout — a file write would bypass the server and its live room.
 */
export async function postOps(designRoot, file, ops, actionId) {
  const serverJsonPath = join(designRoot, '_server.json');
  if (!existsSync(serverJsonPath)) return null;
  let base = null;
  try {
    const srv = JSON.parse(readFileSync(serverJsonPath, 'utf8'));
    base = typeof srv.url === 'string' ? srv.url.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
  // Security (Wave H F2): only ever POST to a loopback origin — a poisoned
  // `url` can't turn the verb into an exfiltration primitive. Anything else
  // silently falls back to the file write (the local intent still succeeds).
  if (!base || !isLoopbackHttpUrl(base)) return null;
  let res;
  try {
    res = await fetch(`${base}/_api/annotations/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file,
        actionId: actionId ?? `ai-annotate-${Math.random().toString(36).slice(2, 12)}`,
        ops,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // No server answering (a stale _server.json) → the file write is safe.
    // A server that IS there but too slow must not be bypassed: writing the
    // file would reseed its live room from a stale snapshot and erase what
    // collaborators did meanwhile (security review A2).
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new PostOpsError('the dev-server did not answer in time — nothing written; try again');
    }
    return null;
  }
  // Only a server too old to have the op route falls back to the file.
  if (res.status === 404 || res.status === 405) return null;
  // Inside a cloud workspace (MAUDE_WORKSPACE_MODE=1) the studio treats a
  // loopback request without the proxy's role header as read-only; the
  // workspace's own file write IS the agent's channel there (the workspace
  // agent syncs it). Anywhere else a read-only refusal stands — a local write
  // the hub refuses to sync is a silent fork.
  if (res.status === 403 && process.env.MAUDE_WORKSPACE_MODE === '1') return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new PostOpsError(
      `the server refused the batch: ${body?.error ?? res.status} — nothing written`
    );
  }
  return res.json().catch(() => ({ ok: true, rejected: [] }));
}
