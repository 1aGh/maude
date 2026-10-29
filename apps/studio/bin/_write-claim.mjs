// _write-claim.mjs — a disk-writing `maude design` verb claims its bytes BEFORE it writes them
// (p8-a1-claims; server half: routes/agent.ts `POST /_api/agent/write/claim`, ai/write-claim.ts).
//
// Inside a Maude chat (`MAUDE_CHAT_ID`, set per chat by the ACP spawn) the verb tells the studio "these
// exact bytes, at these paths, are this chat's": the run's stage then owns the watcher's import of
// them, and a person's own save made in the same seconds (different bytes) stays the person's. Outside
// a chat, with no studio running, or when the chat has no live run, nothing is claimed and the write is
// an ordinary one. Never throws: a failed claim never blocks the verb's write. Internal; not a verb.

import { DESIGN_REL, findProjectRoot, locateStudio } from '../../../cli/lib/studio-locate.mjs';

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
