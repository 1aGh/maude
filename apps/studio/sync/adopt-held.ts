// sync/adopt-held.ts — #167 T5.3 item 2: "Adopt as code" for one file the hub holds back.
//
// The hub holds a path as `never` when it was a canvas only because no canvas folders were declared and
// the declaration now makes it code (apps/hub file-manifest.mjs `hubCheckoutClass`). Implicit adoption by
// an owner write was rejected on purpose (decision v2-p8-holds-fix-no-implicit-owner-adoption), so the
// owner's way out is this explicit act: `POST <hub>/api/journal/adopt { path, sha256 }`. The hub alone
// decides — its own owner gate (403 for anyone else), and it journals the bytes on ITS disk, never ours,
// and only when they are the version the owner was shown (`sha256` from the held list; other bytes are
// 409 and stay held). This side only carries the person's answer and starts a pass so the file arrives
// at once.

import { isProjectFileShape } from './file-membership.ts';

export interface AdoptHeldDeps {
  hubUrl: string;
  token: () => string | null;
  fetchImpl?: typeof fetch;
  /** Start a pass now (the adopted file syncs without waiting for the next tick). */
  runPass: () => Promise<void> | void;
}

export type AdoptHeldAnswer =
  | { ok: true }
  | {
      ok: false;
      reason: 'bad-request' | 'not-owner' | 'not-held' | 'changed' | 'update' | 'unreachable';
      detail: string;
    };

export interface AdoptHeldControl {
  /** `sha256` — the version the person was shown (the hub's held list). */
  adopt(path: string, sha256: string): Promise<AdoptHeldAnswer>;
}

/** CONTRACT §4 voice: what happened · what is safe · one verb. */
export const ADOPT_NOT_OWNER = 'Only the project owner can keep a held file as code.';
export const ADOPT_NOT_HELD = 'That file isn’t held any more. Nothing changed.';
export const ADOPT_CHANGED =
  'That file changed after it was shown. It’s still held. Look at the new version, then adopt it.';
export const ADOPT_UPDATE =
  'This file can’t be adopted until Maude and the project’s hub are both up to date. Nothing changed.';
/** The held list's version: a lowercase hex sha-256. */
export const SHA256_HEX = /^[0-9a-f]{64}$/;
export const ADOPT_UNREACHABLE =
  'The project’s hub didn’t answer. Nothing changed. Try again in a moment.';

export function createAdoptHeld(deps: AdoptHeldDeps): AdoptHeldControl {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = deps.hubUrl.replace(/\/+$/, '');
  return {
    async adopt(path, sha256) {
      if (typeof path !== 'string' || !isProjectFileShape(path)) {
        return { ok: false, reason: 'bad-request', detail: 'Name one held file.' };
      }
      if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) {
        return { ok: false, reason: 'bad-request', detail: ADOPT_UPDATE };
      }
      let status = 0;
      try {
        const res = await fetchImpl(`${base}/api/journal/adopt`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${deps.token() ?? ''}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ path, sha256 }),
        });
        status = res.status;
      } catch {
        return { ok: false, reason: 'unreachable', detail: ADOPT_UNREACHABLE };
      }
      if (status === 200) {
        void Promise.resolve(deps.runPass()).catch(() => {});
        return { ok: true };
      }
      if (status === 401 || status === 403) {
        return { ok: false, reason: 'not-owner', detail: ADOPT_NOT_OWNER };
      }
      if (status === 404) return { ok: false, reason: 'not-held', detail: ADOPT_NOT_HELD };
      if (status === 409) return { ok: false, reason: 'changed', detail: ADOPT_CHANGED };
      if (status === 428) return { ok: false, reason: 'update', detail: ADOPT_UPDATE };
      return { ok: false, reason: 'unreachable', detail: ADOPT_UNREACHABLE };
    },
  };
}
