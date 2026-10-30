// _write-claim.mjs — a disk-writing `maude design` verb claims its bytes BEFORE it writes them
// (p8-a1-claims; server half: routes/agent.ts `POST /_api/agent/write/claim`, ai/write-claim.ts).
//
// Inside a Maude chat (`MAUDE_CHAT_ID`, set per chat by the ACP spawn) the verb tells the studio "these
// exact bytes, at these paths, are this chat's": the run's stage then owns the watcher's import of
// them, and a person's own save made in the same seconds (different bytes) stays the person's. Outside
// a chat, with no studio running, or when the chat has no live run, nothing is claimed and the write is
// an ordinary one. Never throws: a failed claim never blocks the verb's write. Internal; not a verb.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DESIGN_REL,
  findProjectRoot,
  locateStudio,
  rootIdentity,
} from '../../../cli/lib/studio-locate.mjs';

const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Claim `writes` ({ rel: design-root-relative path, content: the bytes about to land }) for this
 * chat's live run. `from` is the project root or any path inside it. Resolves `{ claimed, reason? }`.
 */
export async function claimWrites(from, writes, { env = process.env, timeoutMs = 1500 } = {}) {
  const chat = env.MAUDE_CHAT_ID;
  if (typeof chat !== 'string' || !CHAT_ID.test(chat)) return { claimed: false, reason: 'no-chat' };
  const list = (writes ?? []).filter(
    (w) => w && typeof w.rel === 'string' && w.rel && typeof w.content === 'string'
  );
  if (!list.length) return { claimed: false, reason: 'nothing' };
  const root = from ? findProjectRoot(from) : null;
  const studio = root ? await locateStudio(root, { timeoutMs }) : null;
  if (!studio) return { claimed: false, reason: 'no-studio' };
  try {
    const res = await fetch(`${studio.base}/_api/agent/write/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat,
        writes: list.map((w) => {
          const p = w.rel.replace(/\\/g, '/');
          return {
            path: p.startsWith(`${DESIGN_REL}/`) ? p.slice(DESIGN_REL.length + 1) : p,
            content: w.content,
          };
        }),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.text().catch(() => '');
    return res.status === 200
      ? { claimed: true }
      : { claimed: false, reason: res.status === 409 ? 'no-live-run' : `status-${res.status}` };
  } catch {
    return { claimed: false, reason: 'unreachable' };
  }
}

/** The claim body's `path` for a write (design-root-relative). */
const claimPath = (rel) => {
  const p = String(rel).replace(/\\/g, '/');
  return p.startsWith(`${DESIGN_REL}/`) ? p.slice(DESIGN_REL.length + 1) : p;
};

/**
 * `claimWrites` for a verb whose write runs inside a synchronous call chain (`ds-check --fix`,
 * ds/canvas-cli.ts): the same request through loopback `curl` (macOS ships it; curl-local needs it
 * anyway), after the same studio identity check `locateStudio` makes (`/_health` names this root,
 * so a planted `_server.json` cannot point the bytes at another local service). Never throws.
 */
export function claimWritesSync(from, writes, { env = process.env, timeoutSec = 2 } = {}) {
  const chat = env.MAUDE_CHAT_ID;
  if (typeof chat !== 'string' || !CHAT_ID.test(chat)) return { claimed: false, reason: 'no-chat' };
  const list = (writes ?? []).filter(
    (w) => w && typeof w.rel === 'string' && w.rel && typeof w.content === 'string'
  );
  if (!list.length) return { claimed: false, reason: 'nothing' };
  const root = from ? findProjectRoot(from) : null;
  if (!root) return { claimed: false, reason: 'no-studio' };
  try {
    const info = JSON.parse(readFileSync(join(root, DESIGN_REL, '_server.json'), 'utf8'));
    const port = Number(info?.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return { claimed: false, reason: 'no-studio' };
    const base = `http://127.0.0.1:${port}`;
    const curl = (args, input) =>
      spawnSync('curl', ['-sS', '--max-time', String(timeoutSec), ...args], {
        input,
        encoding: 'utf8',
        timeout: (timeoutSec + 1) * 1000,
      });
    const h = curl([`${base}/_health`]);
    const health = h.status === 0 ? JSON.parse(h.stdout) : null;
    if (health?.app !== 'design' || health.rootId !== rootIdentity(root))
      return { claimed: false, reason: 'no-studio' };
    const body = JSON.stringify({
      chat,
      writes: list.map((w) => ({ path: claimPath(w.rel), content: w.content })),
    });
    const r = curl(
      [
        '-o',
        '/dev/null',
        '-w',
        '%{http_code}',
        '-H',
        'content-type: application/json',
        '--data-binary',
        '@-',
        `${base}/_api/agent/write/claim`,
      ],
      body
    );
    const code = Number(String(r.stdout).trim());
    return code === 200
      ? { claimed: true }
      : { claimed: false, reason: code === 409 ? 'no-live-run' : `status-${code}` };
  } catch {
    return { claimed: false, reason: 'unreachable' };
  }
}
