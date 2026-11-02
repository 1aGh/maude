// sync/media-gate.ts — a team server with no media checkout, said once, retried never (p8-ia-edges, ia-edges / triage F16).
//
// A hub that holds no checkout cannot store pictures and videos: its `PUT /assets/<key>` answers 405 ("this hub does
// not accept file writes"). Before this gate every file change and every boot sent the same doomed PUT again and the
// Sync panel counted each as a failed upload. Now the first refused PUT ends the pass (`pushAssets` → `refused`), this
// gate stops further passes, and the person gets one human message instead of a failure count.
//
// The gate reopens only when the SERVER's state changes — its `/health` version, capabilities or project format,
// which is what a redeploy or a reconnect to a server that gained a checkout reports. It is re-read on the 20 s poll
// (`tick`), never on a timer of its own, and an unreachable server changes nothing. A reopened gate allows exactly one
// attempt; refused again, it stops again on the new signature — one attempt per server state, never a loop.

import type { AssetPushResult } from './asset-push.ts';

/** The message (Michal 2026-10-29, ia-edges). */
export const MEDIA_STAYS_LINE =
  "This team server can't store media, so pictures and videos stay on this Mac.";
/** What to do about it: the person who runs the server. */
export const MEDIA_STAYS_NEXT =
  'Ask whoever runs the server to turn on file storage for this project. Maude checks again when the server changes.';

/** How long to wait for `/health`; a probe must never hang the poll. */
const PROBE_TIMEOUT_MS = 4000;

/**
 * A fingerprint of the server's state, read from `/health`: version + capabilities + project format. `null` when the
 * server cannot be read (down, redirected, malformed) — callers treat that as "no news".
 */
export async function readServerSignature(
  hubUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  try {
    const res = await fetchImpl(`${hubUrl.replace(/\/+$/, '')}/health`, {
      redirect: 'error',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      version?: unknown;
      capabilities?: unknown;
      formatVersion?: unknown;
    };
    const caps = Array.isArray(body?.capabilities)
      ? body.capabilities.filter((c): c is string => typeof c === 'string').sort()
      : null;
    return JSON.stringify([
      typeof body?.version === 'string' ? body.version.slice(0, 64) : null,
      caps,
      typeof body?.formatVersion === 'number' ? body.formatVersion : null,
    ]);
  } catch {
    return null;
  }
}

export type MediaNotice = 'no-checkout';

export interface MediaGate {
  /** May an upload pass start now? */
  allowed(): boolean;
  /** Feed a finished pass in: a refusal closes the gate (and says why, once). */
  noteResult(result: Pick<AssetPushResult, 'refused'>): Promise<void>;
  /** The poll tick: re-read the server; true when its state changed and the gate reopened. */
  tick(): Promise<boolean>;
}

export function createMediaGate(opts: {
  /** The server's current signature, or null when it cannot be read. */
  probe: () => Promise<string | null>;
  /** `'no-checkout'` when the message should show; `null` when it should clear. */
  onNotice: (notice: MediaNotice | null) => void;
}): MediaGate {
  let stopped: { sig: string | null; settled: boolean } | null = null;
  return {
    allowed: () => stopped === null,
    async noteResult(result) {
      if (result.refused !== 'no-checkout' || stopped) return;
      // Close first: a second pass that races the probe below must not start.
      stopped = { sig: null, settled: false };
      const sig = await opts.probe().catch(() => null);
      if (stopped) {
        stopped.sig = sig;
        stopped.settled = true;
      }
      opts.onNotice('no-checkout');
    },
    async tick() {
      if (!stopped?.settled) return false;
      const sig = await opts.probe().catch(() => null);
      if (sig === null || sig === stopped.sig) return false;
      stopped = null;
      opts.onNotice(null);
      return true;
    },
  };
}
