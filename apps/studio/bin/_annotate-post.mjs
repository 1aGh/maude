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

const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
// _runs.mjs LIVE, best first: the run whose turn is going is the one writing.
const LIVE_ORDER = ['running', 'needs-you', 'starting', 'waiting'];

/**
 * T-S4.5b (contract S4-S5-ai-annotations §2) — the run this verb's batch belongs to: inside a chat
 * (`MAUDE_CHAT_ID`, set per chat by the ACP spawn, acp/bridge.ts `chatSpawnEnv`) it is that chat's
 * own live run on this Mac (`mine`, not queued `behind` another). Pure; null = not inside a run.
 */
export function runIdForChat(view, chatId) {
  if (typeof chatId !== 'string' || !CHAT_ID.test(chatId)) return null;
  const rows = (Array.isArray(view?.mine) ? view.mine : []).filter(
    (r) =>
      r?.chatId === chatId &&
      LIVE_ORDER.includes(r.state) &&
      !r.behind &&
      typeof r.runId === 'string' &&
      RUN_ID.test(r.runId)
  );
  rows.sort((a, b) => LIVE_ORDER.indexOf(a.state) - LIVE_ORDER.indexOf(b.state));
  return rows[0]?.runId ?? null;
}

/**
 * The batch's actionId: `run:<runId>` inside a live chat run, else `ai-annotate-<rand>` (a terminal
 * Claude, an outside write). Any failure to read the runs is "not inside a run" — the studio's
 * gate decides what a tag may do, this only names it.
 */
export async function defaultActionId(base, env = process.env) {
  const fallback = `ai-annotate-${Math.random().toString(36).slice(2, 12)}`;
  const chatId = env.MAUDE_CHAT_ID;
  if (typeof chatId !== 'string' || !CHAT_ID.test(chatId)) return fallback;
  try {
    const res = await fetch(`${base}/_api/ai/runs`, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) return fallback;
    const runId = runIdForChat(await res.json(), chatId);
    return runId ? `run:${runId}` : fallback;
  } catch {
    return fallback;
  }
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
  const id = actionId ?? (await defaultActionId(base));
  let res;
  try {
    res = await fetch(`${base}/_api/annotations/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file,
        actionId: id,
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
